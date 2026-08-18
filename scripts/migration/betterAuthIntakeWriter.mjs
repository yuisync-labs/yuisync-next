import { execFile as execFileCallback } from 'node:child_process'
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

const execFileAsync = promisify(execFileCallback)
const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url))
const ALLOWED_ENVIRONMENTS = new Set(['staging', 'production'])

export class BetterAuthIntakeWriterError extends Error {
  constructor(code, message = 'Better Auth intake write failed.') {
    super(message)
    this.name = 'BetterAuthIntakeWriterError'
    this.code = code
  }
}

function text(value) { return value == null ? '' : String(value).trim() }
function sql(value) {
  if (value == null) return 'NULL'
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) throw new BetterAuthIntakeWriterError('AUTH_INTAKE_NUMBER_INVALID')
    return String(value)
  }
  return `'${String(value).replaceAll("'", "''")}'`
}

function requireAuthorized(environment, runId, productionAuthorization, collisionCheckPassed) {
  if (!ALLOWED_ENVIRONMENTS.has(environment)) throw new BetterAuthIntakeWriterError('AUTH_INTAKE_ENVIRONMENT_INVALID')
  if (collisionCheckPassed !== true) throw new BetterAuthIntakeWriterError('AUTH_INTAKE_COLLISION_CHECK_REQUIRED')
  if (environment === 'production' && productionAuthorization !== `AUTHORIZE_MIGRATION_RUN:${runId}`) {
    throw new BetterAuthIntakeWriterError('AUTH_INTAKE_PRODUCTION_NOT_AUTHORIZED')
  }
}

export function buildBetterAuthIntakeSql(projection) {
  if (!projection?.sensitive) throw new BetterAuthIntakeWriterError('AUTH_INTAKE_SENSITIVE_PROJECTION_REQUIRED')
  const authUsers = projection.authUsers || []
  const authAccounts = projection.authAccounts || []
  const principals = projection.principals || []
  const memberships = projection.tenantMemberships || []
  const profiles = projection.managedProfiles || []
  if (![authUsers, authAccounts, principals, memberships, profiles].every(Array.isArray)) throw new BetterAuthIntakeWriterError('AUTH_INTAKE_PROJECTION_INVALID')
  if (authUsers.length !== authAccounts.length || authUsers.length !== principals.length || authUsers.length !== memberships.length || authUsers.length !== profiles.length) {
    throw new BetterAuthIntakeWriterError('AUTH_INTAKE_COUNT_MISMATCH')
  }

  const auth = ['PRAGMA foreign_keys=ON;', 'BEGIN IMMEDIATE;']
  for (const user of authUsers) {
    auth.push(`INSERT INTO user(id,name,email,emailVerified,image,createdAt,updatedAt) VALUES(${sql(user.id)},${sql(user.name)},${sql(user.email)},${sql(user.emailVerified)},${sql(user.image)},${sql(user.createdAt)},${sql(user.updatedAt)}) ON CONFLICT(id) DO UPDATE SET name=excluded.name,email=excluded.email,emailVerified=excluded.emailVerified,image=excluded.image,updatedAt=excluded.updatedAt;`)
  }
  for (const account of authAccounts) {
    auth.push(`INSERT INTO account(id,userId,accountId,providerId,password,createdAt,updatedAt) VALUES(${sql(account.id)},${sql(account.userId)},${sql(account.accountId)},${sql(account.providerId)},${sql(account.password)},${sql(account.createdAt)},${sql(account.updatedAt)}) ON CONFLICT(id) DO UPDATE SET password=excluded.password,updatedAt=excluded.updatedAt;`)
  }
  auth.push('COMMIT;')

  const main = ['PRAGMA foreign_keys=ON;', 'BEGIN IMMEDIATE;']
  for (const principal of principals) {
    main.push(`INSERT INTO identity_principals(id,provider,subject,display_name,email,status,created_at_ms,updated_at_ms) VALUES(${sql(principal.id)},${sql(principal.provider)},${sql(principal.subject)},${sql(principal.display_name)},${sql(principal.email)},${sql(principal.status)},${sql(principal.created_at_ms)},${sql(principal.updated_at_ms)}) ON CONFLICT(id) DO UPDATE SET provider=excluded.provider,subject=excluded.subject,display_name=excluded.display_name,email=excluded.email,status=excluded.status,updated_at_ms=excluded.updated_at_ms;`)
  }
  for (const membership of memberships) {
    main.push(`INSERT INTO tenant_memberships(tenant_id,principal_id,status,created_at_ms,updated_at_ms,role,module_permissions_json) VALUES(${sql(membership.tenant_id)},${sql(membership.principal_id)},${sql(membership.status)},${sql(membership.created_at_ms)},${sql(membership.updated_at_ms)},${sql(membership.role)},${sql(membership.module_permissions_json)}) ON CONFLICT(tenant_id,principal_id) DO UPDATE SET status=excluded.status,role=excluded.role,module_permissions_json=excluded.module_permissions_json,updated_at_ms=excluded.updated_at_ms;`)
  }
  for (const profile of profiles) {
    main.push(`INSERT INTO managed_user_profiles(principal_id,staff_type,preferred_tenant_id,created_at_ms,updated_at_ms) VALUES(${sql(profile.principal_id)},${sql(profile.staff_type)},${sql(profile.preferred_tenant_id)},${sql(profile.created_at_ms)},${sql(profile.updated_at_ms)}) ON CONFLICT(principal_id) DO UPDATE SET staff_type=excluded.staff_type,preferred_tenant_id=excluded.preferred_tenant_id,updated_at_ms=excluded.updated_at_ms;`)
  }
  main.push('COMMIT;')
  return { authSql: auth.join('\n'), mainSql: main.join('\n') }
}

export function createBetterAuthIntakeWriter({
  execFile = execFileAsync,
  environment = 'staging',
  configPath = 'apps/edge-api/wrangler.jsonc',
  productionAuthorization = null,
  collisionCheckPassed = false,
} = {}) {
  const resolvedConfig = resolve(REPO_ROOT, configPath)
  return async function writeBetterAuth({ runId, projection }) {
    const normalizedRun = text(runId)
    if (!normalizedRun) throw new BetterAuthIntakeWriterError('AUTH_INTAKE_RUN_REQUIRED')
    requireAuthorized(environment, normalizedRun, productionAuthorization, collisionCheckPassed)
    const { authSql, mainSql } = buildBetterAuthIntakeSql(projection)
    const directory = await mkdtemp(join(tmpdir(), 'yuisync-auth-migration-'))
    const authFile = join(directory, 'auth.sql')
    const mainFile = join(directory, 'main.sql')
    const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
    const execute = async (binding, file) => {
      try {
        await execFile(npm, ['exec','--workspace','@yuisync/edge-api','--','wrangler','d1','execute',binding,'--remote','--env',environment,'--config',resolvedConfig,'--file',file], {
          cwd: REPO_ROOT,
          encoding: 'utf8',
          maxBuffer: 8 * 1024 * 1024,
          windowsHide: true,
          env: process.env,
        })
      } catch {
        throw new BetterAuthIntakeWriterError(`AUTH_INTAKE_${binding}_WRITE_FAILED`)
      }
    }
    try {
      await writeFile(authFile, authSql, { encoding: 'utf8', mode: 0o600 })
      await writeFile(mainFile, mainSql, { encoding: 'utf8', mode: 0o600 })
      await chmod(authFile, 0o600)
      await chmod(mainFile, 0o600)
      // AUTH_DB first. If DB fails, the operation is retryable after the collision gate
      // confirms the exact same identities; Supabase sessions are never copied.
      await execute('AUTH_DB', authFile)
      await execute('DB', mainFile)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  }
}
