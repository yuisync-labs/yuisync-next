import { getBetterAuthSession, type BetterAuthRuntimeBindings } from './auth/betterAuthRuntime'

type AppApiBindings = BetterAuthRuntimeBindings & { DB?: D1Database }

type PrincipalRow = {
  id: string
  display_name: string | null
  email: string | null
  status: string
}

type MembershipRow = {
  tenant_id: string
  role: string
  module_permissions_json: string
  tenant_name: string
  tenant_slug: string
  tenant_status: string
}

type DirectoryMembershipRow = {
  role: string
  status: string
  module_permissions_json: string | null
  tenant_status: string
}

type ManagedUserRow = {
  principal_id: string
  display_name: string | null
  email: string | null
  principal_status: string
  membership_role: string
  membership_status: string
}

type ModulePermission = true | string | Record<string, unknown>
type AuthSession = Awaited<ReturnType<typeof getBetterAuthSession>>
type SessionResolver = typeof getBetterAuthSession
export type AppApiDependencies = { getSession?: SessionResolver }
type PrincipalResolution =
  | { ok: true; session: NonNullable<AuthSession>; principal: PrincipalRow }
  | { ok: false; error: Response }

function json(body: unknown, status = 200, headers?: HeadersInit): Response {
  return Response.json(body, {
    status,
    headers: { 'cache-control': 'no-store', ...Object.fromEntries(new Headers(headers).entries()) },
  })
}

function validId(value: unknown, max = 160): string | null {
  const normalized = String(value ?? '').trim()
  return normalized && normalized.length <= max ? normalized : null
}

function validModule(value: unknown): string | null {
  const normalized = String(value ?? '').trim().toLowerCase()
  return /^[a-z0-9][a-z0-9_-]{0,63}$/.test(normalized) ? normalized : null
}

function slugify(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 96)
}

async function resolvePrincipal(
  request: Request,
  bindings: AppApiBindings,
  getSession: SessionResolver = getBetterAuthSession,
): Promise<PrincipalResolution> {
  if (!bindings.DB) return { ok: false, error: json({ code: 'DATABASE_NOT_CONFIGURED' }, 503) }
  const session = await getSession(request, bindings)
  const userId = validId(session?.user?.id, 255)
  if (!session || !userId) return { ok: false, error: json({ code: 'UNAUTHENTICATED' }, 401) }

  const principal = await bindings.DB.prepare(`
    SELECT id, display_name, email, status
    FROM identity_principals
    WHERE provider = 'better-auth' AND subject = ?1
    LIMIT 1
  `).bind(userId).first<PrincipalRow>()

  if (!principal || principal.status !== 'active') {
    return { ok: false, error: json({ code: 'FORBIDDEN' }, 403) }
  }
  return { ok: true, session, principal }
}

async function memberships(database: D1Database, principalId: string): Promise<MembershipRow[]> {
  const result = await database.prepare(`
    SELECT m.tenant_id, m.role, m.module_permissions_json,
           t.name AS tenant_name, t.slug AS tenant_slug, t.status AS tenant_status
    FROM tenant_memberships m
    JOIN tenants t ON t.id = m.tenant_id
    WHERE m.principal_id = ?1 AND m.status = 'active' AND t.status = 'active'
    ORDER BY t.name, t.id
  `).bind(principalId).all<MembershipRow>()
  return result.results
}

function modulePermissionsFromJson(raw: string | null | undefined): Record<string, ModulePermission> {
  try {
    const parsed = JSON.parse(raw || '{}')
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}

    const permissions: Record<string, ModulePermission> = {}
    for (const [rawModuleId, rawPermission] of Object.entries(parsed)) {
      const moduleId = validModule(rawModuleId)
      if (!moduleId) continue
      if (rawPermission === true) {
        permissions[moduleId] = true
        continue
      }
      if (typeof rawPermission === 'string' && rawPermission.trim()) {
        permissions[moduleId] = rawPermission.trim()
        continue
      }
      if (rawPermission && typeof rawPermission === 'object' && !Array.isArray(rawPermission)) {
        permissions[moduleId] = rawPermission as Record<string, unknown>
      }
    }
    return permissions
  } catch {
    return {}
  }
}

function modulePermissionsFor(row: MembershipRow): Record<string, ModulePermission> {
  return modulePermissionsFromJson(row.module_permissions_json)
}

function modulesFor(row: MembershipRow): string[] {
  const permissions = modulePermissionsFor(row)
  const modules = Object.keys(permissions)
  return modules.length ? modules : ['petshop']
}

function hasModuleAccess(row: DirectoryMembershipRow, moduleId: string): boolean {
  if (row.role === 'owner' || row.role === 'admin') return true
  const permissions = modulePermissionsFromJson(row.module_permissions_json)
  return Boolean(permissions[moduleId] ?? permissions['*'])
}

function operationalRole(tenantRole: string): 'admin' | 'employee' {
  return tenantRole === 'owner' || tenantRole === 'admin' ? 'admin' : 'employee'
}

function staffType(tenantRole: string): 'gerente' | 'funcionario' {
  return tenantRole === 'owner' || tenantRole === 'admin' || tenantRole === 'manager'
    ? 'gerente'
    : 'funcionario'
}

async function bootstrap(request: Request, bindings: AppApiBindings): Promise<Response> {
  const resolved = await resolvePrincipal(request, bindings)
  if (!resolved.ok) return resolved.error
  const rows = await memberships(bindings.DB!, resolved.principal.id)
  return json({
    session: resolved.session,
    profile: {
      id: resolved.principal.id,
      user_id: resolved.session.user.id,
      name: resolved.principal.display_name || resolved.session.user.name || '',
      email: resolved.principal.email || resolved.session.user.email || '',
      active: true,
    },
    tenants: rows.map((row) => ({
      id: row.tenant_id,
      name: row.tenant_name,
      slug: row.tenant_slug,
      role: row.role,
      enabled_modules: modulesFor(row),
      module_permissions: modulePermissionsFor(row),
    })),
  })
}

async function settings(request: Request, bindings: AppApiBindings): Promise<Response> {
  const resolved = await resolvePrincipal(request, bindings)
  if (!resolved.ok) return resolved.error
  const url = new URL(request.url)
  const tenantId = validId(url.searchParams.get('tenant_id'))
  const moduleId = validModule(url.searchParams.get('module_id'))
  if (!tenantId || !moduleId) return json({ code: 'INVALID_SCOPE' }, 400)

  const membership = await bindings.DB!.prepare(`
    SELECT 1 FROM tenant_memberships m JOIN tenants t ON t.id=m.tenant_id
    WHERE m.tenant_id=?1 AND m.principal_id=?2 AND m.status='active' AND t.status='active'
  `).bind(tenantId, resolved.principal.id).first()
  if (!membership) return json({ code: 'FORBIDDEN' }, 403)

  const row = await bindings.DB!.prepare(`
    SELECT store_name, store_phone, store_address, store_neighborhood, store_city,
           bot_prompt, version, updated_at_ms
    FROM tenant_module_settings WHERE tenant_id=?1 AND module_id=?2
  `).bind(tenantId, moduleId).first()
  if (!row) return json({ code: 'SETTINGS_NOT_FOUND' }, 404)
  return json({ tenant_id: tenantId, module_id: moduleId, settings: row })
}

async function managedUsers(
  request: Request,
  bindings: AppApiBindings,
  dependencies: AppApiDependencies,
): Promise<Response> {
  const resolved = await resolvePrincipal(request, bindings, dependencies.getSession)
  if (!resolved.ok) return resolved.error

  const url = new URL(request.url)
  const tenantId = validId(url.searchParams.get('tenant_id'))
  const moduleId = validModule(url.searchParams.get('module_id'))
  if (!tenantId || !moduleId) return json({ code: 'INVALID_SCOPE' }, 400)

  const membership = await bindings.DB!.prepare(`
    SELECT m.role, m.status, m.module_permissions_json, t.status AS tenant_status
    FROM tenant_memberships m
    JOIN tenants t ON t.id = m.tenant_id
    WHERE m.tenant_id = ?1 AND m.principal_id = ?2
    LIMIT 1
  `).bind(tenantId, resolved.principal.id).first<DirectoryMembershipRow>()

  if (
    !membership
    || membership.status !== 'active'
    || membership.tenant_status !== 'active'
    || !hasModuleAccess(membership, moduleId)
  ) {
    return json({ code: 'FORBIDDEN' }, 403)
  }

  const result = await bindings.DB!.prepare(`
    SELECT p.id AS principal_id,
           p.display_name,
           p.email,
           p.status AS principal_status,
           m.role AS membership_role,
           m.status AS membership_status
    FROM tenant_memberships m
    JOIN identity_principals p ON p.id = m.principal_id
    WHERE m.tenant_id = ?1
    ORDER BY COALESCE(NULLIF(TRIM(p.display_name), ''), p.email, p.id), p.id
  `).bind(tenantId).all<ManagedUserRow>()

  return json({
    profiles: result.results.map((row) => ({
      id: row.principal_id,
      full_name: row.display_name || row.email || '',
      email: row.email || '',
      role: operationalRole(row.membership_role),
      active: row.membership_status === 'active' && row.principal_status === 'active',
      staff_type: staffType(row.membership_role),
    })),
  })
}

async function createTenant(request: Request, bindings: AppApiBindings, dependencies: AppApiDependencies): Promise<Response> {
  const resolved = await resolvePrincipal(request, bindings, dependencies.getSession)
  if (!resolved.ok) return resolved.error
  const access = await bindings.DB!.prepare(`SELECT 1 FROM tenant_memberships m JOIN tenants t ON t.id=m.tenant_id
    WHERE m.principal_id=?1 AND m.status='active' AND t.status='active' AND m.role IN ('owner','admin') LIMIT 1`)
    .bind(resolved.principal.id).first()
  if (!access) return json({ code: 'FORBIDDEN' }, 403)
  const operationKey = request.headers.get('idempotency-key') || ''
  if (!/^[A-Za-z0-9_-]{16,100}$/.test(operationKey)) return json({ code: 'IDEMPOTENCY_KEY_REQUIRED' }, 400)
  let body: { name?: unknown } = {}
  try { body = await request.json() as { name?: unknown } } catch { return json({ code: 'INVALID_JSON' }, 400) }
  const name = String(body.name ?? '').trim()
  if (!name || name.length > 160) return json({ code: 'INVALID_NAME' }, 400)

  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${resolved.principal.id}:${operationKey}`))
  const id = `tenant-${Array.from(new Uint8Array(digest)).map(byte => byte.toString(16).padStart(2, '0')).join('')}`
  const slugBase = slugify(name) || `tenant-${id.slice(0, 8)}`
  const slug = `${slugBase}-${id.slice(-12)}`
  const now = Date.now()
  const existing = await bindings.DB!.prepare('SELECT name,slug FROM tenants WHERE id=?1').bind(id).first<{ name: string; slug: string }>()
  if (existing && existing.name !== name) return json({ code: 'IDEMPOTENCY_CONFLICT' }, 409)
  if (existing) return json({ id, name: existing.name, slug: existing.slug, role: 'owner', enabled_modules: ['petshop'], module_permissions: { petshop: { role: 'admin_pet' } } })
  await bindings.DB!.batch([
    bindings.DB!.prepare(`INSERT INTO tenants(id,slug,name,status,created_at_ms,updated_at_ms) VALUES(?1,?2,?3,'active',?4,?4) ON CONFLICT(id) DO NOTHING`)
      .bind(id, slug, name, now),
    bindings.DB!.prepare(`INSERT INTO tenant_memberships(tenant_id,principal_id,status,created_at_ms,updated_at_ms,role,module_permissions_json) VALUES(?1,?2,'active',?3,?3,'owner','{"petshop":{"role":"admin_pet"}}') ON CONFLICT DO NOTHING`)
      .bind(id, resolved.principal.id, now),
    bindings.DB!.prepare(`INSERT INTO tenant_module_settings(tenant_id,module_id,store_name,created_at_ms,updated_at_ms) VALUES(?1,'petshop',?2,?3,?3) ON CONFLICT DO NOTHING`)
      .bind(id, name, now),
    bindings.DB!.prepare(`INSERT INTO module_settings_extensions(tenant_id,module_id,data_json,updated_at_ms) VALUES(?1,'petshop',?2,?3) ON CONFLICT DO NOTHING`)
      .bind(id, JSON.stringify({ veterinary_name: 'Veterinário responsável', petshop_operational_staff: [], petshop_delivery_staff: [], message_templates: { __petshop_operational_staff: [], __petshop_delivery_staff: [] } }), now),
  ])
  const saved = await bindings.DB!.prepare('SELECT name FROM tenants WHERE id=?1').bind(id).first<{ name: string }>()
  if (saved?.name !== name) return json({ code: 'IDEMPOTENCY_CONFLICT' }, 409)
  return json({ id, name, slug, role: 'owner', enabled_modules: ['petshop'], module_permissions: { petshop: { role: 'admin_pet' } } }, 201)
}

export async function handleAppApiRequest(
  request: Request,
  bindings: AppApiBindings,
  dependencies: AppApiDependencies = {},
): Promise<Response | null> {
  const { pathname } = new URL(request.url)
  if (pathname === '/api/app/bootstrap' && request.method === 'GET') return bootstrap(request, bindings)
  if (pathname === '/api/app/settings' && request.method === 'GET') return settings(request, bindings)
  if (pathname === '/api/app/tenants' && request.method === 'POST') return createTenant(request, bindings, dependencies)
  if (pathname === '/api/admin/users' && request.method === 'GET') return managedUsers(request, bindings, dependencies)
  if (pathname === '/api/admin/users') return json({ code: 'METHOD_NOT_ALLOWED' }, 405, { allow: 'GET' })
  if (pathname.startsWith('/api/app/')) return json({ code: 'NOT_FOUND' }, 404)
  return null
}
