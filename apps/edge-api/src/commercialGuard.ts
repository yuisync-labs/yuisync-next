import { getBetterAuthSession, type BetterAuthRuntimeBindings } from './auth/betterAuthRuntime'
import { resolveCommercialEntitlement } from './commercialControlPlane'

type Bindings = BetterAuthRuntimeBindings & { DB?: D1Database }

type UserMutationPayload = {
  tenantIds?: unknown
  activeTenantId?: unknown
  tenant_id?: unknown
  tenantId?: unknown
}

function json(body: unknown, status = 403): Response {
  return Response.json(body, { status, headers: { 'cache-control': 'no-store' } })
}

function safeId(value: unknown, max = 160): string {
  const normalized = String(value ?? '').trim()
  return normalized && normalized.length <= max ? normalized : ''
}

function tenantIdsFromPayload(payload: UserMutationPayload): string[] {
  if (Array.isArray(payload.tenantIds)) {
    return [...new Set(payload.tenantIds.map((value) => safeId(value)).filter(Boolean))]
  }
  const single = safeId(payload.activeTenantId ?? payload.tenant_id ?? payload.tenantId)
  return single ? [single] : []
}

async function body(request: Request): Promise<UserMutationPayload> {
  try {
    const parsed = await request.clone().json()
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as UserMutationPayload
      : {}
  } catch {
    return {}
  }
}

async function authenticatedTenantMembership(
  request: Request,
  bindings: Bindings,
  tenantId: string,
): Promise<boolean> {
  if (!bindings.DB || !bindings.AUTH_DB || !tenantId) return false
  const session = await getBetterAuthSession(request, bindings)
  const subject = safeId(session?.user?.id, 255)
  if (!subject) return false
  const row = await bindings.DB.prepare(`
    SELECT 1
    FROM identity_principals p
    JOIN tenant_memberships m ON m.principal_id=p.id
    JOIN tenants t ON t.id=m.tenant_id
    WHERE p.provider='better-auth' AND p.subject=?1 AND p.status='active'
      AND m.tenant_id=?2 AND m.status='active' AND t.status='active'
    LIMIT 1
  `).bind(subject, tenantId).first()
  return Boolean(row)
}

async function activeUserCount(database: D1Database, tenantId: string): Promise<number> {
  const row = await database.prepare(`
    SELECT COUNT(DISTINCT m.principal_id) AS total
    FROM tenant_memberships m
    JOIN identity_principals p ON p.id=m.principal_id
    WHERE m.tenant_id=?1 AND m.status='active' AND p.status='active'
  `).bind(tenantId).first<{ total: number }>()
  return Number(row?.total || 0)
}

async function targetAlreadyBelongs(
  database: D1Database,
  tenantId: string,
  principalId: string,
): Promise<boolean> {
  if (!principalId) return false
  const row = await database.prepare(`
    SELECT 1 FROM tenant_memberships
    WHERE tenant_id=?1 AND principal_id=?2 AND status='active'
    LIMIT 1
  `).bind(tenantId, principalId).first()
  return Boolean(row)
}

async function enforceUserLimit(
  request: Request,
  bindings: Bindings,
  targetPrincipalId = '',
): Promise<Response | null> {
  if (!bindings.DB) return null
  const payload = await body(request)
  const tenantIds = tenantIdsFromPayload(payload)
  if (!tenantIds.length) return null

  for (const tenantId of tenantIds) {
    if (!await authenticatedTenantMembership(request, bindings, tenantId)) return null
    const entitlement = await resolveCommercialEntitlement(bindings.DB, tenantId, 'users.max')
    if (!entitlement.enabled || entitlement.quota == null) continue
    if (await targetAlreadyBelongs(bindings.DB, tenantId, targetPrincipalId)) continue
    const current = await activeUserCount(bindings.DB, tenantId)
    if (current >= entitlement.quota) {
      return json({
        code: 'PLAN_LIMIT_REACHED',
        entitlement: 'users.max',
        limit: entitlement.quota,
        current,
        tenant_id: tenantId,
      }, 409)
    }
  }
  return null
}

async function tenantFromRequest(request: Request): Promise<string> {
  const url = new URL(request.url)
  const fromHeader = safeId(request.headers.get('x-tenant-id'))
  const fromQuery = safeId(url.searchParams.get('tenant_id') ?? url.searchParams.get('tenantId'))
  if (fromHeader || fromQuery) return fromHeader || fromQuery
  const payload = await body(request)
  return safeId(payload.tenant_id ?? payload.tenantId ?? payload.activeTenantId)
}

async function enforceFeature(
  request: Request,
  bindings: Bindings,
  entitlementKey: string,
): Promise<Response | null> {
  if (!bindings.DB) return null
  const tenantId = await tenantFromRequest(request)
  if (!tenantId || !await authenticatedTenantMembership(request, bindings, tenantId)) return null
  const entitlement = await resolveCommercialEntitlement(bindings.DB, tenantId, entitlementKey)
  if (entitlement.enabled) return null
  return json({
    code: 'PLAN_FEATURE_NOT_INCLUDED',
    entitlement: entitlementKey,
    tenant_id: tenantId,
  }, 403)
}

export async function enforceCommercialRequest(
  request: Request,
  bindings: Bindings,
): Promise<Response | null> {
  const { pathname } = new URL(request.url)

  if (pathname === '/api/admin/users' && request.method === 'POST') {
    return enforceUserLimit(request, bindings)
  }

  const managedUser = /^\/api\/admin\/users\/([^/]+)$/.exec(pathname)
  if (managedUser && request.method === 'PATCH') {
    return enforceUserLimit(request, bindings, safeId(decodeURIComponent(managedUser[1])))
  }

  if (pathname === '/api/whatsapp/send' && request.method === 'POST') {
    return enforceFeature(request, bindings, 'whatsapp.official')
  }

  if (pathname.startsWith('/api/fiscal/')) {
    return enforceFeature(request, bindings, 'fiscal.enabled')
  }

  return null
}
