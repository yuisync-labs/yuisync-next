export class SupabaseBetterAuthIntakeError extends Error {
  constructor(code, message = 'Supabase Better Auth intake failed.') {
    super(message)
    this.name = 'SupabaseBetterAuthIntakeError'
    this.code = code
  }
}

const BCRYPT = /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/u
const STAFF_TYPES = new Set(['funcionario','banho_tosa','veterinaria','motodog','vendedor_caixa','gerente'])

function text(value) { return value == null ? '' : String(value).trim() }
function email(value) { return text(value).toLowerCase() }
function status(active) { return active === false ? 'inactive' : active === true ? 'active' : null }

function permissions(profile) {
  const raw = profile?.module_permissions
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  return Object.fromEntries(Object.entries(raw)
    .map(([moduleId, role]) => [text(moduleId).toLowerCase(), text(role)])
    .filter(([moduleId, role]) => /^[a-z0-9][a-z0-9_-]{0,63}$/u.test(moduleId) && role))
}

function storedPermissions(profile) {
  return JSON.stringify(Object.fromEntries(Object.entries(permissions(profile)).map(([moduleId, role]) => [moduleId, { role }])))
}

function membershipRole(profile, membership) {
  const legacy = text(membership?.role).toLowerCase()
  if (legacy === 'owner') return 'owner'
  if (legacy === 'admin') return 'admin'
  if (legacy === 'manager') return 'manager'
  if (text(profile?.staff_type) === 'gerente') return 'manager'
  return 'staff'
}

export function projectSupabaseUsersToBetterAuth({ users = [], profiles = [], memberships = [], tenantId, now = Date.now() } = {}) {
  const selectedTenant = text(tenantId)
  if (!selectedTenant) throw new SupabaseBetterAuthIntakeError('TENANT_REQUIRED')
  if (![users, profiles, memberships].every(Array.isArray)) throw new SupabaseBetterAuthIntakeError('INPUT_INVALID')

  const usersById = new Map(users.map((row) => [text(row?.id), row]).filter(([id]) => id))
  const profilesById = new Map(profiles.map((row) => [text(row?.id), row]).filter(([id]) => id))
  const explicit = memberships.filter((row) => text(row?.tenant_id) === selectedTenant)
  const seen = new Set()

  const authUsers = []
  const authAccounts = []
  const principals = []
  const tenantMemberships = []
  const managedProfiles = []

  for (const membership of explicit) {
    const userId = text(membership?.profile_id)
    if (!userId || seen.has(userId)) throw new SupabaseBetterAuthIntakeError(seen.has(userId) ? 'DUPLICATE_MEMBERSHIP' : 'MEMBERSHIP_PROFILE_REQUIRED')
    seen.add(userId)
    const profile = profilesById.get(userId)
    const user = usersById.get(userId)
    if (!profile) throw new SupabaseBetterAuthIntakeError('PROFILE_NOT_FOUND')
    if (!user) throw new SupabaseBetterAuthIntakeError('AUTH_USER_NOT_FOUND')

    const userEmail = email(user.email || profile.email)
    const profileEmail = email(profile.email)
    if (!userEmail || (profileEmail && userEmail !== profileEmail)) throw new SupabaseBetterAuthIntakeError('EMAIL_MISMATCH')
    const hash = text(user.encrypted_password)
    if (!BCRYPT.test(hash)) throw new SupabaseBetterAuthIntakeError('AUTH_PASSWORD_NOT_BCRYPT')
    const principalStatus = status(profile.active)
    const membershipStatus = status(membership.active)
    if (!principalStatus || !membershipStatus) throw new SupabaseBetterAuthIntakeError('ACTIVE_STATUS_INVALID')
    const staffType = STAFF_TYPES.has(text(profile.staff_type)) ? text(profile.staff_type) : 'funcionario'
    const name = text(profile.full_name) || userEmail

    // Preserve the Supabase UUID as Better Auth user/principal identity. Password hashes
    // are sensitive output and must never enter regular manifests, logs, or artifacts.
    authUsers.push({ id: userId, name, email: userEmail, emailVerified: user.email_confirmed_at ? 1 : 0, image: profile.avatar_url || null, createdAt: now, updatedAt: now })
    authAccounts.push({ id: `credential:${userId}`, userId, accountId: userId, providerId: 'credential', password: hash, createdAt: now, updatedAt: now })
    principals.push({ id: userId, provider: 'better-auth', subject: userId, display_name: name, email: userEmail, status: principalStatus, created_at_ms: now, updated_at_ms: now })
    tenantMemberships.push({
      tenant_id: selectedTenant,
      principal_id: userId,
      status: principalStatus === 'active' && membershipStatus === 'active' ? 'active' : 'inactive',
      role: membershipRole(profile, membership),
      module_permissions_json: storedPermissions(profile),
      created_at_ms: now,
      updated_at_ms: now,
    })
    managedProfiles.push({ principal_id: userId, staff_type: staffType, preferred_tenant_id: selectedTenant, created_at_ms: now, updated_at_ms: now })
  }

  return {
    sensitive: true,
    counts: { users: authUsers.length, memberships: tenantMemberships.length },
    authUsers,
    authAccounts,
    principals,
    tenantMemberships,
    managedProfiles,
  }
}
