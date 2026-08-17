import {
  parseWhatsAppSendCommandV1,
  parseWhatsAppSendResultV1,
  type WhatsAppSendCommandV1,
  type WhatsAppSendResultV1,
} from '../../../../shared/contracts/v1/index'
import type { WhatsAppMessagingPort } from '../../../../server/application/ports/whatsapp'

export const META_WHATSAPP_GRAPH_VERSION = 'v25.0'
export const META_WHATSAPP_GRAPH_BASE_URL = 'https://graph.facebook.com'

const DEFAULT_TIMEOUT_MS = 8_000
const DEFAULT_MAX_ATTEMPTS = 3
const MAX_TEXT_CHARS = 4_096

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

type MetaGraphErrorPayload = Readonly<{
  error?: Readonly<{
    code?: unknown
    error_subcode?: unknown
    fbtrace_id?: unknown
  }>
}>

export type MetaWhatsAppCredentials = Readonly<{
  accessToken: string
  phoneNumberId: string
}>

export interface MetaWhatsAppCredentialsResolver {
  resolveForTenant(tenantId: string): Promise<MetaWhatsAppCredentials | null>
}

export type MetaWhatsAppGraphErrorCode =
  | 'WHATSAPP_GRAPH_NOT_CONFIGURED'
  | 'WHATSAPP_GRAPH_TIMEOUT'
  | 'WHATSAPP_GRAPH_UNAVAILABLE'
  | 'WHATSAPP_GRAPH_REJECTED'
  | 'WHATSAPP_GRAPH_INVALID_RESPONSE'

export class MetaWhatsAppGraphError extends Error {
  readonly code: MetaWhatsAppGraphErrorCode
  readonly retryable: boolean
  readonly httpStatus: number | null
  readonly providerCode: string | null
  readonly providerSubcode: string | null
  readonly providerTraceId: string | null
  readonly correlationId: string

  constructor(input: Readonly<{
    code: MetaWhatsAppGraphErrorCode
    retryable: boolean
    correlationId: string
    httpStatus?: number | null
    providerCode?: string | null
    providerSubcode?: string | null
    providerTraceId?: string | null
  }>) {
    super('WhatsApp Graph transport failed.')
    this.name = 'MetaWhatsAppGraphError'
    this.code = input.code
    this.retryable = input.retryable
    this.httpStatus = input.httpStatus ?? null
    this.providerCode = input.providerCode ?? null
    this.providerSubcode = input.providerSubcode ?? null
    this.providerTraceId = input.providerTraceId ?? null
    this.correlationId = input.correlationId
  }
}

export type MetaWhatsAppGraphAdapterOptions = Readonly<{
  credentials: MetaWhatsAppCredentialsResolver
  graphVersion?: string
  graphBaseUrl?: string
  timeoutMs?: number
  maxAttempts?: number
  fetchFn?: FetchLike
  now?: () => Date
  sleep?: (milliseconds: number) => Promise<void>
}>

function clean(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function cleanNumericIdentifier(value: unknown): string {
  const normalized = clean(value)
  return /^\d+$/.test(normalized) ? normalized : ''
}

function normalizeRecipient(value: string): string {
  const normalized = value.trim().replace(/^\+/, '')
  return /^\d{8,20}$/.test(normalized) ? normalized : ''
}

function normalizeGraphVersion(value: string | undefined): string {
  const normalized = clean(value) || META_WHATSAPP_GRAPH_VERSION
  if (!/^v\d+\.\d+$/.test(normalized)) {
    throw new Error('Invalid Meta Graph API version configuration.')
  }
  return normalized
}

function normalizeBaseUrl(value: string | undefined): string {
  return (clean(value) || META_WHATSAPP_GRAPH_BASE_URL).replace(/\/+$/, '')
}

function positiveInteger(value: number | undefined, fallback: number): number {
  return Number.isInteger(value) && Number(value) > 0 ? Number(value) : fallback
}

function isTransientHttpStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500
}

function stringCode(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  const normalized = clean(value)
  return normalized || null
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  try {
    const value = await response.json()
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {}
  } catch {
    return {}
  }
}

function providerErrorDetails(payload: Record<string, unknown>) {
  const error = (payload as MetaGraphErrorPayload).error
  return {
    providerCode: stringCode(error?.code),
    providerSubcode: stringCode(error?.error_subcode),
    providerTraceId: clean(error?.fbtrace_id) || null,
  }
}

function providerMessageId(payload: Record<string, unknown>): string {
  const messages = payload.messages
  if (!Array.isArray(messages)) return ''
  const first = messages[0]
  if (!first || typeof first !== 'object' || Array.isArray(first)) return ''
  return clean((first as Record<string, unknown>).id)
}

function defaultSleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

function retryDelay(attempt: number): number {
  return Math.min(1_000, 150 * (2 ** Math.max(0, attempt - 1)))
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

export class MetaWhatsAppGraphAdapter implements WhatsAppMessagingPort {
  private readonly credentials: MetaWhatsAppCredentialsResolver
  private readonly graphVersion: string
  private readonly graphBaseUrl: string
  private readonly timeoutMs: number
  private readonly maxAttempts: number
  private readonly fetchFn: FetchLike
  private readonly now: () => Date
  private readonly sleep: (milliseconds: number) => Promise<void>

  constructor(options: MetaWhatsAppGraphAdapterOptions) {
    this.credentials = options.credentials
    this.graphVersion = normalizeGraphVersion(options.graphVersion)
    this.graphBaseUrl = normalizeBaseUrl(options.graphBaseUrl)
    this.timeoutMs = positiveInteger(options.timeoutMs, DEFAULT_TIMEOUT_MS)
    this.maxAttempts = positiveInteger(options.maxAttempts, DEFAULT_MAX_ATTEMPTS)
    this.fetchFn = options.fetchFn ?? fetch
    this.now = options.now ?? (() => new Date())
    this.sleep = options.sleep ?? defaultSleep
  }

  async sendText(command: WhatsAppSendCommandV1): Promise<WhatsAppSendResultV1> {
    const validated = parseWhatsAppSendCommandV1(command)
    const correlationId = validated.correlation_id ?? validated.idempotency_key
    const recipient = normalizeRecipient(validated.to)

    if (!recipient) {
      throw new MetaWhatsAppGraphError({
        code: 'WHATSAPP_GRAPH_REJECTED',
        retryable: false,
        correlationId,
      })
    }

    let resolved: MetaWhatsAppCredentials | null
    try {
      resolved = await this.credentials.resolveForTenant(validated.tenant_id)
    } catch {
      throw new MetaWhatsAppGraphError({
        code: 'WHATSAPP_GRAPH_UNAVAILABLE',
        retryable: true,
        correlationId,
      })
    }

    const accessToken = clean(resolved?.accessToken)
    const phoneNumberId = cleanNumericIdentifier(resolved?.phoneNumberId)
    if (!accessToken || !phoneNumberId) {
      throw new MetaWhatsAppGraphError({
        code: 'WHATSAPP_GRAPH_NOT_CONFIGURED',
        retryable: false,
        correlationId,
      })
    }

    const endpoint = `${this.graphBaseUrl}/${encodeURIComponent(this.graphVersion)}/${encodeURIComponent(phoneNumberId)}/messages`
    const requestBody = JSON.stringify({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: recipient,
      type: 'text',
      text: {
        preview_url: false,
        body: validated.body.slice(0, MAX_TEXT_CHARS),
      },
    })

    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs)

      try {
        const response = await this.fetchFn(endpoint, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${accessToken}`,
            'content-type': 'application/json',
          },
          body: requestBody,
          signal: controller.signal,
        })
        const payload = await readJson(response)

        if (response.ok) {
          const messageId = providerMessageId(payload)
          if (!messageId) {
            throw new MetaWhatsAppGraphError({
              code: 'WHATSAPP_GRAPH_INVALID_RESPONSE',
              retryable: false,
              correlationId,
              httpStatus: response.status,
              ...providerErrorDetails(payload),
            })
          }

          return parseWhatsAppSendResultV1({
            type: 'whatsapp_send_result',
            version: 1,
            tenant_id: validated.tenant_id,
            conversation_id: validated.conversation_id,
            idempotency_key: validated.idempotency_key,
            provider_message_id: messageId,
            status: 'submitted',
            occurred_at: this.now().toISOString(),
            correlation_id: validated.correlation_id ?? null,
          })
        }

        const retryable = isTransientHttpStatus(response.status)
        const graphError = new MetaWhatsAppGraphError({
          code: retryable ? 'WHATSAPP_GRAPH_UNAVAILABLE' : 'WHATSAPP_GRAPH_REJECTED',
          retryable,
          correlationId,
          httpStatus: response.status,
          ...providerErrorDetails(payload),
        })

        if (!retryable || attempt >= this.maxAttempts) throw graphError
      } catch (error) {
        if (error instanceof MetaWhatsAppGraphError) {
          if (!error.retryable || attempt >= this.maxAttempts) throw error
        } else {
          const graphError = new MetaWhatsAppGraphError({
            code: isAbortError(error) ? 'WHATSAPP_GRAPH_TIMEOUT' : 'WHATSAPP_GRAPH_UNAVAILABLE',
            retryable: true,
            correlationId,
          })
          if (attempt >= this.maxAttempts) throw graphError
        }
      } finally {
        clearTimeout(timeout)
      }

      await this.sleep(retryDelay(attempt))
    }

    throw new MetaWhatsAppGraphError({
      code: 'WHATSAPP_GRAPH_UNAVAILABLE',
      retryable: true,
      correlationId,
    })
  }
}
