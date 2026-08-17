import { parseWhatsAppAccountConnectionV1 } from '../../../../shared/contracts/v1/index'
import type {
  WhatsAppEmbeddedSignupCompletion,
  WhatsAppEmbeddedSignupResult,
  WhatsAppOnboardingPort,
} from '../../../../server/application/ports/whatsapp'
import {
  META_WHATSAPP_GRAPH_BASE_URL,
  META_WHATSAPP_GRAPH_VERSION,
} from './metaWhatsAppGraphAdapter'

const DEFAULT_TIMEOUT_MS = 8_000
const MAX_CODE_LENGTH = 8_192

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

type MetaErrorPayload = Readonly<{
  error?: Readonly<{
    code?: unknown
    error_subcode?: unknown
    fbtrace_id?: unknown
  }>
}>

type MetaPhoneNumber = Readonly<{
  id?: unknown
  display_phone_number?: unknown
  verified_name?: unknown
}>

export type MetaWhatsAppOnboardingErrorCode =
  | 'WHATSAPP_ONBOARDING_NOT_CONFIGURED'
  | 'WHATSAPP_ONBOARDING_INVALID_INPUT'
  | 'WHATSAPP_ONBOARDING_PHONE_SELECTION_REQUIRED'
  | 'WHATSAPP_ONBOARDING_ASSET_MISMATCH'
  | 'WHATSAPP_ONBOARDING_TIMEOUT'
  | 'WHATSAPP_ONBOARDING_UNAVAILABLE'
  | 'WHATSAPP_ONBOARDING_REJECTED'
  | 'WHATSAPP_ONBOARDING_INVALID_RESPONSE'

export class MetaWhatsAppOnboardingError extends Error {
  readonly code: MetaWhatsAppOnboardingErrorCode
  readonly retryable: boolean
  readonly httpStatus: number | null
  readonly providerCode: string | null
  readonly providerSubcode: string | null
  readonly providerTraceId: string | null

  constructor(input: Readonly<{
    code: MetaWhatsAppOnboardingErrorCode
    retryable: boolean
    httpStatus?: number | null
    providerCode?: string | null
    providerSubcode?: string | null
    providerTraceId?: string | null
  }>) {
    super('WhatsApp onboarding request failed.')
    this.name = 'MetaWhatsAppOnboardingError'
    this.code = input.code
    this.retryable = input.retryable
    this.httpStatus = input.httpStatus ?? null
    this.providerCode = input.providerCode ?? null
    this.providerSubcode = input.providerSubcode ?? null
    this.providerTraceId = input.providerTraceId ?? null
  }
}

export type MetaWhatsAppOnboardingAdapterOptions = Readonly<{
  appId: string
  appSecret: string
  redirectUri: string
  graphVersion?: string
  graphBaseUrl?: string
  timeoutMs?: number
  fetchFn?: FetchLike
}>

function clean(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function numericId(value: unknown): string {
  const normalized = clean(value)
  return /^\d+$/.test(normalized) ? normalized : ''
}

function normalizeGraphVersion(value: string | undefined): string {
  const normalized = clean(value) || META_WHATSAPP_GRAPH_VERSION
  if (!/^v\d+\.\d+$/.test(normalized)) throw new Error('Invalid Meta Graph API version configuration.')
  return normalized
}

function normalizeBaseUrl(value: string | undefined): string {
  return (clean(value) || META_WHATSAPP_GRAPH_BASE_URL).replace(/\/+$/, '')
}

function positiveInteger(value: number | undefined, fallback: number): number {
  return Number.isInteger(value) && Number(value) > 0 ? Number(value) : fallback
}

function stringCode(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return clean(value) || null
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  try {
    const payload = await response.json()
    return payload && typeof payload === 'object' && !Array.isArray(payload)
      ? payload as Record<string, unknown>
      : {}
  } catch {
    return {}
  }
}

function errorDetails(payload: Record<string, unknown>) {
  const error = (payload as MetaErrorPayload).error
  return {
    providerCode: stringCode(error?.code),
    providerSubcode: stringCode(error?.error_subcode),
    providerTraceId: clean(error?.fbtrace_id) || null,
  }
}

function isTransientStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

export class MetaWhatsAppOnboardingAdapter implements WhatsAppOnboardingPort {
  private readonly appId: string
  private readonly appSecret: string
  private readonly redirectUri: string
  private readonly graphVersion: string
  private readonly graphBaseUrl: string
  private readonly timeoutMs: number
  private readonly fetchFn: FetchLike

  constructor(options: MetaWhatsAppOnboardingAdapterOptions) {
    this.appId = clean(options.appId)
    this.appSecret = clean(options.appSecret)
    this.redirectUri = clean(options.redirectUri)
    this.graphVersion = normalizeGraphVersion(options.graphVersion)
    this.graphBaseUrl = normalizeBaseUrl(options.graphBaseUrl)
    this.timeoutMs = positiveInteger(options.timeoutMs, DEFAULT_TIMEOUT_MS)
    this.fetchFn = options.fetchFn ?? fetch
  }

  async complete(input: WhatsAppEmbeddedSignupCompletion & Readonly<{ tenantId: string }>): Promise<WhatsAppEmbeddedSignupResult> {
    this.requireConfiguration()

    const tenantId = clean(input.tenantId)
    const code = clean(input.code)
    const wabaId = numericId(input.wabaId)
    const requestedPhoneNumberId = input.phoneNumberId == null ? '' : numericId(input.phoneNumberId)

    if (!tenantId || !code || code.length > MAX_CODE_LENGTH || !wabaId || (input.phoneNumberId != null && !requestedPhoneNumberId)) {
      throw new MetaWhatsAppOnboardingError({ code: 'WHATSAPP_ONBOARDING_INVALID_INPUT', retryable: false })
    }

    const accessToken = await this.exchangeCode(code)
    const waba = await this.graphGet(`/${encodeURIComponent(wabaId)}`, accessToken, {
      fields: 'id,name,owner_business_info',
    })
    if (numericId(waba.id) !== wabaId) {
      throw new MetaWhatsAppOnboardingError({ code: 'WHATSAPP_ONBOARDING_ASSET_MISMATCH', retryable: false })
    }

    const owner = waba.owner_business_info
    const ownerRecord = owner && typeof owner === 'object' && !Array.isArray(owner)
      ? owner as Record<string, unknown>
      : null
    const businessId = numericId(ownerRecord?.id)
    if (!businessId) {
      throw new MetaWhatsAppOnboardingError({ code: 'WHATSAPP_ONBOARDING_INVALID_RESPONSE', retryable: false })
    }

    const phonePayload = await this.graphGet(`/${encodeURIComponent(wabaId)}/phone_numbers`, accessToken, {
      fields: 'id,display_phone_number,verified_name',
    })
    const phoneNumbers = Array.isArray(phonePayload.data)
      ? (phonePayload.data as MetaPhoneNumber[])
          .map((value) => ({
            id: numericId(value?.id),
            displayPhoneNumber: clean(value?.display_phone_number) || null,
            verifiedName: clean(value?.verified_name) || null,
          }))
          .filter((value) => value.id)
      : []

    if (!phoneNumbers.length) {
      throw new MetaWhatsAppOnboardingError({ code: 'WHATSAPP_ONBOARDING_INVALID_RESPONSE', retryable: false })
    }

    let selected = requestedPhoneNumberId
      ? phoneNumbers.find((value) => value.id === requestedPhoneNumberId)
      : undefined

    if (requestedPhoneNumberId && !selected) {
      throw new MetaWhatsAppOnboardingError({ code: 'WHATSAPP_ONBOARDING_ASSET_MISMATCH', retryable: false })
    }
    if (!selected && phoneNumbers.length === 1) selected = phoneNumbers[0]
    if (!selected) {
      throw new MetaWhatsAppOnboardingError({ code: 'WHATSAPP_ONBOARDING_PHONE_SELECTION_REQUIRED', retryable: false })
    }

    return {
      connection: parseWhatsAppAccountConnectionV1({
        type: 'whatsapp_account_connection',
        version: 1,
        tenant_id: tenantId,
        business_id: businessId,
        waba_id: wabaId,
        phone_number_id: selected.id,
        display_phone_number: selected.displayPhoneNumber,
        verified_name: selected.verifiedName,
        status: 'pending',
      }),
      accessToken,
    }
  }

  async subscribe(wabaIdInput: string, accessTokenInput: string): Promise<void> {
    this.requireConfiguration()
    const wabaId = numericId(wabaIdInput)
    const accessToken = clean(accessTokenInput)
    if (!wabaId || !accessToken) {
      throw new MetaWhatsAppOnboardingError({ code: 'WHATSAPP_ONBOARDING_INVALID_INPUT', retryable: false })
    }
    await this.graphRequest(`/${encodeURIComponent(wabaId)}/subscribed_apps`, accessToken, { method: 'POST' })
  }

  private requireConfiguration(): void {
    if (!this.appId || !this.appSecret || !this.redirectUri) {
      throw new MetaWhatsAppOnboardingError({ code: 'WHATSAPP_ONBOARDING_NOT_CONFIGURED', retryable: false })
    }
  }

  private async exchangeCode(code: string): Promise<string> {
    const params = new URLSearchParams({
      client_id: this.appId,
      client_secret: this.appSecret,
      redirect_uri: this.redirectUri,
      code,
    })
    const payload = await this.request(`${this.graphBaseUrl}/${encodeURIComponent(this.graphVersion)}/oauth/access_token?${params.toString()}`, {
      method: 'GET',
      headers: { accept: 'application/json' },
    })
    const accessToken = clean(payload.access_token)
    if (!accessToken) {
      throw new MetaWhatsAppOnboardingError({ code: 'WHATSAPP_ONBOARDING_INVALID_RESPONSE', retryable: false })
    }
    return accessToken
  }

  private async graphGet(path: string, accessToken: string, query?: Record<string, string>): Promise<Record<string, unknown>> {
    const params = new URLSearchParams(query ?? {})
    const suffix = params.size ? `?${params.toString()}` : ''
    return this.graphRequest(`${path}${suffix}`, accessToken, { method: 'GET' })
  }

  private graphRequest(path: string, accessToken: string, init: RequestInit): Promise<Record<string, unknown>> {
    return this.request(`${this.graphBaseUrl}/${encodeURIComponent(this.graphVersion)}${path}`, {
      ...init,
      headers: {
        ...init.headers,
        accept: 'application/json',
        authorization: `Bearer ${accessToken}`,
      },
    })
  }

  private async request(url: string, init: RequestInit): Promise<Record<string, unknown>> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs)
    try {
      const response = await this.fetchFn(url, { ...init, signal: controller.signal })
      const payload = await readJson(response)
      if (!response.ok) {
        const retryable = isTransientStatus(response.status)
        throw new MetaWhatsAppOnboardingError({
          code: retryable ? 'WHATSAPP_ONBOARDING_UNAVAILABLE' : 'WHATSAPP_ONBOARDING_REJECTED',
          retryable,
          httpStatus: response.status,
          ...errorDetails(payload),
        })
      }
      return payload
    } catch (error) {
      if (error instanceof MetaWhatsAppOnboardingError) throw error
      throw new MetaWhatsAppOnboardingError({
        code: isAbortError(error) ? 'WHATSAPP_ONBOARDING_TIMEOUT' : 'WHATSAPP_ONBOARDING_UNAVAILABLE',
        retryable: true,
      })
    } finally {
      clearTimeout(timeout)
    }
  }
}
