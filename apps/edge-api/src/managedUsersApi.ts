import { hash } from 'bcryptjs'

import { getBetterAuthSession, type BetterAuthRuntimeBindings } from './auth/betterAuthRuntime'

type ManagedUsersBindings = BetterAuthRuntimeBindings & { DB?: D1Database }
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

type ActorMembershipRow = {
  tenant_id: string
  role: string
  status: string
  module_permissions_json: string
  tenant_status: string
}

type TargetMembershipRow = ActorMembershipRow & {
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
  | { ok: true; session: NonNullable<AuthSession>; principal: PrincipalRow; memberships: ActorMembershipRow[] }
  | { ok: false; error: Response }

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

type StaffType = 'funcionario' | 'banho_tosa' | 'veterinaria' | 'motodog' | 'vendedor_caixa' | 'gerente'

const STAFF_TYPES = new Set<StaffType>(['funcionario', 'banho_tosa', 'veterinaria', 'motodog', 'vendedor_caixa', 'gerente'])
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const TEMP_PASSWORD = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{12,128}$/
const BCRYPT_MAX_BYTES = 72
const BCRYPT_ROUNDS = 12
const MAX_TENANTS_PER_USER = 64

function json(body: unknown, status = 200, headers?: HeadersInit): Response {
  return Response.json(body, {
    status,
    headers: { 'cache-control': 'no-store', ...Object.fromEntries(new Headers(headers).entries()) },
  })
}

function id(value: unknown, max = 160): string | null {
  const normalized = String(value ?? '').trim()
  return normalized && normalized.length <= max ? normalized : null
}

function moduleId(value: unknown): string | null {
  const normalized = String(value ?? '').trim().toLowerCase()
  return /^[a-z0-9][a-z0-9_-]{0,63}$/.test(normalized) ? normalized : null
}

function normalizedEmail(value: unknown): string | null {
  const normalized = String(value ?? '').trim().toLowerCase()
  return normalized.length <= 320 && EMAIL.test(normalized) ? normalized : null
}

function validName(value: unknown): string | null {
  const normalized = String(value ?? '').trim()
  return normalized && normalized.length <= 160 ? normalized : null
}

function validPassword(value: unknown, required: boolean): string | null | undefined {
  if (value == null || String(value).trim() === '') return required ? undefined : null
  const password = String(value).trim()
  if (!TEMP_PASSWORD.test(password)) return undefined
  if (new TextEncoder().encode(password).byteLength > BCRYPT_MAX_BYTES) return undefined
  return password
}

function parseStoredPermissions(raw: string | null | undefined): Record<string, string> {
  try {
    const parsed = JSON.parse(raw || '{}')
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const result: Record<string, string> = {}
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      const safeModule = moduleId(key)
      if (!safeModule) continue
      if (typeof value === 'string' && value.trim()) {
        result[safeModule] = value.trim().slice(0, 80)
      } else if (value && typeof value === 'object' && !Array.isArray(value)) {
        const role = (value as Record<string, unknown>).role
        if (typeof role === 'string' && role.trim()) result[safeModule] = role.trim().slice(0, 80)
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
  for (const [key, permission] of Object.entries(value as Record<string, unknown>)) {
    const safeModule = moduleId(key)
    const safePermission = typeof permission === 'string' ? permission.trim() : ''
    if (!safeModule || !safePermission || safePermission.length > 80) return null
    result[safeModule] = safePermission
  }
  return result
}

function storedPermissions(permissions: Record<string, string>): string {
  return JSON.stringify(Object.fromEntries(
    Object.entries(permissions).map(([key, role]) => [key, { role }]),
  ))
}

function membershipPermission(row: ActorMembershipRow, scopeModuleId: string): string {
  return parseStoredPermissions(row.module_permissions_json)[scopeModuleId] || ''
}

function canManageUsers(row: ActorMembershipRow | undefined, scopeModuleId: string): boolean {
  if (!row || row.status !== 'active' || row.tenant_status !== 'active') return false
  if (row.role === 'owner' || row.role === 'admin') return true
  return membershipPermission(row, scopeModuleId).startsWith('admin_')
}

function isTenantAdministrator(row: ActorMembershipRow | undefined): boolean {
  return Boolean(row && row.status === 'active' && row.tenant_status === 'active' && (row.role === 'owner' || row.role === 'admin'))
}

function uniqueIds(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null
  const result: string[] = []
  for (const raw of value) {
    const safe = id(raw)
    if (!safe) return null
    if (!result.includes(safe)) result.push(safe)
  }
  return result.length > 0 && result.length <= MAX_TENANTS_PER_USER ? result : null
}

function staffType(value: unknown): StaffType | null {
  const normalized = String(value ?? 'funcionario').trim() as StaffType
  return STAFF_TYPES.has(normalized) ? normalized : null
}

async function parsePayload(request: Request, options: { create: boolean }): Promise<ManagedPayload | Response> {
  let body: Record<string, unknown>
  try {
    body = await request.json() as Record<string, unknown>
  } catch {
    return json({ code: 'INVALID_JSON' }, 400)
  }

  const fullName = validName(body.full_name)
  const role = body.role === 'admin' || body.role === 'employee' ? body.role : null
  const staff = role === 'admin' ? 'gerente' : staffType(body.staff_type)
  const permissions = normalizePermissions(body.permissions)
  const scopeModuleId = moduleId(body.scopeModuleId)
  const tenantIds = uniqueIds(body.tenantIds)
  const activeTenantId = id(body.activeTenantId)
  const email = options.create ? normalizedEmail(body.email) : null
  const password = validPassword(body.password, options.create)

  if (!fullName) return json({ code: 'INVALID_NAME' }, 400)
  if (!role) return json({ code: 'INVALID_ROLE' }, 400)
  if (!staff) return json({ code: 'INVALID_STAFF_TYPE' }, 400)
  if (!permissions) return json({ code: 'INVALID_PERMISSIONS' }, 400)
  if (!scopeModuleId || !tenantIds || !activeTenantId || !tenantIds.includes(activeTenantId)) {
    return json({ code: 'INVALID_TENANT_SCOPE' }, 400)
  }
  if (role === 'employee' && Object.keys(permissions).length === 0) {
    return json({ code: 'EMPLOYEE_PERMISSION_REQUIRED' }, 400)
  }
  if (options.create && !email) return json({ code: 'INVALID_EMAIL' }, 400)
  if (password === undefined) return json({ code: 'INVALID_PASSWORD' }, 400)

  return { fullName, email, password, role, staffType: staff, permissions, scopeModuleId, tenantIds, activeTenantId }
}

async function actor(
  request: Request,
  bindings: ManagedUsersBindings,
  getSession: SessionResolver,
): Promise<ActorResolution> {
  if (!bindings.DB || !bindings.AUTH_DB) return { ok: false, error: json({ code: 'DATABASE_NOT_CONFIGURED' }, 503) }
  const session = await getSession(request, bindings)
  const userId = id(session?.user?.id, 255)
  if (!session || !userId) return { ok: false, error: json({ code: 'UNAUTHENTICATED' }, 401) }

  const principal = await bindings.DB.prepare(`
    SELECT id, subject, display_name, email, status
    FROM identity_principals
    WHERE provider='better-auth' AND subject=?1
    LIMIT 1
  `).bind(userId).first<PrincipalRow>()
  if (!principal || principal.status !== 'active') return { ok: false, error: json({ code: 'FORBIDDEN' }, 403) }

  const rows = await bindings.DB.prepare(`
    SELECT m.tenant_id,m.role,m.status,m.module_permissions_json,t.status AS tenant_status
    FROM tenant_memberships m
    JOIN tenants t ON t.id=m.tenant_id
    WHERE m.principal_id=?1
    ORDER BY m.tenant_id
  `).bind(principal.id).all<ActorMembershipRow>()

  return { ok: true, session, principal, memberships: rows.results || [] }
}

function membershipByTenant(rows: ActorMembershipRow[]): Map<string, ActorMembershipRow> {
  return new Map(rows.map((row) => [row.tenant_id, row]))
}

function authorizeDesiredScope(
  actorRows: ActorMembershipRow[],
  payload: ManagedPayload,
): Response | null {
  const byTenant = membershipByTenant(actorRows)
  for (const tenantId of payload.tenantIds) {
    const row = byTenant.get(tenantId)
    if (!canManageUsers(row, payload.scopeModuleId)) return json({ code: 'FORBIDDEN' }, 403)
    if (payload.role === 'admin' && !isTenantAdministrator(row)) return json({ code: 'ADMIN_ESCALATION_FORBIDDEN' }, 403)
    if (!isTenantAdministrator(row)) {
      if (payload.tenantIds.length !== 1) return json({ code: 'CROSS_TENANT_ADMIN_REQUIRED' }, 403)
      if (Object.keys(payload.permissions).some((key) => key !== payload.scopeModuleId)) {
        return json({ code: 'CROSS_MODULE_ADMIN_REQUIRED' }, 403)
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
  for (const row of rows) Object.assign(result, parseStoredPermissions(row.module_permissions_json))
  return result
}

async function managedProfile(database: D1Database, principalId: string): Promise<ManagedProfileRow | null> {
  return database.prepare(`
    SELECT principal_id,staff_type,preferred_tenant_id
    FROM managed_user_profiles WHERE principal_id=?1 LIMIT 1
  `).bind(principalId).first<ManagedProfileRow>()
}

async function renderProfile(database: D1Database, principal: PrincipalRow, visibleTenantIds?: Set<string>) {
  const allRows = await targetMemberships(database, principal.id)
  const rows = visibleTenantIds ? allRows.filter((row) => visibleTenantIds.has(row.tenant_id)) : allRows
  const profile = await managedProfile(database, principal.id)
  const fallbackStaff = rows.some((row) => row.role === 'owner' || row.role === 'admin' || row.role === 'manager') ? 'gerente' : 'funcionario'
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
      module_permissions: parseStoredPermissions(row.module_permissions_json),
    })),
  }
}

function auditStatement(
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

async function listUsers(
  request: Request,
  bindings: ManagedUsersBindings,
  dependencies: ManagedUsersDependencies,
): Promise<Response> {
  const resolved = await actor(request, bindings, dependencies.getSession || getBetterAuthSession)
  if (!resolved.ok) return resolved.error

  const url = new URL(request.url)
  const requestedTenantId = id(url.searchParams.get('tenant_id'))
  const requestedModuleId = moduleId(url.searchParams.get('module_id'))
  let visibleTenantIds: string[]

  if (requestedTenantId || requestedModuleId) {
    if (!requestedTenantId || !requestedModuleId) return json({ code: 'INVALID_SCOPE' }, 400)
    const row = membershipByTenant(resolved.memberships).get(requestedTenantId)
    if (!canManageUsers(row, requestedModuleId)) return json({ code: 'FORBIDDEN' }, 403)
    visibleTenantIds = [requestedTenantId]
  } else {
    visibleTenantIds = resolved.memberships
      .filter((row) => isTenantAdministrator(row))
      .map((row) => row.tenant_id)
    if (!visibleTenantIds.length) return json({ code: 'FORBIDDEN' }, 403)
  }

  const inClause = placeholders(visibleTenantIds.length)
  const result = await bindings.DB!.prepare(`
    SELECT DISTINCT p.id,p.subject,p.display_name,p.email,p.status
    FROM identity_principals p
    JOIN tenant_memberships m ON m.principal_id=p.id
    WHERE m.tenant_id IN (${inClause})
    ORDER BY COALESCE(NULLIF(TRIM(p.display_name),''),p.email,p.id),p.id
  `).bind(...visibleTenantIds).all<PrincipalRow>()

  const visible = new Set(visibleTenantIds)
  const profiles = await Promise.all((result.results || []).map((principal) => renderProfile(bindings.DB!, principal, visible)))
  return json({ profiles })
}

async function createUser(
  request: Request,
  bindings: ManagedUsersBindings,
  dependencies: ManagedUsersDependencies,
): Promise<Response> {
  const resolved = await actor(request, bindings, dependencies.getSession || getBetterAuthSession)
  if (!resolved.ok) return resolved.error
  const parsed = await parsePayload(request, { create: true })
  if (parsed instanceof Response) return parsed
  const authorizationError = authorizeDesiredScope(resolved.memberships, parsed)
  if (authorizationError) return authorizationError

  const existing = await bindings.AUTH_DB!.prepare(`SELECT id FROM user WHERE lower(email)=?1 LIMIT 1`).bind(parsed.email).first()
  if (existing) return json({ code: 'EMAIL_ALREADY_EXISTS' }, 409)

  const now = Date.now()
  const userId = crypto.randomUUID()
  const principalId = crypto.randomUUID()
  const passwordHash = await hash(parsed.password!, BCRYPT_ROUNDS)
  const stored = storedPermissions(parsed.permissions)
  const targetRole = membershipRole(parsed)

  try {
    await bindings.AUTH_DB!.batch([
      bindings.AUTH_DB!.prepare(`
        INSERT INTO user(id,name,email,emailVerified,image,createdAt,updatedAt)
        VALUES(?1,?2,?3,1,NULL,?4,?4)
      `).bind(userId, parsed.fullName, parsed.email, now),
      bindings.AUTH_DB!.prepare(`
        INSERT INTO account(id,userId,accountId,providerId,password,createdAt,updatedAt)
        VALUES(?1,?2,?2,'credential',?3,?4,?4)
      `).bind(`credential:${userId}`, userId, passwordHash, now),
    ])
  } catch (error) {
    console.error(JSON.stringify({ event: 'managed_users.auth_create_failed', actor: resolved.principal.id }))
    return json({ code: 'AUTH_USER_CREATE_FAILED' }, 500)
  }

  try {
    const statements: D1PreparedStatement[] = [
      bindings.DB!.prepare(`
        INSERT INTO identity_principals(id,provider,subject,display_name,email,status,created_at_ms,updated_at_ms)
        VALUES(?1,'better-auth',?2,?3,?4,'active',?5,?5)
      `).bind(principalId, userId, parsed.fullName, parsed.email, now),
      bindings.DB!.prepare(`
        INSERT INTO managed_user_profiles(principal_id,staff_type,preferred_tenant_id,created_at_ms,updated_at_ms)
        VALUES(?1,?2,?3,?4,?4)
      `).bind(principalId, parsed.staffType, parsed.activeTenantId, now),
    ]
    for (const tenantId of parsed.tenantIds) {
      statements.push(bindings.DB!.prepare(`
        INSERT INTO tenant_memberships(tenant_id,principal_id,status,created_at_ms,updated_at_ms,role,module_permissions_json)
        VALUES(?1,?2,'active',?3,?3,?4,?5)
      `).bind(tenantId, principalId, now, targetRole, stored))
      statements.push(auditStatement(bindings.DB!, resolved.principal.id, principalId, tenantId, 'managed_user.created', {
        role: parsed.role,
        staff_type: parsed.staffType,
        scope_module_id: parsed.scopeModuleId,
      }, now))
    }
    await bindings.DB!.batch(statements)
  } catch (error) {
    try {
      await bindings.AUTH_DB!.batch([
        bindings.AUTH_DB!.prepare(`DELETE FROM session WHERE userId=?1`).bind(userId),
        bindings.AUTH_DB!.prepare(`DELETE FROM account WHERE userId=?1`).bind(userId),
        bindings.AUTH_DB!.prepare(`DELETE FROM user WHERE id=?1`).bind(userId),
      ])
    } catch {
      console.error(JSON.stringify({ event: 'managed_users.auth_create_compensation_failed', user_id: userId }))
    }
    console.error(JSON.stringify({ event: 'managed_users.domain_create_failed', actor: resolved.principal.id, target: principalId }))
    return json({ code: 'MANAGED_USER_CREATE_FAILED' }, 500)
  }

  const principal: PrincipalRow = { id: principalId, subject: userId, display_name: parsed.fullName, email: parsed.email, status: 'active' }
  return json({ profile: await renderProfile(bindings.DB!, principal) }, 201)
}

async function updateAuthIdentity(
  bindings: ManagedUsersBindings,
  principal: PrincipalRow,
  fullName: string,
  password: string | null,
): Promise<{ restore: () => Promise<void> } | Response> {
  const authUser = await bindings.AUTH_DB!.prepare(`SELECT id,name,updatedAt FROM user WHERE id=?1 LIMIT 1`).bind(principal.subject).first<AuthUserRow>()
  const account = await bindings.AUTH_DB!.prepare(`
    SELECT id,password,updatedAt FROM account WHERE userId=?1 AND providerId='credential' LIMIT 1
  `).bind(principal.subject).first<AuthAccountRow>()
  if (!authUser || !account) return json({ code: 'AUTH_IDENTITY_NOT_FOUND' }, 409)

  const now = Date.now()
  const newHash = password ? await hash(password, BCRYPT_ROUNDS) : null
  const changes: D1PreparedStatement[] = [
    bindings.AUTH_DB!.prepare(`UPDATE user SET name=?1,updatedAt=?2 WHERE id=?3`).bind(fullName, now, principal.subject),
  ]
  if (newHash) {
    changes.push(bindings.AUTH_DB!.prepare(`UPDATE account SET password=?1,updatedAt=?2 WHERE id=?3`).bind(newHash, now, account.id))
    changes.push(bindings.AUTH_DB!.prepare(`DELETE FROM session WHERE userId=?1`).bind(principal.subject))
  }
  await bindings.AUTH_DB!.batch(changes)

  return {
    restore: async () => {
      const rollback: D1PreparedStatement[] = [
        bindings.AUTH_DB!.prepare(`UPDATE user SET name=?1,updatedAt=?2 WHERE id=?3`).bind(authUser.name, authUser.updatedAt, authUser.id),
      ]
      if (newHash) rollback.push(bindings.AUTH_DB!.prepare(`UPDATE account SET password=?1,updatedAt=?2 WHERE id=?3`).bind(account.password, account.updatedAt, account.id))
      await bindings.AUTH_DB!.batch(rollback)
    },
  }
}

async function updateUser(
  request: Request,
  bindings: ManagedUsersBindings,
  dependencies: ManagedUsersDependencies,
  principalId: string,
): Promise<Response> {
  const resolved = await actor(request, bindings, dependencies.getSession || getBetterAuthSession)
  if (!resolved.ok) return resolved.error
  const parsed = await parsePayload(request, { create: false })
  if (parsed instanceof Response) return parsed
  const authorizationError = authorizeDesiredScope(resolved.memberships, parsed)
  if (authorizationError) return authorizationError

  const target = await bindings.DB!.prepare(`
    SELECT id,subject,display_name,email,status FROM identity_principals WHERE id=?1 LIMIT 1
  `).bind(principalId).first<PrincipalRow>()
  if (!target) return json({ code: 'USER_NOT_FOUND' }, 404)

  const currentRows = await targetMemberships(bindings.DB!, principalId)
  if (!currentRows.length) return json({ code: 'USER_MEMBERSHIP_NOT_FOUND' }, 404)
  const actorByTenant = membershipByTenant(resolved.memberships)
  const desiredSet = new Set(parsed.tenantIds)

  for (const row of currentRows) {
    const actorRow = actorByTenant.get(row.tenant_id)
    const manageable = canManageUsers(actorRow, parsed.scopeModuleId)
    if (row.role === 'owner' && manageable && (desiredSet.has(row.tenant_id) || !desiredSet.has(row.tenant_id))) {
      if (!desiredSet.has(row.tenant_id) || parsed.role !== 'admin') return json({ code: 'OWNER_MUTATION_FORBIDDEN' }, 409)
    }
    if (!desiredSet.has(row.tenant_id) && manageable && row.role === 'owner') return json({ code: 'OWNER_MUTATION_FORBIDDEN' }, 409)
  }

  if (resolved.principal.id === principalId && operationalRole(currentRows) !== parsed.role) {
    return json({ code: 'SELF_ROLE_CHANGE_FORBIDDEN' }, 409)
  }

  let authMutation: { restore: () => Promise<void> }
  try {
    const updatedAuth = await updateAuthIdentity(bindings, target, parsed.fullName, parsed.password)
    if (updatedAuth instanceof Response) return updatedAuth
    authMutation = updatedAuth
  } catch {
    return json({ code: 'AUTH_USER_UPDATE_FAILED' }, 500)
  }

  const now = Date.now()
  const stored = storedPermissions(parsed.permissions)
  const targetRole = membershipRole(parsed)
  try {
    const statements: D1PreparedStatement[] = [
      bindings.DB!.prepare(`UPDATE identity_principals SET display_name=?1,updated_at_ms=?2 WHERE id=?3`).bind(parsed.fullName, now, principalId),
      bindings.DB!.prepare(`
        INSERT INTO managed_user_profiles(principal_id,staff_type,preferred_tenant_id,created_at_ms,updated_at_ms)
        VALUES(?1,?2,?3,?4,?4)
        ON CONFLICT(principal_id) DO UPDATE SET staff_type=excluded.staff_type,preferred_tenant_id=excluded.preferred_tenant_id,updated_at_ms=excluded.updated_at_ms
      `).bind(principalId, parsed.staffType, parsed.activeTenantId, now),
    ]

    for (const row of currentRows) {
      if (desiredSet.has(row.tenant_id)) continue
      if (!canManageUsers(actorByTenant.get(row.tenant_id), parsed.scopeModuleId)) continue
      if (row.role === 'owner') throw new Error('OWNER_MUTATION_FORBIDDEN')
      statements.push(bindings.DB!.prepare(`DELETE FROM tenant_memberships WHERE tenant_id=?1 AND principal_id=?2`).bind(row.tenant_id, principalId))
      statements.push(auditStatement(bindings.DB!, resolved.principal.id, principalId, row.tenant_id, 'managed_user.membership_removed', { scope_module_id: parsed.scopeModuleId }, now))
    }

    for (const tenantId of parsed.tenantIds) {
      const existing = currentRows.find((row) => row.tenant_id === tenantId)
      const role = existing?.role === 'owner' ? 'owner' : targetRole
      statements.push(bindings.DB!.prepare(`
        INSERT INTO tenant_memberships(tenant_id,principal_id,status,created_at_ms,updated_at_ms,role,module_permissions_json)
        VALUES(?1,?2,'active',?3,?3,?4,?5)
        ON CONFLICT(tenant_id,principal_id) DO UPDATE SET status='active',updated_at_ms=excluded.updated_at_ms,role=excluded.role,module_permissions_json=excluded.module_permissions_json
      `).bind(tenantId, principalId, now, role, stored))
      statements.push(auditStatement(bindings.DB!, resolved.principal.id, principalId, tenantId, 'managed_user.updated', {
        role: parsed.role,
        staff_type: parsed.staffType,
        scope_module_id: parsed.scopeModuleId,
        password_rotated: Boolean(parsed.password),
      }, now))
    }
    await bindings.DB!.batch(statements)
  } catch (error) {
    try { await authMutation.restore() } catch {
      console.error(JSON.stringify({ event: 'managed_users.auth_update_compensation_failed', target: principalId }))
    }
    if (error instanceof Error && error.message === 'OWNER_MUTATION_FORBIDDEN') return json({ code: 'OWNER_MUTATION_FORBIDDEN' }, 409)
    return json({ code: 'MANAGED_USER_UPDATE_FAILED' }, 500)
  }

  const refreshed: PrincipalRow = { ...target, display_name: parsed.fullName }
  return json({ profile: await renderProfile(bindings.DB!, refreshed) })
}

async function updateStatus(
  request: Request,
  bindings: ManagedUsersBindings,
  dependencies: ManagedUsersDependencies,
  principalId: string,
): Promise<Response> {
  const resolved = await actor(request, bindings, dependencies.getSession || getBetterAuthSession)
  if (!resolved.ok) return resolved.error
  if (resolved.principal.id === principalId) return json({ code: 'SELF_STATUS_CHANGE_FORBIDDEN' }, 409)

  let body: Record<string, unknown>
  try { body = await request.json() as Record<string, unknown> } catch { return json({ code: 'INVALID_JSON' }, 400) }
  if (typeof body.active !== 'boolean') return json({ code: 'INVALID_STATUS' }, 400)

  const target = await bindings.DB!.prepare(`
    SELECT id,subject,display_name,email,status FROM identity_principals WHERE id=?1 LIMIT 1
  `).bind(principalId).first<PrincipalRow>()
  if (!target) return json({ code: 'USER_NOT_FOUND' }, 404)
  const rows = await targetMemberships(bindings.DB!, principalId)
  if (!rows.length) return json({ code: 'USER_MEMBERSHIP_NOT_FOUND' }, 404)

  const actorByTenant = membershipByTenant(resolved.memberships)
  for (const row of rows) {
    if (row.role === 'owner') return json({ code: 'OWNER_STATUS_CHANGE_FORBIDDEN' }, 409)
    if (!isTenantAdministrator(actorByTenant.get(row.tenant_id))) return json({ code: 'FULL_TENANT_ADMIN_REQUIRED' }, 403)
  }

  const status = body.active ? 'active' : 'inactive'
  const now = Date.now()
  const statements: D1PreparedStatement[] = [
    bindings.DB!.prepare(`UPDATE identity_principals SET status=?1,updated_at_ms=?2 WHERE id=?3`).bind(status, now, principalId),
  ]
  for (const row of rows) {
    statements.push(auditStatement(bindings.DB!, resolved.principal.id, principalId, row.tenant_id, body.active ? 'managed_user.unblocked' : 'managed_user.blocked', {}, now))
  }
  await bindings.DB!.batch(statements)

  if (!body.active) {
    try {
      await bindings.AUTH_DB!.prepare(`DELETE FROM session WHERE userId=?1`).bind(target.subject).run()
    } catch {
      console.error(JSON.stringify({ event: 'managed_users.session_revoke_failed', target: principalId }))
    }
  }

  return json({ profile: await renderProfile(bindings.DB!, { ...target, status }) })
}

export async function handleManagedUsersApiRequest(
  request: Request,
  bindings: ManagedUsersBindings,
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
    const principalId = id(decodeURIComponent(statusMatch[1]))
    if (!principalId) return json({ code: 'INVALID_USER_ID' }, 400)
    if (request.method === 'PATCH') return updateStatus(request, bindings, dependencies, principalId)
    return json({ code: 'METHOD_NOT_ALLOWED' }, 405, { allow: 'PATCH' })
  }

  const userMatch = /^\/api\/admin\/users\/([^/]+)$/.exec(pathname)
  if (userMatch) {
    const principalId = id(decodeURIComponent(userMatch[1]))
    if (!principalId) return json({ code: 'INVALID_USER_ID' }, 400)
    if (request.method === 'PATCH') return updateUser(request, bindings, dependencies, principalId)
    return json({ code: 'METHOD_NOT_ALLOWED' }, 405, { allow: 'PATCH' })
  }

  if (pathname.startsWith('/api/admin/users/')) return json({ code: 'NOT_FOUND' }, 404)
  return null
}
