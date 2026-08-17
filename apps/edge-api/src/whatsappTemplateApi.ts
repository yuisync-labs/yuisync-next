import { getBetterAuthSession, type BetterAuthRuntimeBindings } from './auth/betterAuthRuntime'
import { D1EncryptedWhatsAppCredentialVault } from './adapters/d1EncryptedWhatsAppCredentialVault'
import { D1WhatsAppConnectionRepository } from './adapters/d1WhatsAppConnectionRepository'
import {
  MetaWhatsAppTemplateManagementAdapter,
  MetaWhatsAppTemplateManagementError,
} from './adapters/metaWhatsAppTemplateManagementAdapter'
import { META_WHATSAPP_GRAPH_VERSION } from './adapters/metaWhatsAppGraphAdapter'
import type { EdgeWhatsappBindings } from './types'

const PATH = '/api/whatsapp/templates'

type Bindings = BetterAuthRuntimeBindings & EdgeWhatsappBindings & { DB?: D1Database }
type MembershipRow = Readonly<{ role: string; status: string; tenant_status: string }>
type PrincipalRow = Readonly<{ id: string; status: string }>

function json(body: unknown, status = 200, headers?: HeadersInit): Response {
  const finalHeaders = new Headers(headers)
  finalHeaders.set('cache-control', 'no-store')
  return Response.json(body, { status, headers: finalHeaders })
}

function safeId(value: unknown, max = 160): string | null {
  const normalized = String(value ?? '').trim()
  return normalized && normalized.length <= max ? normalized : null
}

function numericId(value: unknown): string | null {
  const normalized = safeId(value)
  return normalized && /^\d+$/.test(normalized) ? normalized : null
}

async function authorizeTenantAdmin(request: Request, bindings: Bindings, tenantId: string): Promise<Response | null> {
  if (!bindings.DB || !bindings.AUTH_DB) return json({ code: 'DATABASE_NOT_CONFIGURED' }, 503)
  const session = await getBetterAuthSession(request, bindings)
  const subject = safeId(session?.user?.id, 255)
  if (!subject) return json({ code: 'UNAUTHENTICATED' }, 401)
  const principal = await bindings.DB.prepare(`
    SELECT id,status FROM identity_principals
    WHERE provider='better-auth' AND subject=?1 LIMIT 1
  `).bind(subject).first<PrincipalRow>()
  if (!principal || principal.status !== 'active') return json({ code: 'FORBIDDEN' }, 403)
  const membership = await bindings.DB.prepare(`
    SELECT m.role,m.status,t.status AS tenant_status
    FROM tenant_memberships m JOIN tenants t ON t.id=m.tenant_id
    WHERE m.principal_id=?1 AND m.tenant_id=?2 LIMIT 1
  `).bind(principal.id, tenantId).first<MembershipRow>()
  const allowed = membership
    && membership.status === 'active'
    && membership.tenant_status === 'active'
    && (membership.role === 'owner' || membership.role === 'admin')
  return allowed ? null : json({ code: 'FORBIDDEN' }, 403)
}

async function resolveSelection(bindings: Bindings, tenantId: string, requestedPhoneId: string | null) {
  const connections = (await new D1WhatsAppConnectionRepository(bindings.DB).findByTenantId(tenantId))
    .filter((connection) => connection.status === 'connected')
  if (requestedPhoneId) {
    const selected = connections.find((connection) => connection.phone_number_id === requestedPhoneId)
    return selected ? { selected, error: null } : { selected: null, error: json({ code: 'WHATSAPP_CONNECTION_NOT_FOUND' }, 404) }
  }
  if (!connections.length) return { selected: null, error: json({ code: 'WHATSAPP_CONNECTION_NOT_FOUND' }, 404) }
  if (connections.length > 1) return { selected: null, error: json({ code: 'WHATSAPP_PHONE_SELECTION_REQUIRED' }, 409) }
  return { selected: connections[0], error: null }
}

function adapter(bindings: Bindings, tenantId: string, phoneNumberId: string) {
  const vault = new D1EncryptedWhatsAppCredentialVault(bindings.DB, bindings.WHATSAPP_CREDENTIAL_ENCRYPTION_KEY)
  return new MetaWhatsAppTemplateManagementAdapter({
    graphVersion: bindings.WHATSAPP_GRAPH_VERSION || META_WHATSAPP_GRAPH_VERSION,
    credentials: {
      async resolveForWaba(requestedTenantId, wabaId) {
        if (requestedTenantId !== tenantId) return null
        const connection = await new D1WhatsAppConnectionRepository(bindings.DB).findByPhoneNumberId(phoneNumberId)
        if (!connection || connection.tenant_id !== tenantId || connection.waba_id !== wabaId || connection.status !== 'connected') return null
        const credential = await vault.findByPhoneNumberId(tenantId, phoneNumberId)
        return credential ? { accessToken: credential.accessToken } : null
      },
    },
  })
}

function errorResponse(error: unknown): Response {
  if (error instanceof MetaWhatsAppTemplateManagementError) {
    const status = error.code === 'WHATSAPP_TEMPLATE_INVALID_INPUT'
      ? 400
      : error.code === 'WHATSAPP_TEMPLATE_NOT_CONFIGURED'
        ? 409
        : error.retryable ? 503 : 502
    return json({ code: error.code, retryable: error.retryable, provider_code: error.providerCode }, status)
  }
  return json({ code: 'WHATSAPP_TEMPLATE_UNAVAILABLE' }, 503)
}

export async function handleWhatsappTemplateApiRequest(request: Request, bindings: Bindings): Promise<Response | null> {
  const url = new URL(request.url)
  if (url.pathname !== PATH) return null

  try {
    if (request.method === 'GET') {
      const tenantId = safeId(url.searchParams.get('tenant_id'))
      const phoneNumberIdRaw = url.searchParams.get('phone_number_id')
      const phoneNumberId = phoneNumberIdRaw == null ? null : numericId(phoneNumberIdRaw)
      if (!tenantId || (phoneNumberIdRaw != null && !phoneNumberId)) return json({ code: 'INVALID_SCOPE' }, 400)
      const authError = await authorizeTenantAdmin(request, bindings, tenantId)
      if (authError) return authError
      const selection = await resolveSelection(bindings, tenantId, phoneNumberId)
      if (selection.error || !selection.selected) return selection.error
      const templates = await adapter(bindings, tenantId, selection.selected.phone_number_id)
        .listTemplates({ tenantId, wabaId: selection.selected.waba_id })
      return json({
        connection: {
          waba_id: selection.selected.waba_id,
          phone_number_id: selection.selected.phone_number_id,
          status: selection.selected.status,
        },
        templates,
      })
    }

    if (request.method === 'POST') {
      let payload: Record<string, unknown>
      try {
        const parsed = await request.json()
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid')
        payload = parsed as Record<string, unknown>
      } catch {
        return json({ code: 'INVALID_JSON' }, 400)
      }
      const tenantId = safeId(payload.tenant_id)
      const phoneNumberId = numericId(payload.phone_number_id)
      if (!tenantId || !phoneNumberId) return json({ code: 'INVALID_SCOPE' }, 400)
      const authError = await authorizeTenantAdmin(request, bindings, tenantId)
      if (authError) return authError
      const selection = await resolveSelection(bindings, tenantId, phoneNumberId)
      if (selection.error || !selection.selected) return selection.error
      const result = await adapter(bindings, tenantId, phoneNumberId).createTemplate({
        tenantId,
        wabaId: selection.selected.waba_id,
        name: String(payload.name ?? ''),
        language: String(payload.language ?? ''),
        category: String(payload.category ?? '') as 'UTILITY' | 'MARKETING' | 'AUTHENTICATION',
        bodyText: String(payload.body_text ?? ''),
      })
      return json({ ok: true, result }, 201)
    }

    return json({ code: 'METHOD_NOT_ALLOWED' }, 405, { allow: 'GET, POST' })
  } catch (error) {
    return errorResponse(error)
  }
}
