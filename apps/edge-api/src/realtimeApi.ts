import { getBetterAuthSession, type BetterAuthRuntimeBindings } from './auth/betterAuthRuntime'
import type {
  CoordinationDurableObject,
  RealtimeInvalidationEvent,
} from './coordination/coordinationDurableObject'

type RealtimeBindings = BetterAuthRuntimeBindings & {
  DB?: D1Database
  COORDINATOR?: DurableObjectNamespace<CoordinationDurableObject>
}

type AuthSession = Awaited<ReturnType<typeof getBetterAuthSession>>
type SessionResolver = typeof getBetterAuthSession
export type RealtimeApiDependencies = { getSession?: SessionResolver }

type PrincipalRow = {
  id: string
  status: string
}

type MembershipRow = {
  role: string
  status: string
  module_permissions_json: string | null
  tenant_status: string
}

type ModulePermission = true | string | Record<string, unknown>

type Scope = {
  tenantId: string
  moduleId: string
}

const MUTATION_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])
const SCOPE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/
const MODULE_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/
const MAX_SCOPES_PER_INVALIDATION = 64

function json(body: unknown, status = 200, headers?: HeadersInit): Response {
  return Response.json(body, {
    status,
    headers: {
      'cache-control': 'no-store',
      ...Object.fromEntries(new Headers(headers).entries()),
    },
  })
}

function validScopeId(value: unknown): string | null {
  const normalized = String(value ?? '').trim()
  return SCOPE_ID.test(normalized) ? normalized : null
}

function validModuleId(value: unknown): string | null {
  const normalized = String(value ?? '').trim().toLowerCase()
  return MODULE_ID.test(normalized) ? normalized : null
}

function modulePermissionsFromJson(raw: string | null | undefined): Record<string, ModulePermission> {
  try {
    const parsed = JSON.parse(raw || '{}')
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const result: Record<string, ModulePermission> = {}
    for (const [rawModuleId, permission] of Object.entries(parsed as Record<string, unknown>)) {
      const moduleId = validModuleId(rawModuleId)
      if (!moduleId) continue
      if (permission === true) result[moduleId] = true
      else if (typeof permission === 'string' && permission.trim()) result[moduleId] = permission.trim()
      else if (permission && typeof permission === 'object' && !Array.isArray(permission)) {
        result[moduleId] = permission as Record<string, unknown>
      }
    }
    return result
  } catch {
    return {}
  }
}

function hasModuleAccess(row: MembershipRow, moduleId: string): boolean {
  if (row.status !== 'active' || row.tenant_status !== 'active') return false
  if (row.role === 'owner' || row.role === 'admin') return true
  const permissions = modulePermissionsFromJson(row.module_permissions_json)
  return Boolean(permissions[moduleId] ?? permissions['*'])
}

function realtimeObjectName(scope: Scope): string {
  return `realtime:v1:${scope.tenantId.length}:${scope.tenantId}:${scope.moduleId}`
}

async function authorizeRealtimeScope(
  request: Request,
  bindings: RealtimeBindings,
  scope: Scope,
  getSession: SessionResolver,
): Promise<{ principalId: string } | Response> {
  if (!bindings.DB || !bindings.COORDINATOR) return json({ code: 'REALTIME_NOT_CONFIGURED' }, 503)

  const session = await getSession(request, bindings)
  const subject = String(session?.user?.id || '').trim()
  if (!session || !subject) return json({ code: 'UNAUTHENTICATED' }, 401)

  const principal = await bindings.DB.prepare(`
    SELECT id,status
    FROM identity_principals
    WHERE provider='better-auth' AND subject=?1
    LIMIT 1
  `).bind(subject).first<PrincipalRow>()
  if (!principal || principal.status !== 'active') return json({ code: 'FORBIDDEN' }, 403)

  const membership = await bindings.DB.prepare(`
    SELECT m.role,m.status,m.module_permissions_json,t.status AS tenant_status
    FROM tenant_memberships m
    JOIN tenants t ON t.id=m.tenant_id
    WHERE m.tenant_id=?1 AND m.principal_id=?2
    LIMIT 1
  `).bind(scope.tenantId, principal.id).first<MembershipRow>()
  if (!membership || !hasModuleAccess(membership, scope.moduleId)) return json({ code: 'FORBIDDEN' }, 403)

  return { principalId: principal.id }
}

export async function handleRealtimeApiRequest(
  request: Request,
  bindings: RealtimeBindings,
  dependencies: RealtimeApiDependencies = {},
): Promise<Response | null> {
  const url = new URL(request.url)
  if (url.pathname !== '/api/realtime') return null

  if (request.method !== 'GET') return json({ code: 'METHOD_NOT_ALLOWED' }, 405, { allow: 'GET' })
  if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
    return json({ code: 'WEBSOCKET_UPGRADE_REQUIRED' }, 426, { upgrade: 'websocket' })
  }

  const origin = request.headers.get('origin')
  if (origin && origin !== url.origin) return json({ code: 'ORIGIN_FORBIDDEN' }, 403)

  const tenantId = validScopeId(url.searchParams.get('tenant_id'))
  const moduleId = validModuleId(url.searchParams.get('module_id'))
  if (!tenantId || !moduleId) return json({ code: 'INVALID_SCOPE' }, 400)
  const scope = { tenantId, moduleId }

  const authorization = await authorizeRealtimeScope(
    request,
    bindings,
    scope,
    dependencies.getSession || getBetterAuthSession,
  )
  if (authorization instanceof Response) return authorization

  const headers = new Headers()
  headers.set('upgrade', 'websocket')
  headers.set('x-realtime-principal-id', authorization.principalId)
  headers.set('x-realtime-tenant-id', tenantId)
  headers.set('x-realtime-module-id', moduleId)
  const protocol = request.headers.get('sec-websocket-protocol')
  if (protocol) headers.set('sec-websocket-protocol', protocol)

  const stub = bindings.COORDINATOR!.getByName(realtimeObjectName(scope))
  return stub.fetch(new Request('https://realtime.internal/realtime/connect', {
    method: 'GET',
    headers,
  }))
}

async function requestBody(request: Request): Promise<Record<string, unknown>> {
  try {
    const body = await request.json()
    return body && typeof body === 'object' && !Array.isArray(body)
      ? body as Record<string, unknown>
      : {}
  } catch {
    return {}
  }
}

function addTenantIds(target: string[], value: unknown): void {
  if (Array.isArray(value)) {
    for (const item of value) addTenantIds(target, item)
    return
  }
  const tenantId = validScopeId(value)
  if (tenantId && !target.includes(tenantId) && target.length < MAX_SCOPES_PER_INVALIDATION) {
    target.push(tenantId)
  }
}

function addModuleIds(target: string[], value: unknown): void {
  if (Array.isArray(value)) {
    for (const item of value) addModuleIds(target, item)
    return
  }
  const moduleId = validModuleId(value)
  if (moduleId && !target.includes(moduleId) && target.length < MAX_SCOPES_PER_INVALIDATION) {
    target.push(moduleId)
  }
}

function modulesFromProfile(profile: Record<string, unknown>): string[] {
  const modules: string[] = []
  const permissions = profile.module_permissions
  if (permissions && typeof permissions === 'object' && !Array.isArray(permissions)) {
    for (const key of Object.keys(permissions)) addModuleIds(modules, key)
  }
  return modules
}

async function publishRealtimeInvalidations(
  request: Request,
  response: Response,
  bindings: RealtimeBindings,
): Promise<void> {
  if (!bindings.COORDINATOR || !response.ok || !MUTATION_METHODS.has(request.method)) return

  const url = new URL(request.url)
  if (url.pathname === '/api/realtime' || url.pathname.startsWith('/api/auth/') || url.pathname.startsWith('/internal/')) return

  const body = await requestBody(request)
  if (url.pathname === '/api/compat/query' && String(body.action || '').toLowerCase() === 'select') return

  const tenantIds: string[] = []
  const moduleIds: string[] = []

  addTenantIds(tenantIds, request.headers.get('x-tenant-id'))
  addTenantIds(tenantIds, url.searchParams.get('tenant_id'))
  addTenantIds(tenantIds, body.tenantId)
  addTenantIds(tenantIds, body.tenant_id)
  addTenantIds(tenantIds, body.activeTenantId)
  addTenantIds(tenantIds, body.tenantIds)

  addModuleIds(moduleIds, request.headers.get('x-module-id'))
  addModuleIds(moduleIds, url.searchParams.get('module_id'))
  addModuleIds(moduleIds, body.moduleId)
  addModuleIds(moduleIds, body.module_id)
  addModuleIds(moduleIds, body.scopeModuleId)

  if (!tenantIds.length || !moduleIds.length) {
    try {
      const responseBody = await response.clone().json() as Record<string, unknown>
      const profile = responseBody?.profile && typeof responseBody.profile === 'object' && !Array.isArray(responseBody.profile)
        ? responseBody.profile as Record<string, unknown>
        : null
      if (profile) {
        addTenantIds(tenantIds, profile.tenant_ids)
        addTenantIds(tenantIds, profile.active_tenant_id)
        for (const moduleId of modulesFromProfile(profile)) addModuleIds(moduleIds, moduleId)
      }
    } catch {
      // Successful non-JSON responses simply do not provide additional scope hints.
    }
  }

  if (!tenantIds.length || !moduleIds.length) return
  const table = typeof body.table === 'string' && body.table.trim() ? body.table.trim().slice(0, 120) : null
  const source = url.pathname.slice(0, 160)
  const occurredAtMs = Date.now()
  const eventId = crypto.randomUUID()
  const scopes = tenantIds.flatMap((tenantId) => moduleIds.map((moduleId) => ({ tenantId, moduleId })))
    .slice(0, MAX_SCOPES_PER_INVALIDATION)

  await Promise.all(scopes.map(async (scope) => {
    const event: RealtimeInvalidationEvent = {
      type: 'realtime.invalidate',
      eventId,
      schema: 'edge',
      eventType: 'SYNC',
      table,
      tenantId: scope.tenantId,
      moduleId: scope.moduleId,
      source,
      occurredAtMs,
    }
    try {
      const stub = bindings.COORDINATOR!.getByName(realtimeObjectName(scope))
      await stub.publishRealtime(event)
    } catch (error) {
      console.error(JSON.stringify({
        event: 'edge.realtime.publish_failed',
        tenant_id: scope.tenantId,
        module_id: scope.moduleId,
        source,
        message: error instanceof Error ? error.message : String(error),
      }))
    }
  }))
}

export function scheduleRealtimeInvalidation(
  request: Request,
  response: Response,
  bindings: RealtimeBindings,
  context: ExecutionContext,
): void {
  if (!response.ok || !MUTATION_METHODS.has(request.method) || !bindings.COORDINATOR) return
  context.waitUntil(publishRealtimeInvalidations(request, response, bindings))
}
