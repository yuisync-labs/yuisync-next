import { hash } from 'bcryptjs'

import { getBetterAuthSession, type BetterAuthRuntimeBindings } from './auth/betterAuthRuntime'

type Bindings = BetterAuthRuntimeBindings & { DB?: D1Database }
type AuthSession = Awaited<ReturnType<typeof getBetterAuthSession>>
type SessionResolver = typeof getBetterAuthSession
export type ManagedUsersDependencies = { getSession?: SessionResolver }

type PrincipalRow = {
  id: string
  subject: string
  display_name: string | null
  email: string | null
  status: string
}

type MembershipRow = {
  tenant_id: string
  role: string
  status: string
  module_permissions_json: string
  tenant_status: string
}

type TargetMembershipRow = MembershipRow & {
  principal_id: string
  tenant_name: string
  tenant_slug: string
}

type ManagedProfileRow = {
  principal_id: string
  staff_type: string
  preferred_tenant_id: string | null
}

type AuthUserRow = { id: string; name: string; updatedAt: number | string }
type AuthAccountRow = { id: string; password: string | null; updatedAt: number | string }

type ActorResolution =
  | { ok: true; session: NonNullable<AuthSession>; principal: PrincipalRow; memberships: MembershipRow[] }
  | { ok: false; error: Response }

type StaffType = 'funcionario' | 'banho_tosa' | 'veterinaria' | 'motodog' | 'vendedor_caixa' | 'gerente'

type ManagedPayload = {
  fullName: string
  email: string | null
  password: string | null
  role: 'admin' | 'employee'
  staffType: StaffType
  permissions: Record<string, string>
  scopeModuleId: string
  tenantIds: string[]
  activeTenantId: string
}

const STAFF_TYPES = new Set<StaffType>(['funcionario', 'banho_tosa', 'veterinaria', 'motodog', 'vendedor_caixa', 'gerente'])
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const TEMP_PASSWORD = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{12,128}$/
const BCRYPT_MAX_BYTES = 72
const BCRYPT_ROUNDS = 12
const MAX_TENANTS_PER_USER = 64

function json(body: unknown, status = 200, headers?: HeadersInit): Response {
  const finalHeaders = new Headers(headers)
  finalHeaders.set('cache-control', 'no-store')
  return Response.json(body, { status, headers: finalHeaders })
}

function safeId(value: unknown, max = 160): string | null {
  const normalized = String(value ?? '').trim()
  return normalized && normalized.length <= max ? normalized : null
}

function safeModuleId(value: unknown): string | null {
  const normalized = String(value ?? '').trim().toLowerCase()
  return /^[a-z0-9][a-z0-9_-]{0,63}$/.test(normalized) ? normalized : null
}

function safeEmail(value: unknown): string | null {
  const normalized = String(value ?? '').trim().toLowerCase()
  return normalized.length <= 320 && EMAIL.test(normalized) ? normalized : null
}

function safeName(value: unknown): string | null {
  const normalized = String(value ?? '').trim()
  return normalized && normalized.length <= 160 ? normalized : null
}

function safePassword(value: unknown, required: boolean): string | null | undefined {
  if (value == null || String(value).trim() === '') return required ? undefined : null
  const password = String(value).trim()
  if (!TEMP_PASSWORD.test(password)) return undefined
  return new TextEncoder().encode(password).byteLength <= BCRYPT_MAX_BYTES ? password : undefined
}

function parsePermissions(raw: string | null | undefined): Record<string, string> {
  try {
    const parsed = JSON.parse(raw || '{}')
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const result: Record<string, string> = {}
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      const moduleId = safeModuleId(key)
      if (!moduleId) continue
      if (typeof value === 'string' && value.trim()) {
        result[moduleId] = value.trim().slice(0, 80)
        continue
      }
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        const role = (value as Record<string, unknown>).role
        if (typeof role === 'string' && role.trim()) result[moduleId] = role.trim().slice(0, 80)
      }
    }
    return result
  } catch {
    return {}
  }
}

function normalizePermissions(value: unknown): Record<string, string> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const result: Record<string, string> = {}
  for (const [key, valueRole] of Object.entries(value as Record<string, unknown>)) {
    const moduleId = safeModuleId(key)
    const role = typeof valueRole === 'string' ? valueRole.trim() : ''
    if (!moduleId || !role || role.length > 80) return null
    result[moduleId] = role
  }
  return result
}

function storedPermissions(permissions: Record<string, string>): string {
  return JSON.stringify(Object.fromEntries(Object.entries(permissions).map(([moduleId, role]) => [moduleId, { role }])))
}

function membershipPermission(row: MembershipRow, moduleId: string): string {
  return parsePermissions(row.module_permissions_json)[moduleId] || ''
}

function isTenantAdmin(row: MembershipRow | undefined): boolean {
  return Boolean(row && row.status === 'active' && row.tenant_status === 'active' && (row.role === 'owner' || row.role === 'admin'))
}

function canManageUsers(row: MembershipRow | undefined, moduleId: string): boolean {
  if (!row || row.status !== 'active' || row.tenant_status !== 'active') return false
  return isTenantAdmin(row) || membershipPermission(row, moduleId).startsWith('admin_')
}

function uniqueIds(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null
  const result: string[] = []
  for (const raw of value) {
    const id = safeId(raw)
    if (!id) return null
    if (!result.includes(id)) result.push(id)
  }
  return result.length > 0 && result.length <= MAX_TENANTS_PER_USER ? result : null
}

function safeStaffType(value: unknown): StaffType | null {
  const normalized = String(value ?? 'funcionario').trim() as StaffType
  return STAFF_TYPES.has(normalized) ? normalized : null
}

async function parsePayload(request: Request, create: boolean): Promise<ManagedPayload | Response> {
  let body: Record<string, unknown>
  try {
    body = await request.json() as Record<string, unknown>
  } catch {
    return json({ code: 'INVALID_JSON' }, 400)
  }

  const fullName = safeName(body.full_name)
  const role = body.role === 'admin' || body.role === 'employee' ? body.role : null
  const staffType = role === 'admin' ? 'gerente' : safeStaffType(body.staff_type)
  const permissions = normalizePermissions(body.permissions)
  const scopeModuleId = safeModuleId(body.scopeModuleId)
  const tenantIds = uniqueIds(body.tenantIds)
  const activeTenantId = safeId(body.activeTenantId)
  const email = create ? safeEmail(body.email) : null
  const password = safePassword(body.password, create)

  if (!fullName) return json({ code: 'INVALID_NAME' }, 400)
  if (!role) return json({ code: 'INVALID_ROLE' }, 400)
  if (!staffType) return json({ code: 'INVALID_STAFF_TYPE' }, 400)
  if (!permissions) return json({ code: 'INVALID_PERMISSIONS' }, 400)
  if (!scopeModuleId || !tenantIds || !activeTenantId || !tenantIds.includes(activeTenantId)) {
    return json({ code: 'INVALID_TENANT_SCOPE' }, 400)
  }
  if (role === 'employee' && Object.keys(permissions).length === 0) {
    return json({ code: 'EMPLOYEE_PERMISSION_REQUIRED' }, 400)
  }
  if (create && !email) return json({ code: 'INVALID_EMAIL' }, 400)
  if (password === undefined) return json({ code: 'INVALID_PASSWORD' }, 400)

  return { fullName, email, password, role, staffType, permissions, scopeModuleId, tenantIds, activeTenantId }
}

async function resolveActor(request: Request, bindings: Bindings, getSession: SessionResolver): Promise<ActorResolution> {
  if (!bindings.DB || !bindings.AUTH_DB) return { ok: false, error: json({ code: 'DATABASE_NOT_CONFIGURED' }, 503) }
  const session = await getSession(request, bindings)
  const userId = safeId(session?.user?.id, 255)
  if (!session || !userId) return { ok: false, error: json({ code: 'UNAUTHENTICATED' }, 401) }

  const principal = await bindings.DB.prepare(`
    SELECT id,subject,display_name,email,status
    FROM identity_principals
    WHERE provider='better-auth' AND subject=?1
    LIMIT 1
  `).bind(userId).first<PrincipalRow>()
  if (!principal || principal.status !== 'active') return { ok: false, error: json({ code: 'FORBIDDEN' }, 403) }

  const result = await bindings.DB.prepare(`
    SELECT m.tenant_id,m.role,m.status,m.module_permissions_json,t.status AS tenant_status
    FROM tenant_memberships m
    JOIN tenants t ON t.id=m.tenant_id
    WHERE m.principal_id=?1
    ORDER BY m.tenant_id
  `).bind(principal.id).all<MembershipRow>()

  return { ok: true, session, principal, memberships: result.results || [] }
}

function byTenant(rows: MembershipRow[]): Map<string, MembershipRow> {
  return new Map(rows.map((row) => [row.tenant_id, row]))
}

function authorizeDesiredScope(actorRows: MembershipRow[], payload: ManagedPayload): Response | null {
  const memberships = byTenant(actorRows)
  for (const tenantId of payload.tenantIds) {
    const actorRow = memberships.get(tenantId)
    if (!canManageUsers(actorRow, payload.scopeModuleId)) return json({ code: 'FORBIDDEN' }, 403)
    if (payload.role === 'admin' && !isTenantAdmin(actorRow)) return json({ code: 'ADMIN_ESCALATION_FORBIDDEN' }, 403)
    if (!isTenantAdmin(actorRow)) {
      if (payload.tenantIds.length !== 1) return json({ code: 'CROSS_TENANT_ADMIN_REQUIRED' }, 403)
      if (Object.keys(payload.permissions).some((key) => key !== payload.scopeModuleId)) {
        return json({ code: 'CROSS_MODULE_ADMIN_REQUIRED' }, 403)
      }
      const requestedRole = payload.permissions[payload.scopeModuleId] || ''
      const currentRole = membershipPermission(actorRow!, payload.scopeModuleId)
      if (requestedRole.startsWith('admin_') && requestedRole !== currentRole) {
        return json({ code: 'ADMIN_DELEGATION_FORBIDDEN' }, 403)
      }
    }
  }
  return null
}

function membershipRole(payload: ManagedPayload): 'admin' | 'manager' | 'staff' {
  if (payload.role === 'admin') return 'admin'
  return payload.staffType === 'gerente' ? 'manager' : 'staff'
}

function placeholders(count: number): string {
  return Array.from({ length: count }, (_, index) => `?${index + 1}`).join(',')
}

async function targetMemberships(database: D1Database, principalId: string): Promise<TargetMembershipRow[]> {
  const result = await database.prepare(`
    SELECT m.principal_id,m.tenant_id,m.role,m.status,m.module_permissions_json,
           t.name AS tenant_name,t.slug AS tenant_slug,t.status AS tenant_status
    FROM tenant_memberships m
    JOIN tenants t ON t.id=m.tenant_id
    WHERE m.principal_id=?1
    ORDER BY t.name,t.id
  `).bind(principalId).all<TargetMembershipRow>()
  return result.results || []
}

function operationalRole(rows: TargetMembershipRow[]): 'admin' | 'employee' {
  return rows.some((row) => row.role === 'owner' || row.role === 'admin') ? 'admin' : 'employee'
}

function aggregatePermissions(rows: TargetMembershipRow[]): Record<string, string> {
  const result: Record<string, string> = {}
  for (const row of rows) Object.assign(result, parsePermissions(row.module_permissions_json))
  return result
}

async function managedProfile(database: D1Database, principalId: string): Promise<ManagedProfileRow | null> {
  return database.prepare(`
    SELECT principal_id,staff_type,preferred_tenant_id
    FROM managed_user_profiles
    WHERE principal_id=?1
    LIMIT 1
  `).bind(principalId).first<ManagedProfileRow>()
}

async function renderProfile(database: D1Database, principal: PrincipalRow, visibleTenantIds?: Set<string>) {
  const allRows = await targetMemberships(database, principal.id)
  const rows = visibleTenantIds ? allRows.filter((row) => visibleTenantIds.has(row.tenant_id)) : allRows
  const profile = await managedProfile(database, principal.id)
  const fallbackStaff = rows.some((row) => ['owner', 'admin', 'manager'].includes(row.role)) ? 'gerente' : 'funcionario'
  const preferred = profile?.preferred_tenant_id && rows.some((row) => row.tenant_id === profile.preferred_tenant_id)
    ? profile.preferred_tenant_id
    : (rows[0]?.tenant_id || null)

  return {
    id: principal.id,
    full_name: principal.display_name || principal.email || '',
    email: principal.email || '',
    role: operationalRole(rows),
    active: principal.status === 'active' && rows.some((row) => row.status === 'active' && row.tenant_status === 'active'),
    staff_type: profile?.staff_type || fallbackStaff,
    module_permissions: aggregatePermissions(rows),
    tenant_ids: rows.map((row) => row.tenant_id),
    active_tenant_id: preferred,
    tenants: rows.map((row) => ({
      id: row.tenant_id,
      name: row.tenant_name,
      slug: row.tenant_slug,
      role: row.role,
      active: row.status === 'active' && row.tenant_status === 'active',
      module_permissions: parsePermissions(row.module_permissions_json),
    })),
  }
}

function audit(
  database: D1Database,
  actorPrincipalId: string,
  targetPrincipalId: string,
  tenantId: string | null,
  action: string,
  metadata: Record<string, unknown>,
  now: number,
): D1PreparedStatement {
  return database.prepare(`
    INSERT INTO admin_audit_events(id,tenant_id,actor_principal_id,target_principal_id,action,metadata_json,created_at_ms)
    VALUES(?1,?2,?3,?4,?5,?6,?7)
  `).bind(crypto.randomUUID(), tenantId, actorPrincipalId, targetPrincipalId, action, JSON.stringify(metadata), now)
}

async function listUsers(request: Request, bindings: Bindings, dependencies: ManagedUsersDependencies): Promise<Response> {
  const actor = await resolveActor(request, bindings, dependencies.getSession || getBetterAuthSession)
  if (!actor.ok) return actor.error

  const url = new URL(request.url)
  const requestedTenantId = safeId(url.searchParams.get('tenant_id'))
  const requestedModuleId = safeModuleId(url.searchParams.get('module_id'))
  let visibleTenantIds: string[]

  if (requestedTenantId || requestedModuleId) {
    if (!requestedTenantId || !requestedModuleId) return json({ code: 'INVALID_SCOPE' }, 400)
    if (!canManageUsers(byTenant(actor.memberships).get(requestedTenantId), requestedModuleId)) return json({ code: 'FORBIDDEN' }, 403)
    visibleTenantIds = [requestedTenantId]
  } else {
    visibleTenantIds = actor.memberships.filter(isTenantAdmin).map((row) => row.tenant_id)
    if (!visibleTenantIds.length) return json({ code: 'FORBIDDEN' }, 403)
  }

  const result = await bindings.DB!.prepare(`
    SELECT DISTINCT p.id,p.subject,p.display_name,p.email,p.status
    FROM identity_principals p
    JOIN tenant_memberships m ON m.principal_id=p.id
    WHERE m.tenant_id IN (${placeholders(visibleTenantIds.length)})
    ORDER BY COALESCE(NULLIF(TRIM(p.display_name),''),p.email,p.id),p.id
  `).bind(...visibleTenantIds).all<PrincipalRow>()

  const visible = new Set(visibleTenantIds)
  const profiles = await Promise.all((result.results || []).map((principal) => renderProfile(bindings.DB!, principal, visible)))
  return json({ profiles })
}

async function createUser(request: Request, bindings: Bindings, dependencies: ManagedUsersDependencies): Promise<Response> {
  const actor = await resolveActor(request, bindings, dependencies.getSession || getBetterAuthSession)
  if (!actor.ok) return actor.error
  const payload = await parsePayload(request, true)
  if (payload instanceof Response) return payload
  const authorizationError = authorizeDesiredScope(actor.memberships, payload)
  if (authorizationError) return authorizationError

  const existing = await bindings.AUTH_DB!.prepare('SELECT id FROM user WHERE lower(email)=?1 LIMIT 1').bind(payload.email).first()
  if (existing) return json({ code: 'EMAIL_ALREADY_EXISTS' }, 409)

  const now = Date.now()
  const userId = crypto.randomUUID()
  const principalId = crypto.randomUUID()
  const passwordHash = await hash(payload.password!, BCRYPT_ROUNDS)
  const permissions = storedPermissions(payload.permissions)
  const role = membershipRole(payload)

  try {
    await bindings.AUTH_DB!.batch([
      bindings.AUTH_DB!.prepare(`
        INSERT INTO user(id,name,email,emailVerified,image,createdAt,updatedAt)
        VALUES(?1,?2,?3,1,NULL,?4,?4)
      `).bind(userId, payload.fullName, payload.email, now),
      bindings.AUTH_DB!.prepare(`
        INSERT INTO account(id,userId,accountId,providerId,password,createdAt,updatedAt)
        VALUES(?1,?2,?2,'credential',?3,?4,?4)
      `).bind(`credential:${userId}`, userId, passwordHash, now),
    ])
  } catch {
    console.error(JSON.stringify({ event: 'managed_users.auth_create_failed', actor: actor.principal.id }))
    return json({ code: 'AUTH_USER_CREATE_FAILED' }, 500)
  }

  try {
    const statements: D1PreparedStatement[] = [
      bindings.DB!.prepare(`
        INSERT INTO identity_principals(id,provider,subject,display_name,email,status,created_at_ms,updated_at_ms)
        VALUES(?1,'better-auth',?2,?3,?4,'active',?5,?5)
      `).bind(principalId, userId, payload.fullName, payload.email, now),
      bindings.DB!.prepare(`
        INSERT INTO managed_user_profiles(principal_id,staff_type,preferred_tenant_id,created_at_ms,updated_at_ms)
        VALUES(?1,?2,?3,?4,?4)
      `).bind(principalId, payload.staffType, payload.activeTenantId, now),
    ]
    for (const tenantId of payload.tenantIds) {
      statements.push(bindings.DB!.prepare(`
        INSERT INTO tenant_memberships(tenant_id,principal_id,status,created_at_ms,updated_at_ms,role,module_permissions_json)
        VALUES(?1,?2,'active',?3,?3,?4,?5)
      `).bind(tenantId, principalId, now, role, permissions))
      statements.push(audit(bindings.DB!, actor.principal.id, principalId, tenantId, 'managed_user.created', {
        role: payload.role,
        staff_type: payload.staffType,
        scope_module_id: payload.scopeModuleId,
      }, now))
    }
    await bindings.DB!.batch(statements)
  } catch {
    try {
      await bindings.AUTH_DB!.batch([
        bindings.AUTH_DB!.prepare('DELETE FROM session WHERE userId=?1').bind(userId),
        bindings.AUTH_DB!.prepare('DELETE FROM account WHERE userId=?1').bind(userId),
        bindings.AUTH_DB!.prepare('DELETE FROM user WHERE id=?1').bind(userId),
      ])
    } catch {
      console.error(JSON.stringify({ event: 'managed_users.auth_create_compensation_failed', user_id: userId }))
    }
    console.error(JSON.stringify({ event: 'managed_users.domain_create_failed', actor: actor.principal.id, target: principalId }))
    return json({ code: 'MANAGED_USER_CREATE_FAILED' }, 500)
  }

  const principal: PrincipalRow = {
    id: principalId,
    subject: userId,
    display_name: payload.fullName,
    email: payload.email,
    status: 'active',
  }
  return json({ profile: await renderProfile(bindings.DB!, principal) }, 201)
}

async function updateAuthIdentity(
  bindings: Bindings,
  principal: PrincipalRow,
  fullName: string,
  password: string | null,
): Promise<{ restore: () => Promise<void> } | Response> {
  const authUser = await bindings.AUTH_DB!.prepare('SELECT id,name,updatedAt FROM user WHERE id=?1 LIMIT 1')
    .bind(principal.subject).first<AuthUserRow>()
  const account = await bindings.AUTH_DB!.prepare(`
    SELECT id,password,updatedAt FROM account
    WHERE userId=?1 AND providerId='credential'
    LIMIT 1
  `).bind(principal.subject).first<AuthAccountRow>()
  if (!authUser || !account) return json({ code: 'AUTH_IDENTITY_NOT_FOUND' }, 409)

  const now = Date.now()
  const newHash = password ? await hash(password, BCRYPT_ROUNDS) : null
  const statements: D1PreparedStatement[] = [
    bindings.AUTH_DB!.prepare('UPDATE user SET name=?1,updatedAt=?2 WHERE id=?3').bind(fullName, now, principal.subject),
  ]
  if (newHash) {
    statements.push(bindings.AUTH_DB!.prepare('UPDATE account SET password=?1,updatedAt=?2 WHERE id=?3').bind(newHash, now, account.id))
    statements.push(bindings.AUTH_DB!.prepare('DELETE FROM session WHERE userId=?1').bind(principal.subject))
  }
  await bindings.AUTH_DB!.batch(statements)

  return {
    restore: async () => {
      const rollback: D1PreparedStatement[] = [
        bindings.AUTH_DB!.prepare('UPDATE user SET name=?1,updatedAt=?2 WHERE id=?3').bind(authUser.name, authUser.updatedAt, authUser.id),
      ]
      if (newHash) {
        rollback.push(bindings.AUTH_DB!.prepare('UPDATE account SET password=?1,updatedAt=?2 WHERE id=?3').bind(account.password, account.updatedAt, account.id))
      }
      await bindings.AUTH_DB!.batch(rollback)
    },
  }
}

async function updateUser(
  request: Request,
  bindings: Bindings,
  dependencies: ManagedUsersDependencies,
  principalId: string,
): Promise<Response> {
  const actor = await resolveActor(request, bindings, dependencies.getSession || getBetterAuthSession)
  if (!actor.ok) return actor.error
  const payload = await parsePayload(request, false)
  if (payload instanceof Response) return payload
  const authorizationError = authorizeDesiredScope(actor.memberships, payload)
  if (authorizationError) return authorizationError

  const target = await bindings.DB!.prepare(`
    SELECT id,subject,display_name,email,status
    FROM identity_principals
    WHERE id=?1
    LIMIT 1
  `).bind(principalId).first<PrincipalRow>()
  if (!target) return json({ code: 'USER_NOT_FOUND' }, 404)

  const currentRows = await targetMemberships(bindings.DB!, principalId)
  if (!currentRows.length) return json({ code: 'USER_MEMBERSHIP_NOT_FOUND' }, 404)

  const actorMemberships = byTenant(actor.memberships)
  const desired = new Set(payload.tenantIds)

  // Name/password are Better Auth identity fields shared by every tenant. Do not
  // let an administrator of tenant A change global credentials for a principal
  // that also belongs to tenant B unless the actor can manage every membership.
  for (const row of currentRows) {
    if (!canManageUsers(actorMemberships.get(row.tenant_id), payload.scopeModuleId)) {
      return json({ code: 'FULL_IDENTITY_ADMIN_REQUIRED' }, 403)
    }
    if (row.role === 'owner' && (!desired.has(row.tenant_id) || payload.role !== 'admin')) {
      return json({ code: 'OWNER_MUTATION_FORBIDDEN' }, 409)
    }
  }

  if (actor.principal.id === principalId && operationalRole(currentRows) !== payload.role) {
    return json({ code: 'SELF_ROLE_CHANGE_FORBIDDEN' }, 409)
  }

  let authMutation: { restore: () => Promise<void> }
  try {
    const mutation = await updateAuthIdentity(bindings, target, payload.fullName, payload.password)
    if (mutation instanceof Response) return mutation
    authMutation = mutation
  } catch {
    return json({ code: 'AUTH_USER_UPDATE_FAILED' }, 500)
  }

  const now = Date.now()
  const permissions = storedPermissions(payload.permissions)
  const targetRole = membershipRole(payload)
  try {
    const statements: D1PreparedStatement[] = [
      bindings.DB!.prepare('UPDATE identity_principals SET display_name=?1,updated_at_ms=?2 WHERE id=?3')
        .bind(payload.fullName, now, principalId),
      bindings.DB!.prepare(`
        INSERT INTO managed_user_profiles(principal_id,staff_type,preferred_tenant_id,created_at_ms,updated_at_ms)
        VALUES(?1,?2,?3,?4,?4)
        ON CONFLICT(principal_id) DO UPDATE SET
          staff_type=excluded.staff_type,
          preferred_tenant_id=excluded.preferred_tenant_id,
          updated_at_ms=excluded.updated_at_ms
      `).bind(principalId, payload.staffType, payload.activeTenantId, now),
    ]

    for (const row of currentRows) {
      if (desired.has(row.tenant_id)) continue
      if (row.role === 'owner') throw new Error('OWNER_MUTATION_FORBIDDEN')
      statements.push(bindings.DB!.prepare('DELETE FROM tenant_memberships WHERE tenant_id=?1 AND principal_id=?2').bind(row.tenant_id, principalId))
      statements.push(audit(bindings.DB!, actor.principal.id, principalId, row.tenant_id, 'managed_user.membership_removed', {
        scope_module_id: payload.scopeModuleId,
      }, now))
    }

    for (const tenantId of payload.tenantIds) {
      const existing = currentRows.find((row) => row.tenant_id === tenantId)
      const role = existing?.role === 'owner' ? 'owner' : targetRole
      statements.push(bindings.DB!.prepare(`
        INSERT INTO tenant_memberships(tenant_id,principal_id,status,created_at_ms,updated_at_ms,role,module_permissions_json)
        VALUES(?1,?2,'active',?3,?3,?4,?5)
        ON CONFLICT(tenant_id,principal_id) DO UPDATE SET
          status='active',updated_at_ms=excluded.updated_at_ms,role=excluded.role,module_permissions_json=excluded.module_permissions_json
      `).bind(tenantId, principalId, now, role, permissions))
      statements.push(audit(bindings.DB!, actor.principal.id, principalId, tenantId, 'managed_user.updated', {
        role: payload.role,
        staff_type: payload.staffType,
        scope_module_id: payload.scopeModuleId,
        password_rotated: Boolean(payload.password),
      }, now))
    }
    await bindings.DB!.batch(statements)
  } catch (error) {
    try {
      await authMutation.restore()
    } catch {
      console.error(JSON.stringify({ event: 'managed_users.auth_update_compensation_failed', target: principalId }))
    }
    if (error instanceof Error && error.message === 'OWNER_MUTATION_FORBIDDEN') {
      return json({ code: 'OWNER_MUTATION_FORBIDDEN' }, 409)
    }
    return json({ code: 'MANAGED_USER_UPDATE_FAILED' }, 500)
  }

  return json({ profile: await renderProfile(bindings.DB!, { ...target, display_name: payload.fullName }) })
}

async function updateStatus(
  request: Request,
  bindings: Bindings,
  dependencies: ManagedUsersDependencies,
  principalId: string,
): Promise<Response> {
  const actor = await resolveActor(request, bindings, dependencies.getSession || getBetterAuthSession)
  if (!actor.ok) return actor.error
  if (actor.principal.id === principalId) return json({ code: 'SELF_STATUS_CHANGE_FORBIDDEN' }, 409)

  let body: Record<string, unknown>
  try {
    body = await request.json() as Record<string, unknown>
  } catch {
    return json({ code: 'INVALID_JSON' }, 400)
  }
  if (typeof body.active !== 'boolean') return json({ code: 'INVALID_STATUS' }, 400)

  const target = await bindings.DB!.prepare(`
    SELECT id,subject,display_name,email,status
    FROM identity_principals
    WHERE id=?1
    LIMIT 1
  `).bind(principalId).first<PrincipalRow>()
  if (!target) return json({ code: 'USER_NOT_FOUND' }, 404)

  const rows = await targetMemberships(bindings.DB!, principalId)
  if (!rows.length) return json({ code: 'USER_MEMBERSHIP_NOT_FOUND' }, 404)
  const actorMemberships = byTenant(actor.memberships)
  for (const row of rows) {
    if (row.role === 'owner') return json({ code: 'OWNER_STATUS_CHANGE_FORBIDDEN' }, 409)
    if (!isTenantAdmin(actorMemberships.get(row.tenant_id))) return json({ code: 'FULL_TENANT_ADMIN_REQUIRED' }, 403)
  }

  const status = body.active ? 'active' : 'inactive'
  const now = Date.now()
  const statements: D1PreparedStatement[] = [
    bindings.DB!.prepare('UPDATE identity_principals SET status=?1,updated_at_ms=?2 WHERE id=?3').bind(status, now, principalId),
  ]
  for (const row of rows) {
    statements.push(audit(bindings.DB!, actor.principal.id, principalId, row.tenant_id, body.active ? 'managed_user.unblocked' : 'managed_user.blocked', {}, now))
  }
  await bindings.DB!.batch(statements)

  if (!body.active) {
    try {
      await bindings.AUTH_DB!.prepare('DELETE FROM session WHERE userId=?1').bind(target.subject).run()
    } catch {
      console.error(JSON.stringify({ event: 'managed_users.session_revoke_failed', target: principalId }))
    }
  }

  return json({ profile: await renderProfile(bindings.DB!, { ...target, status }) })
}

export async function handleManagedUsersApiRequest(
  request: Request,
  bindings: Bindings,
  dependencies: ManagedUsersDependencies = {},
): Promise<Response | null> {
  const { pathname } = new URL(request.url)

  if (pathname === '/api/admin/users') {
    if (request.method === 'GET') return listUsers(request, bindings, dependencies)
    if (request.method === 'POST') return createUser(request, bindings, dependencies)
    return json({ code: 'METHOD_NOT_ALLOWED' }, 405, { allow: 'GET, POST' })
  }

  const statusMatch = /^\/api\/admin\/users\/([^/]+)\/status$/.exec(pathname)
  if (statusMatch) {
    const principalId = safeId(decodeURIComponent(statusMatch[1]))
    if (!principalId) return json({ code: 'INVALID_USER_ID' }, 400)
    if (request.method === 'PATCH') return updateStatus(request, bindings, dependencies, principalId)
    return json({ code: 'METHOD_NOT_ALLOWED' }, 405, { allow: 'PATCH' })
  }

  const userMatch = /^\/api\/admin\/users\/([^/]+)$/.exec(pathname)
  if (userMatch) {
    const principalId = safeId(decodeURIComponent(userMatch[1]))
    if (!principalId) return json({ code: 'INVALID_USER_ID' }, 400)
    if (request.method === 'PATCH') return updateUser(request, bindings, dependencies, principalId)
    return json({ code: 'METHOD_NOT_ALLOWED' }, 405, { allow: 'PATCH' })
  }

  if (pathname.startsWith('/api/admin/users/')) return json({ code: 'NOT_FOUND' }, 404)
  return null
}
