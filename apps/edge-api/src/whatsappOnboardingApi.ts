import { getBetterAuthSession, type BetterAuthRuntimeBindings } from './auth/betterAuthRuntime'
import { D1EncryptedWhatsAppCredentialVault, WhatsAppCredentialVaultError } from './adapters/d1EncryptedWhatsAppCredentialVault'
import { D1WhatsAppConnectionRepository, WhatsAppConnectionRepositoryError } from './adapters/d1WhatsAppConnectionRepository'
import {
  MetaWhatsAppOnboardingAdapter,
  MetaWhatsAppOnboardingError,
} from './adapters/metaWhatsAppOnboardingAdapter'
import { META_WHATSAPP_GRAPH_VERSION } from './adapters/metaWhatsAppGraphAdapter'
import type { EdgeWhatsappBindings } from './types'

type Bindings = BetterAuthRuntimeBindings & EdgeWhatsappBindings & { DB?: D1Database }
type SessionResolver = typeof getBetterAuthSession
export type WhatsAppOnboardingApiDependencies = { getSession?: SessionResolver }

type MembershipRow = Readonly<{
  role: string
  status: string
  tenant_status: string
}>

type PrincipalRow = Readonly<{ id: string; status: string }>

type ActorResolution =
  | { ok: true; principalId: string }
  | { ok: false; response: Response }

const STATUS_PATH = '/api/whatsapp/onboarding/status'
const COMPLETE_PATH = '/api/whatsapp/onboarding/complete'
const SUBSCRIBE_PATH = '/api/whatsapp/onboarding/subscribe'
const FEATURE_TYPE = 'whatsapp_business_app_onboarding'
const SESSION_INFO_VERSION = '3'

function json(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { 'cache-control': 'no-store' },
  })
}

function safeId(value: unknown, max = 160): string | null {
  const normalized = String(value ?? '').trim()
  return normalized && normalized.length <= max ? normalized : null
}

function numericId(value: unknown): string | null {
  const normalized = safeId(value)
  return normalized && /^\d+$/.test(normalized) ? normalized : null
}

function safeCode(value: unknown): string | null {
  const normalized = String(value ?? '').trim()
  return normalized && normalized.length <= 8_192 ? normalized : null
}

async function body(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const parsed = await request.json()
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null
  } catch {
    return null
  }
}

function isAdminMembership(row: MembershipRow | null): boolean {
  return Boolean(
    row
    && row.status === 'active'
    && row.tenant_status === 'active'
    && (row.role === 'owner' || row.role === 'admin'),
  )
}

async function authorizeTenantAdmin(
  request: Request,
  bindings: Bindings,
  tenantId: string,
  getSession: SessionResolver,
): Promise<ActorResolution> {
  if (!bindings.DB || !bindings.AUTH_DB) return { ok: false, response: json({ code: 'DATABASE_NOT_CONFIGURED' }, 503) }
  const session = await getSession(request, bindings)
  const subject = safeId(session?.user?.id, 255)
  if (!subject) return { ok: false, response: json({ code: 'UNAUTHENTICATED' }, 401) }

  const principal = await bindings.DB.prepare(`
    SELECT id,status
    FROM identity_principals
    WHERE provider='better-auth' AND subject=?1
    LIMIT 1
  `).bind(subject).first<PrincipalRow>()
  if (!principal || principal.status !== 'active') return { ok: false, response: json({ code: 'FORBIDDEN' }, 403) }

  const membership = await bindings.DB.prepare(`
    SELECT m.role,m.status,t.status AS tenant_status
    FROM tenant_memberships m
    JOIN tenants t ON t.id=m.tenant_id
    WHERE m.principal_id=?1 AND m.tenant_id=?2
    LIMIT 1
  `).bind(principal.id, tenantId).first<MembershipRow>()

  return isAdminMembership(membership)
    ? { ok: true, principalId: principal.id }
    : { ok: false, response: json({ code: 'FORBIDDEN' }, 403) }
}

function configuration(bindings: Bindings) {
  const appId = numericId(bindings.WHATSAPP_APP_ID)
  const configurationId = numericId(bindings.WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID)
  const redirectUri = safeId(bindings.WHATSAPP_EMBEDDED_SIGNUP_REDIRECT_URI, 2_048)
  const appSecret = safeId(bindings.WHATSAPP_APP_SECRET, 2_048)
  const encryptionKey = safeId(bindings.WHATSAPP_CREDENTIAL_ENCRYPTION_KEY, 256)
  const graphVersion = String(bindings.WHATSAPP_GRAPH_VERSION || META_WHATSAPP_GRAPH_VERSION).trim()
  return {
    public: {
      appId,
      configurationId,
      graphVersion,
      featureType: FEATURE_TYPE,
      sessionInfoVersion: SESSION_INFO_VERSION,
    },
    private: { appSecret, redirectUri, encryptionKey },
    configured: Boolean(appId && configurationId && appSecret && redirectUri && encryptionKey && bindings.DB && bindings.AUTH_DB),
  }
}

function createOnboardingAdapter(bindings: Bindings) {
  const config = configuration(bindings)
  if (!config.configured) throw new MetaWhatsAppOnboardingError({ code: 'WHATSAPP_ONBOARDING_NOT_CONFIGURED', retryable: false })
  return new MetaWhatsAppOnboardingAdapter({
    appId: config.public.appId!,
    appSecret: config.private.appSecret!,
    redirectUri: config.private.redirectUri!,
    graphVersion: config.public.graphVersion,
  })
}

function createVault(bindings: Bindings) {
  return new D1EncryptedWhatsAppCredentialVault(bindings.DB, bindings.WHATSAPP_CREDENTIAL_ENCRYPTION_KEY)
}

function publicConnection(connection: Awaited<ReturnType<D1WhatsAppConnectionRepository['findByPhoneNumberId']>>) {
  if (!connection) return null
  return {
    tenant_id: connection.tenant_id,
    business_id: connection.business_id,
    waba_id: connection.waba_id,
    phone_number_id: connection.phone_number_id,
    display_phone_number: connection.display_phone_number ?? null,
    verified_name: connection.verified_name ?? null,
    status: connection.status,
  }
}

function onboardingError(error: unknown): Response {
  if (error instanceof MetaWhatsAppOnboardingError) {
    const status = error.code === 'WHATSAPP_ONBOARDING_NOT_CONFIGURED'
      ? 503
      : error.code === 'WHATSAPP_ONBOARDING_ASSET_MISMATCH'
        ? 409
        : error.code === 'WHATSAPP_ONBOARDING_PHONE_SELECTION_REQUIRED'
          ? 409
          : error.code === 'WHATSAPP_ONBOARDING_INVALID_INPUT'
            ? 400
            : error.retryable
              ? 503
              : 502
    return json({
      code: error.code,
      retryable: error.retryable,
      provider_code: error.providerCode,
      provider_subcode: error.providerSubcode,
      provider_trace_id: error.providerTraceId,
    }, status)
  }
  if (error instanceof WhatsAppConnectionRepositoryError) {
    return json({ code: error.code }, error.code === 'CONNECTION_CONFLICT' ? 409 : 503)
  }
  if (error instanceof WhatsAppCredentialVaultError) {
    return json({ code: error.code }, 503)
  }
  return json({ code: 'WHATSAPP_ONBOARDING_UNAVAILABLE' }, 503)
}

export async function handleWhatsappOnboardingApiRequest(
  request: Request,
  bindings: Bindings,
  dependencies: WhatsAppOnboardingApiDependencies = {},
): Promise<Response | null> {
  const url = new URL(request.url)
  if (![STATUS_PATH, COMPLETE_PATH, SUBSCRIBE_PATH].includes(url.pathname)) return null
  const getSession = dependencies.getSession || getBetterAuthSession

  try {
    if (request.method === 'GET' && url.pathname === STATUS_PATH) {
      const tenantId = safeId(url.searchParams.get('tenant_id'))
      if (!tenantId) return json({ code: 'INVALID_TENANT_ID' }, 400)
      const actor = await authorizeTenantAdmin(request, bindings, tenantId, getSession)
      if (!actor.ok) return actor.response

      const config = configuration(bindings)
      const connections = bindings.DB
        ? await new D1WhatsAppConnectionRepository(bindings.DB).findByTenantId(tenantId)
        : []
      return json({
        configured: config.configured,
        embedded_signup: config.public,
        connections: connections.map((connection) => publicConnection(connection)),
      })
    }

    if (request.method === 'POST' && url.pathname === COMPLETE_PATH) {
      const payload = await body(request)
      const tenantId = safeId(payload?.tenant_id)
      const code = safeCode(payload?.code)
      const wabaId = numericId(payload?.waba_id)
      const phoneNumberId = payload?.phone_number_id == null ? null : numericId(payload.phone_number_id)
      if (!tenantId || !code || !wabaId || (payload?.phone_number_id != null && !phoneNumberId)) {
        return json({ code: 'INVALID_ONBOARDING_PAYLOAD' }, 400)
      }
      const actor = await authorizeTenantAdmin(request, bindings, tenantId, getSession)
      if (!actor.ok) return actor.response

      const adapter = createOnboardingAdapter(bindings)
      const repository = new D1WhatsAppConnectionRepository(bindings.DB)
      const vault = createVault(bindings)
      const completed = await adapter.complete({ tenantId, code, wabaId, phoneNumberId })
      await repository.save(completed.connection)
      await vault.save({
        tenantId,
        phoneNumberId: completed.connection.phone_number_id,
        accessToken: completed.accessToken,
      })
      await adapter.subscribe(completed.connection.waba_id, completed.accessToken)
      const connected = { ...completed.connection, status: 'connected' as const }
      await repository.save(connected)
      return json({ connection: publicConnection(connected) }, 201)
    }

    if (request.method === 'POST' && url.pathname === SUBSCRIBE_PATH) {
      const payload = await body(request)
      const tenantId = safeId(payload?.tenant_id)
      const phoneNumberId = numericId(payload?.phone_number_id)
      if (!tenantId || !phoneNumberId) return json({ code: 'INVALID_SUBSCRIBE_PAYLOAD' }, 400)
      const actor = await authorizeTenantAdmin(request, bindings, tenantId, getSession)
      if (!actor.ok) return actor.response

      const repository = new D1WhatsAppConnectionRepository(bindings.DB)
      const connection = await repository.findByPhoneNumberId(phoneNumberId)
      if (!connection || connection.tenant_id !== tenantId) return json({ code: 'WHATSAPP_CONNECTION_NOT_FOUND' }, 404)
      const vault = createVault(bindings)
      const credential = await vault.findByPhoneNumberId(tenantId, phoneNumberId)
      if (!credential) return json({ code: 'WHATSAPP_CREDENTIAL_NOT_FOUND' }, 409)
      const adapter = createOnboardingAdapter(bindings)
      await adapter.subscribe(connection.waba_id, credential.accessToken)
      const connected = { ...connection, status: 'connected' as const }
      await repository.save(connected)
      return json({ connection: publicConnection(connected) })
    }

    return json({ code: 'METHOD_NOT_ALLOWED' }, 405)
  } catch (error) {
    return onboardingError(error)
  }
}
