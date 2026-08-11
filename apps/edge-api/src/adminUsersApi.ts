import { hash } from 'bcryptjs'

import { getBetterAuthSession, type BetterAuthRuntimeBindings } from './auth/betterAuthRuntime'

type AdminUsersBindings = BetterAuthRuntimeBindings & {
  DB?: D1Database
  AUTH_DB?: D1Database
}

type AuthSession = Awaited<ReturnType<typeof getBetterAuthSession>>
type SessionResolver = typeof getBetterAuthSession

export type AdminUsersApiDependencies = {
  getSession?: SessionResolver
}

type Actor = {
  principalId: string
  subject: string
  globalAdmin: boolean
}

type MembershipAccessRow = {
  role: string
  status: string
  module_permissions_json: string
  tenant_status: string
}

type DirectoryRow = {
  principal_id: string
  subject: string
  display_name: string | null
  email: string | null
  principal_status: string
  tenant_id: string | null
  tenant_name: string | null
  tenant_slug: string | null
  tenant_status: string | null
  membership_role: string | null
  membership_status: string | null
  module_permissions_json: string | null
  staff_type: string | null
  is_global_admin: number
}

type TargetPrincipalRow = {
  id: string
  subject: string
  display_name: string | null
  email: string | null
  status: string
}

type TargetMembershipRow = {
  tenant_id: string
  role: string
  status: string
  module_permissions_json: string
  staff_type: string | null
}

type AuthUserSnapshot = {
  id: string
  name: string
}

type AuthAccountSnapshot = {
  id: string
  password: string | null
}

type StaffType = 'funcionario' | 'banho_tosa' | 'veterinaria' | 'motodog' | 'vendedor_caixa' | 'gerente'

const STAFF_TYPES = new Set<StaffType>([
  'funcionario',
  'banho_tosa',
  'veterinaria',
  'motodog',
  'vendedor_caixa',
  'gerente',
])

const MODULE_ROLES: Record<string, ReadonlySet<string>> = {
  petshop: new Set(['admin_pet', 'funcionario_pet']),
}

const BCRYPT_ROUNDS = 12
const BCRYPT_MAX_BYTES = 72
const PASSWORD_RE = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{12,128}$/
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

class AdminUsersError extends Error {
  readonly status: number

  constructor(code: string, status: number) {
    super(code)
    this.name = 'AdminUsersError'
    this.status = status
  }
}

function json(body: unknown, status = 200, headers?: HeadersInit): Response {
  const responseHeaders = new Headers(headers)
  responseHeaders.set('cache-control', 'no-store')
  return Response.json(body, { status, headers: responseHeaders })
}

function failure(error: unknown): Response {
  if (error instanceof AdminUsersError) {
    const messages: Record<string, string> = {
      DATABASE_NOT_CONFIGURED: 'Banco de dados nao configurado.',
      UNAUTHENTICATED: 'Sessao nao autenticada.',
      FORBIDDEN: 'Voce nao possui permissao para esta operacao.',
      INVALID_SCOPE: 'Escopo de negocio ou modulo invalido.',
      INVALID_JSON: 'Corpo da requisicao invalido.',
      INVALID_NAME: 'Nome do colaborador invalido.',
      INVALID_EMAIL: 'Email de acesso invalido.',
      INVALID_PASSWORD: 'A senha temporaria precisa ter 12 caracteres ou mais, com letra maiuscula, minuscula e numero.',
      INVALID_ROLE: 'Tipo de conta invalido.',
      INVALID_STAFF_TYPE: 'Area operacional invalida.',
      INVALID_PERMISSIONS: 'Permissoes de modulo invalidas.',
      INVALID_TENANTS: 'Selecione pelo menos um negocio valido.',
      EMAIL_ALREADY_EXISTS: 'Ja existe um acesso com este email.',
      USER_NOT_FOUND: 'Usuario nao encontrado.',
      CREDENTIAL_NOT_FOUND: 'Credencial de acesso nao encontrada.',
      CANNOT_DEACTIVATE_SELF: 'Voce nao pode desativar seu proprio acesso.',
      CANNOT_DEMOTE_SELF: 'Voce nao pode remover seu proprio acesso administrativo global.',
      LAST_GLOBAL_ADMIN: 'Nao e possivel remover o ultimo administrador global ativo.',
      CROSS_DATABASE_WRITE_FAILED: 'Nao foi possivel concluir a alteracao de acesso com seguranca.',
    }
    return json({ error: { code: error.message, message: messages[error.message] || 'Falha ao gerenciar usuario.' } }, error.status)
  }
  console.error(JSON.stringify({ event: 'admin_users.unhandled_error', error: String(error) }))
  return json({ error: { code: 'ADMIN_USERS_FAILED', message: 'Falha ao gerenciar usuario.' } }, 500)
}

function validId(value: unknown, max = 160): string | null {
  const normalized = String(value ?? '').trim()
  return normalized && normalized.length <= max ? normalized : null
}

function validModule(value: unknown): string | null {
  const normalized = String(value ?? '').trim().toLowerCase()
  return /^[a-z0-9][a-z0-9_-]{0,63}$/.test(normalized) ? normalized : null
}

function normalizeEmail(value: unknown): string {
  const normalized = String(value ?? '').trim().toLowerCase()
  if (!normalized || normalized.length > 254 || !EMAIL_RE.test(normalized)) {
    throw new AdminUsersError('INVALID_EMAIL', 400)
  }
  return normalized
}

function normalizeName(value: unknown): string {
  const normalized = String(value ?? '').trim()
  if (!normalized || normalized.length > 160) throw new AdminUsersError('INVALID_NAME', 400)
  return normalized
}

function normalizePassword(value: unknown, required: boolean): string | null {
  const password = String(value ?? '').trim()
  if (!password) {
    if (required) throw new AdminUsersError('INVALID_PASSWORD', 400)
    return null
  }
  if (!PASSWORD_RE.test(password) || new TextEncoder().encode(password).byteLength > BCRYPT_MAX_BYTES) {
    throw new AdminUsersError('INVALID_PASSWORD', 400)
  }
  return password
}

function normalizeStaffType(value: unknown): StaffType {
  const normalized = String(value ?? 'funcionario').trim() as StaffType
  if (!STAFF_TYPES.has(normalized)) throw new AdminUsersError('INVALID_STAFF_TYPE', 400)
  return normalized
}

function membershipRoleFor(staffType: StaffType): 'manager' | 'staff' {
  return staffType === 'gerente' ? 'manager' : 'staff'
}

function defaultStaffType(role: string | null | undefined): StaffType {
  return role === 'owner' || role === 'admin' || role === 'manager' ? 'gerente' : 'funcionario'
}

function permissionRole(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value.trim()
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const role = String((value as Record<string, unknown>).role || (value as Record<string, unknown>).id || '').trim()
    return role || null
  }
  return null
}

function permissionsFromJson(raw: string | null | undefined): Record<string, string> {
  try {
    const parsed = JSON.parse(raw || '{}')
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const normalized: Record<string, string> = {}
    for (const [rawModuleId, rawPermission] of Object.entries(parsed)) {
      const moduleId = validModule(rawModuleId)
      const role = permissionRole(rawPermission)
      if (!moduleId || !role) continue
      normalized[moduleId] = role
    }
    return normalized
  } catch {
    return {}
  }
}

function normalizePermissions(value: unknown, allowEmpty = false): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    if (allowEmpty) return {}
    throw new AdminUsersError('INVALID_PERMISSIONS', 400)
  }

  const normalized: Record<string, string> = {}
  for (const [rawModuleId, rawPermission] of Object.entries(value as Record<string, unknown>)) {
    const moduleId = validModule(rawModuleId)
    const role = permissionRole(rawPermission)
    if (!moduleId || !role || !MODULE_ROLES[moduleId]?.has(role)) {
      throw new AdminUsersError('INVALID_PERMISSIONS', 400)
    }
    normalized[moduleId] = role
  }
  if (!allowEmpty && Object.keys(normalized).length === 0) throw new AdminUsersError('INVALID_PERMISSIONS', 400)
  return normalized
}

function normalizeTenantIds(value: unknown): string[] {
  if (!Array.isArray(value)) throw new AdminUsersError('INVALID_TENANTS', 400)
  const ids = [...new Set(value.map((entry) => validId(entry)).filter((entry): entry is string => Boolean(entry)))]
  if (!ids.length || ids.length > 64) throw new AdminUsersError('INVALID_TENANTS', 400)
  return ids
}

function isAdminModuleRole(role: string | null | undefined): boolean {
  return Boolean(role && role.startsWith('admin_'))
}

function canManageModule(row: MembershipAccessRow | null, moduleId: string): boolean {
  if (!row || row.status !== 'active' || row.tenant_status !== 'active') return false
  if (row.role === 'owner' || row.role === 'admin') return true
  return isAdminModuleRole(permissionsFromJson(row.module_permissions_json)[moduleId])
}

async function resolveActor(
  request: Request,
  bindings: AdminUsersBindings,
  getSession: SessionResolver,
): Promise<Actor> {
  if (!bindings.DB || !bindings.AUTH_DB) throw new AdminUsersError('DATABASE_NOT_CONFIGURED', 503)
  const session = await getSession(request, bindings)
  const subject = validId(session?.user?.id, 255)
  if (!session || !subject) throw new AdminUsersError('UNAUTHENTICATED', 401)

  const principal = await bindings.DB.prepare(`
    SELECT id, status
    FROM identity_principals
    WHERE provider='better-auth' AND subject=?1
    LIMIT 1
  `).bind(subject).first<{ id: string; status: string }>()
  if (!principal || principal.status !== 'active') throw new AdminUsersError('FORBIDDEN', 403)

  const globalAdmin = Boolean(await bindings.DB.prepare(`
    SELECT 1
    FROM tenant_memberships m
    JOIN tenants t ON t.id=m.tenant_id
    WHERE m.principal_id=?1 AND m.status='active' AND t.status='active' AND m.role='admin'
    LIMIT 1
  `).bind(principal.id).first())

  return { principalId: principal.id, subject, globalAdmin }
}

async function requireModuleManager(
  database: D1Database,
  actor: Actor,
  tenantId: string,
  moduleId: string,
): Promise<void> {
  if (actor.globalAdmin) return
  const row = await database.prepare(`
    SELECT m.role,m.status,m.module_permissions_json,t.status AS tenant_status
    FROM tenant_memberships m
    JOIN tenants t ON t.id=m.tenant_id
    WHERE m.tenant_id=?1 AND m.principal_id=?2
    LIMIT 1
  `).bind(tenantId, actor.principalId).first<MembershipAccessRow>()
  if (!canManageModule(row, moduleId)) throw new AdminUsersError('FORBIDDEN', 403)
}

async function assertTenants(database: D1Database, tenantIds: string[]): Promise<void> {
  const placeholders = tenantIds.map((_, index) => `?${index + 1}`).join(',')
  const result = await database.prepare(`SELECT id FROM tenants WHERE status='active' AND id IN (${placeholders})`)
    .bind(...tenantIds).all<{ id: string }>()
  if (result.results.length !== tenantIds.length) throw new AdminUsersError('INVALID_TENANTS', 400)
}

function mergePermission(target: Record<string, string>, moduleId: string, role: string): void {
  const current = target[moduleId]
  if (!current || (isAdminModuleRole(role) && !isAdminModuleRole(current))) target[moduleId] = role
}

function buildProfiles(rows: DirectoryRow[]) {
  const profiles = new Map<string, {
    id: string
    full_name: string
    email: string
    role: 'admin' | 'employee'
    active: boolean
    staff_type: StaffType
    module_permissions: Record<string, string>
    tenant_ids: string[]
    tenants: Array<Record<string, unknown>>
    active_tenant_id: string | null
    _principalActive: boolean
    _hasActiveMembership: boolean
  }>()

  for (const row of rows) {
    let profile = profiles.get(row.principal_id)
    if (!profile) {
      profile = {
        id: row.principal_id,
        full_name: row.display_name || row.email || '',
        email: row.email || '',
        role: row.is_global_admin ? 'admin' : 'employee',
        active: false,
        staff_type: defaultStaffType(row.membership_role),
        module_permissions: {},
        tenant_ids: [],
        tenants: [],
        active_tenant_id: null,
        _principalActive: row.principal_status === 'active',
        _hasActiveMembership: false,
      }
      profiles.set(row.principal_id, profile)
    }

    if (!row.tenant_id) continue
    const membershipActive = row.membership_status === 'active' && row.tenant_status === 'active'
    const permissions = permissionsFromJson(row.module_permissions_json)
    if (membershipActive) {
      profile._hasActiveMembership = true
      profile.tenant_ids.push(row.tenant_id)
      if (!profile.active_tenant_id) profile.active_tenant_id = row.tenant_id
      if (row.staff_type && STAFF_TYPES.has(row.staff_type as StaffType)) profile.staff_type = row.staff_type as StaffType
      for (const [moduleId, role] of Object.entries(permissions)) mergePermission(profile.module_permissions, moduleId, role)
    }
    profile.tenants.push({
      id: row.tenant_id,
      name: row.tenant_name || row.tenant_id,
      slug: row.tenant_slug || row.tenant_id,
      role: row.membership_role,
      active: membershipActive,
      module_permissions: permissions,
      staff_type: row.staff_type || defaultStaffType(row.membership_role),
    })
  }

  return [...profiles.values()].map(({ _principalActive, _hasActiveMembership, ...profile }) => ({
    ...profile,
    active: _principalActive && _hasActiveMembership,
    tenant_ids: [...new Set(profile.tenant_ids)],
  }))
}

async function directoryRows(database: D1Database, tenantId: string | null): Promise<DirectoryRow[]> {
  const globalAdminExpression = `EXISTS(
    SELECT 1 FROM tenant_memberships gm
    JOIN tenants gt ON gt.id=gm.tenant_id
    WHERE gm.principal_id=p.id AND gm.status='active' AND gt.status='active' AND gm.role='admin'
  )`

  if (tenantId) {
    const result = await database.prepare(`
      SELECT p.id AS principal_id,p.subject,p.display_name,p.email,p.status AS principal_status,
             m.tenant_id,t.name AS tenant_name,t.slug AS tenant_slug,t.status AS tenant_status,
             m.role AS membership_role,m.status AS membership_status,m.module_permissions_json,m.staff_type,
             ${globalAdminExpression} AS is_global_admin
      FROM tenant_memberships m
      JOIN identity_principals p ON p.id=m.principal_id
      JOIN tenants t ON t.id=m.tenant_id
      WHERE m.tenant_id=?1
      ORDER BY COALESCE(NULLIF(TRIM(p.display_name),''),p.email,p.id),p.id
    `).bind(tenantId).all<DirectoryRow>()
    return result.results
  }

  const result = await database.prepare(`
    SELECT p.id AS principal_id,p.subject,p.display_name,p.email,p.status AS principal_status,
           m.tenant_id,t.name AS tenant_name,t.slug AS tenant_slug,t.status AS tenant_status,
           m.role AS membership_role,m.status AS membership_status,m.module_permissions_json,m.staff_type,
           ${globalAdminExpression} AS is_global_admin
    FROM identity_principals p
    LEFT JOIN tenant_memberships m ON m.principal_id=p.id
    LEFT JOIN tenants t ON t.id=m.tenant_id
    WHERE p.provider='better-auth'
    ORDER BY COALESCE(NULLIF(TRIM(p.display_name),''),p.email,p.id),p.id,t.name,t.id
  `).all<DirectoryRow>()
  return result.results
}

async function listUsers(request: Request, bindings: AdminUsersBindings, actor: Actor): Promise<Response> {
  const url = new URL(request.url)
  const rawTenant = url.searchParams.get('tenant_id')
  const rawModule = url.searchParams.get('module_id')

  if (!rawTenant && !rawModule) {
    if (!actor.globalAdmin) throw new AdminUsersError('FORBIDDEN', 403)
    return json({ profiles: buildProfiles(await directoryRows(bindings.DB!, null)) })
  }

  const tenantId = validId(rawTenant)
  const moduleId = validModule(rawModule)
  if (!tenantId || !moduleId || !MODULE_ROLES[moduleId]) throw new AdminUsersError('INVALID_SCOPE', 400)
  await requireModuleManager(bindings.DB!, actor, tenantId, moduleId)
  return json({ profiles: buildProfiles(await directoryRows(bindings.DB!, tenantId)) })
}

async function targetPrincipal(database: D1Database, principalId: string): Promise<TargetPrincipalRow> {
  const row = await database.prepare(`
    SELECT id,subject,display_name,email,status
    FROM identity_principals
    WHERE id=?1 AND provider='better-auth'
    LIMIT 1
  `).bind(principalId).first<TargetPrincipalRow>()
  if (!row) throw new AdminUsersError('USER_NOT_FOUND', 404)
  return row
}

async function targetMemberships(database: D1Database, principalId: string): Promise<TargetMembershipRow[]> {
  const result = await database.prepare(`
    SELECT tenant_id,role,status,module_permissions_json,staff_type
    FROM tenant_memberships
    WHERE principal_id=?1
    ORDER BY tenant_id
  `).bind(principalId).all<TargetMembershipRow>()
  return result.results
}

async function activeGlobalAdminCount(database: D1Database): Promise<number> {
  const row = await database.prepare(`
    SELECT COUNT(DISTINCT p.id) AS count
    FROM identity_principals p
    JOIN tenant_memberships m ON m.principal_id=p.id
    JOIN tenants t ON t.id=m.tenant_id
    WHERE p.status='active' AND m.status='active' AND t.status='active' AND m.role='admin'
  `).first<{ count: number }>()
  return Number(row?.count || 0)
}

async function targetIsGlobalAdmin(database: D1Database, principalId: string): Promise<boolean> {
  return Boolean(await database.prepare(`
    SELECT 1
    FROM tenant_memberships m
    JOIN tenants t ON t.id=m.tenant_id
    JOIN identity_principals p ON p.id=m.principal_id
    WHERE m.principal_id=?1 AND m.role='admin' AND m.status='active' AND t.status='active' AND p.status='active'
    LIMIT 1
  `).bind(principalId).first())
}

async function createUser(request: Request, bindings: AdminUsersBindings, actor: Actor): Promise<Response> {
  let body: Record<string, unknown>
  try { body = await request.json() as Record<string, unknown> } catch { throw new AdminUsersError('INVALID_JSON', 400) }

  const name = normalizeName(body.full_name)
  const email = normalizeEmail(body.email)
  const password = normalizePassword(body.password, true)!
  const accountRole = String(body.role || 'employee')
  if (accountRole !== 'employee' && accountRole !== 'admin') throw new AdminUsersError('INVALID_ROLE', 400)
  const staffType = accountRole === 'employee' ? normalizeStaffType(body.staff_type) : 'gerente'
  let permissions = normalizePermissions(body.permissions, accountRole === 'admin')
  const tenantIds = normalizeTenantIds(body.tenantIds)
  const scopeModuleId = validModule(body.scopeModuleId)

  if (accountRole === 'admin') {
    if (!actor.globalAdmin) throw new AdminUsersError('FORBIDDEN', 403)
    permissions = { petshop: 'admin_pet' }
  } else if (!actor.globalAdmin) {
    if (!scopeModuleId || !MODULE_ROLES[scopeModuleId] || tenantIds.length !== 1) throw new AdminUsersError('INVALID_SCOPE', 400)
    await requireModuleManager(bindings.DB!, actor, tenantIds[0], scopeModuleId)
    if (Object.keys(permissions).length !== 1 || !permissions[scopeModuleId]) throw new AdminUsersError('INVALID_PERMISSIONS', 400)
  }

  await assertTenants(bindings.DB!, tenantIds)

  const authExisting = await bindings.AUTH_DB!.prepare('SELECT id FROM user WHERE lower(email)=?1 LIMIT 1').bind(email).first()
  const principalExisting = await bindings.DB!.prepare('SELECT id FROM identity_principals WHERE lower(email)=?1 LIMIT 1').bind(email).first()
  if (authExisting || principalExisting) throw new AdminUsersError('EMAIL_ALREADY_EXISTS', 409)

  const userId = crypto.randomUUID()
  const principalId = crypto.randomUUID()
  const now = Date.now()
  const nowIso = new Date(now).toISOString()
  const passwordHash = await hash(password, BCRYPT_ROUNDS)

  try {
    await bindings.AUTH_DB!.batch([
      bindings.AUTH_DB!.prepare('INSERT INTO user(id,name,email,emailVerified,image,createdAt,updatedAt) VALUES(?1,?2,?3,1,NULL,?4,?4)')
        .bind(userId, name, email, nowIso),
      bindings.AUTH_DB!.prepare('INSERT INTO account(id,userId,accountId,providerId,password,createdAt,updatedAt) VALUES(?1,?2,?3,?4,?5,?6,?6)')
        .bind(`credential:${userId}`, userId, userId, 'credential', passwordHash, nowIso),
    ])
  } catch (error) {
    if (String(error).toLowerCase().includes('unique')) throw new AdminUsersError('EMAIL_ALREADY_EXISTS', 409)
    throw error
  }

  const membershipRole = accountRole === 'admin' ? 'admin' : membershipRoleFor(staffType)
  const membershipStaffType = accountRole === 'admin' ? null : staffType
  const permissionJson = JSON.stringify(permissions)
  const mainStatements: D1PreparedStatement[] = [
    bindings.DB!.prepare(`
      INSERT INTO identity_principals(id,provider,subject,display_name,email,status,created_at_ms,updated_at_ms)
      VALUES(?1,'better-auth',?2,?3,?4,'active',?5,?5)
    `).bind(principalId, userId, name, email, now),
  ]
  for (const tenantId of tenantIds) {
    mainStatements.push(bindings.DB!.prepare(`
      INSERT INTO tenant_memberships(
        tenant_id,principal_id,status,created_at_ms,updated_at_ms,role,module_permissions_json,staff_type
      ) VALUES(?1,?2,'active',?3,?3,?4,?5,?6)
    `).bind(tenantId, principalId, now, membershipRole, permissionJson, membershipStaffType))
  }

  try {
    await bindings.DB!.batch(mainStatements)
  } catch (error) {
    try {
      await bindings.AUTH_DB!.batch([
        bindings.AUTH_DB!.prepare('DELETE FROM account WHERE userId=?1').bind(userId),
        bindings.AUTH_DB!.prepare('DELETE FROM user WHERE id=?1').bind(userId),
      ])
    } catch (compensationError) {
      console.error(JSON.stringify({ event: 'admin_users.create_compensation_failed', user_id: userId, error: String(compensationError) }))
    }
    console.error(JSON.stringify({ event: 'admin_users.create_main_failed', principal_id: principalId, error: String(error) }))
    throw new AdminUsersError('CROSS_DATABASE_WRITE_FAILED', 500)
  }

  return json({ id: principalId, user_id: userId, email, active_tenant_id: validId(body.activeTenantId) || tenantIds[0] }, 201)
}

async function updateUser(
  request: Request,
  bindings: AdminUsersBindings,
  actor: Actor,
  principalId: string,
): Promise<Response> {
  const target = await targetPrincipal(bindings.DB!, principalId)
  let body: Record<string, unknown>
  try { body = await request.json() as Record<string, unknown> } catch { throw new AdminUsersError('INVALID_JSON', 400) }

  const name = normalizeName(body.full_name)
  const password = normalizePassword(body.password, false)
  const accountRole = String(body.role || 'employee')
  if (accountRole !== 'employee' && accountRole !== 'admin') throw new AdminUsersError('INVALID_ROLE', 400)
  const staffType = accountRole === 'employee' ? normalizeStaffType(body.staff_type) : 'gerente'
  let permissions = normalizePermissions(body.permissions, accountRole === 'admin')
  const tenantIds = normalizeTenantIds(body.tenantIds)
  const scopeModuleId = validModule(body.scopeModuleId)
  const memberships = await targetMemberships(bindings.DB!, principalId)
  const wasGlobalAdmin = await targetIsGlobalAdmin(bindings.DB!, principalId)

  if (actor.globalAdmin) {
    if (principalId === actor.principalId && accountRole !== 'admin') throw new AdminUsersError('CANNOT_DEMOTE_SELF', 409)
    if (accountRole === 'admin') permissions = { petshop: 'admin_pet' }
    await assertTenants(bindings.DB!, tenantIds)
    if (wasGlobalAdmin && accountRole !== 'admin' && await activeGlobalAdminCount(bindings.DB!) <= 1) {
      throw new AdminUsersError('LAST_GLOBAL_ADMIN', 409)
    }
  } else {
    if (accountRole !== 'employee' || !scopeModuleId || !MODULE_ROLES[scopeModuleId] || tenantIds.length !== 1) {
      throw new AdminUsersError('FORBIDDEN', 403)
    }
    await requireModuleManager(bindings.DB!, actor, tenantIds[0], scopeModuleId)
    const targetMembership = memberships.find((membership) => membership.tenant_id === tenantIds[0])
    if (!targetMembership || targetMembership.status !== 'active' || targetMembership.role === 'admin' || targetMembership.role === 'owner') {
      throw new AdminUsersError('FORBIDDEN', 403)
    }
    if (Object.keys(permissions).length !== 1 || !permissions[scopeModuleId]) throw new AdminUsersError('INVALID_PERMISSIONS', 400)
  }

  const authUser = await bindings.AUTH_DB!.prepare('SELECT id,name FROM user WHERE id=?1 LIMIT 1')
    .bind(target.subject).first<AuthUserSnapshot>()
  const authAccount = await bindings.AUTH_DB!.prepare("SELECT id,password FROM account WHERE userId=?1 AND providerId='credential' LIMIT 1")
    .bind(target.subject).first<AuthAccountSnapshot>()
  if (!authUser || !authAccount) throw new AdminUsersError('CREDENTIAL_NOT_FOUND', 409)

  const now = Date.now()
  const nowIso = new Date(now).toISOString()
  const nextPasswordHash = password ? await hash(password, BCRYPT_ROUNDS) : null
  const authStatements: D1PreparedStatement[] = [
    bindings.AUTH_DB!.prepare('UPDATE user SET name=?1,updatedAt=?2 WHERE id=?3').bind(name, nowIso, target.subject),
  ]
  if (nextPasswordHash) {
    authStatements.push(bindings.AUTH_DB!.prepare('UPDATE account SET password=?1,updatedAt=?2 WHERE id=?3')
      .bind(nextPasswordHash, nowIso, authAccount.id))
  }
  await bindings.AUTH_DB!.batch(authStatements)

  const mainStatements: D1PreparedStatement[] = [
    bindings.DB!.prepare('UPDATE identity_principals SET display_name=?1,updated_at_ms=?2 WHERE id=?3')
      .bind(name, now, principalId),
  ]

  if (actor.globalAdmin) {
    const placeholders = tenantIds.map((_, index) => `?${index + 3}`).join(',')
    mainStatements.push(bindings.DB!.prepare(`
      UPDATE tenant_memberships
      SET status='inactive',updated_at_ms=?1
      WHERE principal_id=?2 AND status='active' AND tenant_id NOT IN (${placeholders})
    `).bind(now, principalId, ...tenantIds))

    const membershipRole = accountRole === 'admin' ? 'admin' : membershipRoleFor(staffType)
    const membershipStaffType = accountRole === 'admin' ? null : staffType
    const permissionJson = JSON.stringify(permissions)
    for (const tenantId of tenantIds) {
      mainStatements.push(bindings.DB!.prepare(`
        INSERT INTO tenant_memberships(
          tenant_id,principal_id,status,created_at_ms,updated_at_ms,role,module_permissions_json,staff_type
        ) VALUES(?1,?2,'active',?3,?3,?4,?5,?6)
        ON CONFLICT(tenant_id,principal_id) DO UPDATE SET
          status='active',updated_at_ms=excluded.updated_at_ms,role=excluded.role,
          module_permissions_json=excluded.module_permissions_json,staff_type=excluded.staff_type
      `).bind(tenantId, principalId, now, membershipRole, permissionJson, membershipStaffType))
    }
  } else {
    const tenantId = tenantIds[0]
    const existing = memberships.find((membership) => membership.tenant_id === tenantId)!
    const nextPermissions = permissionsFromJson(existing.module_permissions_json)
    nextPermissions[scopeModuleId!] = permissions[scopeModuleId!]
    mainStatements.push(bindings.DB!.prepare(`
      UPDATE tenant_memberships
      SET role=?1,module_permissions_json=?2,staff_type=?3,updated_at_ms=?4
      WHERE tenant_id=?5 AND principal_id=?6 AND status='active'
    `).bind(membershipRoleFor(staffType), JSON.stringify(nextPermissions), staffType, now, tenantId, principalId))
  }

  try {
    await bindings.DB!.batch(mainStatements)
  } catch (error) {
    try {
      const compensation: D1PreparedStatement[] = [
        bindings.AUTH_DB!.prepare('UPDATE user SET name=?1 WHERE id=?2').bind(authUser.name, target.subject),
      ]
      if (nextPasswordHash) {
        compensation.push(bindings.AUTH_DB!.prepare('UPDATE account SET password=?1 WHERE id=?2').bind(authAccount.password, authAccount.id))
      }
      await bindings.AUTH_DB!.batch(compensation)
    } catch (compensationError) {
      console.error(JSON.stringify({ event: 'admin_users.update_compensation_failed', principal_id: principalId, error: String(compensationError) }))
    }
    console.error(JSON.stringify({ event: 'admin_users.update_main_failed', principal_id: principalId, error: String(error) }))
    throw new AdminUsersError('CROSS_DATABASE_WRITE_FAILED', 500)
  }

  return json({ id: principalId, updated: true })
}

async function updateStatus(
  request: Request,
  bindings: AdminUsersBindings,
  actor: Actor,
  principalId: string,
): Promise<Response> {
  if (!actor.globalAdmin) throw new AdminUsersError('FORBIDDEN', 403)
  const target = await targetPrincipal(bindings.DB!, principalId)
  let body: Record<string, unknown>
  try { body = await request.json() as Record<string, unknown> } catch { throw new AdminUsersError('INVALID_JSON', 400) }
  if (typeof body.active !== 'boolean') throw new AdminUsersError('INVALID_JSON', 400)

  if (!body.active && principalId === actor.principalId) throw new AdminUsersError('CANNOT_DEACTIVATE_SELF', 409)
  if (!body.active && await targetIsGlobalAdmin(bindings.DB!, principalId) && await activeGlobalAdminCount(bindings.DB!) <= 1) {
    throw new AdminUsersError('LAST_GLOBAL_ADMIN', 409)
  }

  await bindings.DB!.prepare("UPDATE identity_principals SET status=?1,updated_at_ms=?2 WHERE id=?3")
    .bind(body.active ? 'active' : 'inactive', Date.now(), principalId).run()

  if (!body.active) {
    try {
      await bindings.AUTH_DB!.prepare('DELETE FROM session WHERE userId=?1').bind(target.subject).run()
    } catch (error) {
      console.error(JSON.stringify({ event: 'admin_users.session_revoke_failed', principal_id: principalId, error: String(error) }))
    }
  }

  return json({ id: principalId, active: body.active })
}

export async function handleAdminUsersApiRequest(
  request: Request,
  bindings: AdminUsersBindings,
  dependencies: AdminUsersApiDependencies = {},
): Promise<Response | null> {
  const pathname = new URL(request.url).pathname
  if (!pathname.startsWith('/api/admin/users')) return null

  try {
    const actor = await resolveActor(request, bindings, dependencies.getSession || getBetterAuthSession)

    if (pathname === '/api/admin/users') {
      if (request.method === 'GET') return await listUsers(request, bindings, actor)
      if (request.method === 'POST') return await createUser(request, bindings, actor)
      return json({ error: { code: 'METHOD_NOT_ALLOWED', message: 'Metodo nao permitido.' } }, 405, { allow: 'GET,POST' })
    }

    const statusMatch = /^\/api\/admin\/users\/([^/]+)\/status$/.exec(pathname)
    if (statusMatch) {
      const principalId = validId(decodeURIComponent(statusMatch[1]))
      if (!principalId) throw new AdminUsersError('USER_NOT_FOUND', 404)
      if (request.method === 'PATCH') return await updateStatus(request, bindings, actor, principalId)
      return json({ error: { code: 'METHOD_NOT_ALLOWED', message: 'Metodo nao permitido.' } }, 405, { allow: 'PATCH' })
    }

    const userMatch = /^\/api\/admin\/users\/([^/]+)$/.exec(pathname)
    if (userMatch) {
      const principalId = validId(decodeURIComponent(userMatch[1]))
      if (!principalId) throw new AdminUsersError('USER_NOT_FOUND', 404)
      if (request.method === 'PATCH') return await updateUser(request, bindings, actor, principalId)
      return json({ error: { code: 'METHOD_NOT_ALLOWED', message: 'Metodo nao permitido.' } }, 405, { allow: 'PATCH' })
    }

    return json({ error: { code: 'NOT_FOUND', message: 'Rota nao encontrada.' } }, 404)
  } catch (error) {
    return failure(error)
  }
}
