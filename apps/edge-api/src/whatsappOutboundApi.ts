import { getBetterAuthSession, type BetterAuthRuntimeBindings } from './auth/betterAuthRuntime'
import {
  sendWhatsAppOutboundText,
  WhatsAppOutboundServiceError,
  type WhatsAppOutboundBindings,
} from './whatsappOutboundService'

const SEND_PATH = '/api/whatsapp/send'
const DEFAULT_MODULE_ID = 'petshop'

type Bindings = BetterAuthRuntimeBindings & WhatsAppOutboundBindings

type MembershipRow = Readonly<{
  role: string
  module_permissions_json: string
  membership_status: string
  tenant_status: string
}>

function json(body: unknown, status = 200, headers?: HeadersInit): Response {
  const finalHeaders = new Headers(headers)
  finalHeaders.set('cache-control', 'no-store')
  return Response.json(body, { status, headers: finalHeaders })
}

function clean(value: unknown, max = 160): string {
  const normalized = String(value ?? '').trim()
  return normalized && normalized.length <= max ? normalized : ''
}

function safeModuleId(value: unknown): string {
  const normalized = clean(value, 64).toLowerCase()
  return /^[a-z0-9][a-z0-9_-]{0,63}$/.test(normalized) ? normalized : ''
}

function moduleAllowed(raw: string, moduleId: string): boolean {
  try {
    const value = JSON.parse(raw || '{}')
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false
    const permissions = value as Record<string, unknown>
    return permissions['*'] === true
      || permissions[moduleId] === true
      || Boolean(permissions[moduleId] && typeof permissions[moduleId] === 'object')
  } catch {
    return false
  }
}

async function authorize(
  request: Request,
  bindings: Bindings,
  tenantId: string,
  moduleId: string,
): Promise<Response | null> {
  if (!bindings.DB || !bindings.AUTH_DB) return json({ code: 'DATABASE_NOT_CONFIGURED' }, 503)
  const session = await getBetterAuthSession(request, bindings)
  const subject = clean(session?.user?.id, 255)
  if (!subject) return json({ code: 'UNAUTHENTICATED' }, 401)

  const row = await bindings.DB.prepare(`
    SELECT m.role,m.module_permissions_json,m.status AS membership_status,t.status AS tenant_status
    FROM identity_principals p
    JOIN tenant_memberships m ON m.principal_id=p.id AND m.tenant_id=?2
    JOIN tenants t ON t.id=m.tenant_id
    WHERE p.provider='better-auth' AND p.subject=?1 AND p.status='active'
    LIMIT 1
  `).bind(subject, tenantId).first<MembershipRow>()
  if (!row || row.membership_status !== 'active' || row.tenant_status !== 'active') {
    return json({ code: 'FORBIDDEN' }, 403)
  }
  const allowed = row.role === 'owner' || row.role === 'admin' || moduleAllowed(row.module_permissions_json, moduleId)
  return allowed ? null : json({ code: 'FORBIDDEN' }, 403)
}

function errorResponse(error: unknown): Response {
  if (!(error instanceof WhatsAppOutboundServiceError)) {
    return json({ code: 'WHATSAPP_OUTBOUND_UNAVAILABLE' }, 503)
  }
  const status = error.code === 'WHATSAPP_OUTBOUND_INVALID_INPUT'
    ? 400
    : error.code === 'WHATSAPP_OUTBOUND_PHONE_SELECTION_REQUIRED'
      ? 409
      : error.code === 'WHATSAPP_OUTBOUND_PHONE_NOT_FOUND'
        || error.code === 'WHATSAPP_OUTBOUND_NOT_CONFIGURED'
        || error.code === 'WHATSAPP_OUTBOUND_CREDENTIAL_NOT_FOUND'
        ? 409
        : error.code === 'WHATSAPP_OUTBOUND_DELIVERY_FAILED'
          ? (error.retryable ? 503 : 502)
          : 503
  return json({ code: error.code, retryable: error.retryable }, status)
}

export async function handleWhatsappUnifiedOutboundApiRequest(
  request: Request,
  bindings: Bindings,
): Promise<Response | null> {
  const url = new URL(request.url)
  if (url.pathname !== SEND_PATH) return null
  if (request.method !== 'POST') return json({ code: 'METHOD_NOT_ALLOWED' }, 405, { allow: 'POST' })

  let payload: Record<string, unknown>
  try {
    const parsed = await request.json()
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid')
    payload = parsed as Record<string, unknown>
  } catch {
    return json({ code: 'INVALID_JSON' }, 400)
  }

  const tenantId = clean(payload.tenant_id || request.headers.get('x-tenant-id'))
  const moduleId = safeModuleId(payload.module_id || request.headers.get('x-module-id') || DEFAULT_MODULE_ID)
  const to = clean(payload.to, 24)
  const text = clean(payload.text, 4_096)
  const idempotencyKey = clean(payload.idempotency_key || request.headers.get('x-idempotency-key'))
  const phoneNumberId = payload.phone_number_id == null ? null : clean(payload.phone_number_id)
  const conversationId = clean(payload.conversation_id, 128) || `wa:${to.replace(/^\+/, '')}`

  if (!tenantId || !moduleId || !to || !text || !idempotencyKey) {
    return json({ code: 'INVALID_WHATSAPP_MESSAGE' }, 400)
  }
  const authError = await authorize(request, bindings, tenantId, moduleId)
  if (authError) return authError

  try {
    const result = await sendWhatsAppOutboundText(bindings, {
      tenantId,
      moduleId,
      conversationId,
      to,
      body: text,
      idempotencyKey,
      actorType: 'human',
      phoneNumberId,
      correlationId: clean(request.headers.get('x-request-id')) || null,
    })
    return json({ ok: result.status !== 'failed', result })
  } catch (error) {
    return errorResponse(error)
  }
}
