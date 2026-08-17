import type {
  WhatsAppCreateMessageTemplateCommand,
  WhatsAppCreateMessageTemplateResult,
  WhatsAppMessageTemplateSummary,
  WhatsAppTemplateManagementPort,
} from '../../../../server/application/ports/whatsapp'
import {
  META_WHATSAPP_GRAPH_BASE_URL,
  META_WHATSAPP_GRAPH_VERSION,
} from './metaWhatsAppGraphAdapter'

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

export interface MetaWhatsAppTemplateCredentialResolver {
  resolveForWaba(tenantId: string, wabaId: string): Promise<{ accessToken: string } | null>
}

export type MetaWhatsAppTemplateManagementErrorCode =
  | 'WHATSAPP_TEMPLATE_NOT_CONFIGURED'
  | 'WHATSAPP_TEMPLATE_INVALID_INPUT'
  | 'WHATSAPP_TEMPLATE_GRAPH_REJECTED'
  | 'WHATSAPP_TEMPLATE_GRAPH_UNAVAILABLE'
  | 'WHATSAPP_TEMPLATE_GRAPH_INVALID_RESPONSE'

export class MetaWhatsAppTemplateManagementError extends Error {
  readonly code: MetaWhatsAppTemplateManagementErrorCode
  readonly retryable: boolean
  readonly httpStatus: number | null
  readonly providerCode: string | null

  constructor(input: Readonly<{
    code: MetaWhatsAppTemplateManagementErrorCode
    retryable: boolean
    httpStatus?: number | null
    providerCode?: string | null
  }>) {
    super('WhatsApp template management failed.')
    this.name = 'MetaWhatsAppTemplateManagementError'
    this.code = input.code
    this.retryable = input.retryable
    this.httpStatus = input.httpStatus ?? null
    this.providerCode = input.providerCode ?? null
  }
}

type Options = Readonly<{
  credentials: MetaWhatsAppTemplateCredentialResolver
  graphVersion?: string
  graphBaseUrl?: string
  fetchFn?: FetchLike
}>

function clean(value: unknown, max = 512): string {
  const normalized = typeof value === 'string' ? value.trim() : ''
  return normalized.length > 0 && normalized.length <= max ? normalized : ''
}

function numericId(value: unknown): string {
  const normalized = clean(value, 160)
  return /^\d+$/.test(normalized) ? normalized : ''
}

function version(value?: string): string {
  const normalized = clean(value, 32) || META_WHATSAPP_GRAPH_VERSION
  if (!/^v\d+\.\d+$/.test(normalized)) throw new Error('Invalid Meta Graph API version configuration.')
  return normalized
}

async function readObject(response: Response): Promise<Record<string, unknown>> {
  try {
    const value = await response.json()
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

function providerCode(payload: Record<string, unknown>): string | null {
  const error = payload.error
  if (!error || typeof error !== 'object' || Array.isArray(error)) return null
  const code = (error as Record<string, unknown>).code
  return typeof code === 'number' || typeof code === 'string' ? String(code) : null
}

function transient(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500
}

function normalizeTemplate(value: unknown): WhatsAppMessageTemplateSummary | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const row = value as Record<string, unknown>
  const id = clean(row.id, 160)
  const name = clean(row.name)
  if (!id || !name) return null
  return {
    id,
    name,
    status: clean(row.status, 80) || 'UNKNOWN',
    category: clean(row.category, 80) || 'UNKNOWN',
    language: clean(row.language, 32) || 'UNKNOWN',
  }
}

export class MetaWhatsAppTemplateManagementAdapter implements WhatsAppTemplateManagementPort {
  private readonly credentials: MetaWhatsAppTemplateCredentialResolver
  private readonly graphVersion: string
  private readonly graphBaseUrl: string
  private readonly fetchFn: FetchLike

  constructor(options: Options) {
    this.credentials = options.credentials
    this.graphVersion = version(options.graphVersion)
    this.graphBaseUrl = (clean(options.graphBaseUrl, 512) || META_WHATSAPP_GRAPH_BASE_URL).replace(/\/+$/, '')
    this.fetchFn = options.fetchFn ?? fetch
  }

  async listTemplates(input: Readonly<{ tenantId: string; wabaId: string }>): Promise<readonly WhatsAppMessageTemplateSummary[]> {
    const tenantId = clean(input.tenantId, 160)
    const wabaId = numericId(input.wabaId)
    if (!tenantId || !wabaId) throw new MetaWhatsAppTemplateManagementError({ code: 'WHATSAPP_TEMPLATE_INVALID_INPUT', retryable: false })
    const credential = await this.credentials.resolveForWaba(tenantId, wabaId)
    if (!clean(credential?.accessToken, 8_192)) throw new MetaWhatsAppTemplateManagementError({ code: 'WHATSAPP_TEMPLATE_NOT_CONFIGURED', retryable: false })

    const fields = encodeURIComponent('id,name,status,category,language')
    const response = await this.fetchFn(`${this.graphBaseUrl}/${this.graphVersion}/${wabaId}/message_templates?fields=${fields}&limit=50`, {
      headers: { authorization: `Bearer ${credential!.accessToken}` },
    }).catch(() => null)
    if (!response) throw new MetaWhatsAppTemplateManagementError({ code: 'WHATSAPP_TEMPLATE_GRAPH_UNAVAILABLE', retryable: true })
    const payload = await readObject(response)
    if (!response.ok) {
      throw new MetaWhatsAppTemplateManagementError({
        code: transient(response.status) ? 'WHATSAPP_TEMPLATE_GRAPH_UNAVAILABLE' : 'WHATSAPP_TEMPLATE_GRAPH_REJECTED',
        retryable: transient(response.status),
        httpStatus: response.status,
        providerCode: providerCode(payload),
      })
    }
    if (!Array.isArray(payload.data)) throw new MetaWhatsAppTemplateManagementError({ code: 'WHATSAPP_TEMPLATE_GRAPH_INVALID_RESPONSE', retryable: false, httpStatus: response.status })
    return payload.data.map(normalizeTemplate).filter((item): item is WhatsAppMessageTemplateSummary => Boolean(item))
  }

  async createTemplate(command: WhatsAppCreateMessageTemplateCommand): Promise<WhatsAppCreateMessageTemplateResult> {
    const tenantId = clean(command.tenantId, 160)
    const wabaId = numericId(command.wabaId)
    const name = clean(command.name).toLowerCase()
    const language = clean(command.language, 32)
    const bodyText = clean(command.bodyText, 1_024)
    const category = command.category
    if (!tenantId || !wabaId || !/^[a-z0-9_]{1,512}$/.test(name) || !/^[a-z]{2}_[A-Z]{2}$/.test(language) || !bodyText || !['UTILITY','MARKETING','AUTHENTICATION'].includes(category)) {
      throw new MetaWhatsAppTemplateManagementError({ code: 'WHATSAPP_TEMPLATE_INVALID_INPUT', retryable: false })
    }
    const credential = await this.credentials.resolveForWaba(tenantId, wabaId)
    if (!clean(credential?.accessToken, 8_192)) throw new MetaWhatsAppTemplateManagementError({ code: 'WHATSAPP_TEMPLATE_NOT_CONFIGURED', retryable: false })

    const response = await this.fetchFn(`${this.graphBaseUrl}/${this.graphVersion}/${wabaId}/message_templates`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${credential!.accessToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        name,
        language,
        category,
        allow_category_change: true,
        components: [{ type: 'BODY', text: bodyText }],
      }),
    }).catch(() => null)
    if (!response) throw new MetaWhatsAppTemplateManagementError({ code: 'WHATSAPP_TEMPLATE_GRAPH_UNAVAILABLE', retryable: true })
    const payload = await readObject(response)
    if (!response.ok) {
      throw new MetaWhatsAppTemplateManagementError({
        code: transient(response.status) ? 'WHATSAPP_TEMPLATE_GRAPH_UNAVAILABLE' : 'WHATSAPP_TEMPLATE_GRAPH_REJECTED',
        retryable: transient(response.status),
        httpStatus: response.status,
        providerCode: providerCode(payload),
      })
    }
    const id = clean(payload.id, 160)
    if (!id) throw new MetaWhatsAppTemplateManagementError({ code: 'WHATSAPP_TEMPLATE_GRAPH_INVALID_RESPONSE', retryable: false, httpStatus: response.status })
    return {
      id,
      status: clean(payload.status, 80) || 'PENDING',
      category: clean(payload.category, 80) || category,
    }
  }
}
