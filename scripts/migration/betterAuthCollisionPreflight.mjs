import { execFile as execFileCallback } from 'node:child_process'
import { resolve } from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

const execFileAsync = promisify(execFileCallback)
const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url))
const WRANGLER_CLI = resolve(REPO_ROOT, 'node_modules/wrangler/bin/wrangler.js')
const ALLOWED_ENVIRONMENTS = new Set(['staging', 'production'])

export class BetterAuthCollisionPreflightError extends Error {
  constructor(code, message = 'Better Auth collision preflight failed.', details = null) {
    super(message)
    this.name = 'BetterAuthCollisionPreflightError'
    this.code = code
    this.details = details
  }
}

function text(value) { return value == null ? '' : String(value).trim() }
function lower(value) { return text(value).toLowerCase() }
function sql(value) { return `'${String(value).replaceAll("'", "''")}'` }
function list(values) {
  const normalized = [...new Set(values.map(text).filter(Boolean))]
  return normalized.length ? normalized.map(sql).join(',') : "''"
}

function normalizeProjection(projection) {
  if (!projection?.sensitive) throw new BetterAuthCollisionPreflightError('AUTH_PREFLIGHT_SENSITIVE_PROJECTION_REQUIRED')
  const users = Array.isArray(projection.authUsers) ? projection.authUsers : []
  const accounts = Array.isArray(projection.authAccounts) ? projection.authAccounts : []
  const principals = Array.isArray(projection.principals) ? projection.principals : []
  const memberships = Array.isArray(projection.tenantMemberships) ? projection.tenantMemberships : []
  if (!users.length || users.length !== accounts.length || users.length !== principals.length || users.length !== memberships.length) {
    throw new BetterAuthCollisionPreflightError('AUTH_PREFLIGHT_PROJECTION_INVALID')
  }
  const tenantIds = [...new Set(memberships.map((row) => text(row.tenant_id)).filter(Boolean))]
  if (tenantIds.length !== 1) throw new BetterAuthCollisionPreflightError('AUTH_PREFLIGHT_TENANT_INVALID')
  return { users, accounts, principals, memberships, tenantId: tenantIds[0] }
}

export function buildBetterAuthCollisionQueries(projection) {
  const input = normalizeProjection(projection)
  const userIds = input.users.map((row) => row.id)
  const emails = input.users.map((row) => lower(row.email))
  const accountIds = input.accounts.map((row) => row.id)
  return {
    authUsers: `SELECT id,name,email,emailVerified,image FROM user WHERE id IN (${list(userIds)}) OR lower(email) IN (${list(emails)}) ORDER BY id;`,
    authAccounts: `SELECT id,userId,accountId,providerId FROM account WHERE id IN (${list(accountIds)}) OR userId IN (${list(userIds)}) ORDER BY id;`,
    principals: `SELECT id,provider,subject,display_name,email,status FROM identity_principals WHERE id IN (${list(userIds)}) OR (provider='better-auth' AND subject IN (${list(userIds)})) OR lower(COALESCE(email,'')) IN (${list(emails)}) ORDER BY id;`,
    memberships: `SELECT tenant_id,principal_id,status,role,module_permissions_json FROM tenant_memberships WHERE tenant_id=${sql(input.tenantId)} AND principal_id IN (${list(userIds)}) ORDER BY principal_id;`,
    tenant: `SELECT id,slug,name,status FROM tenants WHERE id=${sql(input.tenantId)};`,
  }
}

function equalNullable(left, right) {
  return (left == null ? null : String(left)) === (right == null ? null : String(right))
}

function exactUser(existing, expected) {
  return text(existing.id) === text(expected.id)
    && lower(existing.email) === lower(expected.email)
}
function exactAccount(existing, expected) {
  return text(existing.id) === text(expected.id)
    && text(existing.userId) === text(expected.userId)
    && text(existing.accountId) === text(expected.accountId)
    && text(existing.providerId) === text(expected.providerId)
}
function exactPrincipal(existing, expected) {
  return text(existing.id) === text(expected.id)
    && text(existing.provider) === text(expected.provider)
    && text(existing.subject) === text(expected.subject)
    && lower(existing.email) === lower(expected.email)
}
function exactMembership(existing, expected) {
  return text(existing.tenant_id) === text(expected.tenant_id)
    && text(existing.principal_id) === text(expected.principal_id)
    && text(existing.role) === text(expected.role)
    && equalNullable(existing.module_permissions_json, expected.module_permissions_json)
}

function classifyRows(existingRows, expectedRows, exact, uniqueCandidates) {
  const byExpected = []
  const used = new Set()
  for (const expected of expectedRows) {
    const candidates = existingRows.filter((existing, index) => !used.has(index) && uniqueCandidates(existing, expected))
    if (!candidates.length) {
      byExpected.push({ status: 'free', expected_id: text(expected.id || expected.principal_id) })
      continue
    }
    if (candidates.length === 1 && exact(candidates[0], expected)) {
      const index = existingRows.indexOf(candidates[0])
      used.add(index)
      byExpected.push({ status: 'exact_retry', expected_id: text(expected.id || expected.principal_id) })
      continue
    }
    byExpected.push({ status: 'collision', expected_id: text(expected.id || expected.principal_id), matches: candidates.length })
  }
  const unclaimed = existingRows.filter((_, index) => !used.has(index))
  return { rows: byExpected, unclaimed }
}

export function evaluateBetterAuthCollisionPreflight({ projection, target = {}, allowExistingTenant = false } = {}) {
  const input = normalizeProjection(projection)
  const authUsers = Array.isArray(target.authUsers) ? target.authUsers : []
  const authAccounts = Array.isArray(target.authAccounts) ? target.authAccounts : []
  const principals = Array.isArray(target.principals) ? target.principals : []
  const memberships = Array.isArray(target.memberships) ? target.memberships : []
  const tenantRows = Array.isArray(target.tenant) ? target.tenant : []

  const users = classifyRows(authUsers, input.users, exactUser,
    (existing, expected) => text(existing.id) === text(expected.id) || lower(existing.email) === lower(expected.email))
  const accounts = classifyRows(authAccounts, input.accounts, exactAccount,
    (existing, expected) => text(existing.id) === text(expected.id) || text(existing.userId) === text(expected.userId))
  const principalResult = classifyRows(principals, input.principals, exactPrincipal,
    (existing, expected) => text(existing.id) === text(expected.id)
      || (text(existing.provider) === text(expected.provider) && text(existing.subject) === text(expected.subject))
      || (lower(existing.email) && lower(existing.email) === lower(expected.email)))
  const membershipResult = classifyRows(memberships, input.memberships, exactMembership,
    (existing, expected) => text(existing.tenant_id) === text(expected.tenant_id) && text(existing.principal_id) === text(expected.principal_id))

  const collisions = [...users.rows, ...accounts.rows, ...principalResult.rows, ...membershipResult.rows]
    .filter((row) => row.status === 'collision')
  const unclaimed = users.unclaimed.length + accounts.unclaimed.length + principalResult.unclaimed.length + membershipResult.unclaimed.length
  const tenantOk = tenantRows.length === 0 || (allowExistingTenant === true && tenantRows.length === 1 && text(tenantRows[0].id) === input.tenantId)
  const ok = collisions.length === 0 && unclaimed === 0 && tenantOk

  return {
    ok,
    tenant: { status: tenantRows.length === 0 ? 'free' : tenantOk ? 'existing_allowed' : 'collision', rows: tenantRows.length },
    users: users.rows,
    accounts: accounts.rows,
    principals: principalResult.rows,
    memberships: membershipResult.rows,
    collision_count: collisions.length + unclaimed + (tenantOk ? 0 : 1),
  }
}

export function unwrapD1Json(stdout) {
  const raw = String(stdout || '').replace(/\u001b\[[0-9;]*m/gu, '').trim()
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    const arrayStart = raw.indexOf('[')
    const objectStart = raw.indexOf('{')
    const starts = [arrayStart, objectStart].filter((value) => value >= 0)
    const start = starts.length ? Math.min(...starts) : -1
    const end = Math.max(raw.lastIndexOf(']'), raw.lastIndexOf('}'))
    if (start < 0 || end < start) throw new BetterAuthCollisionPreflightError('AUTH_PREFLIGHT_D1_JSON_INVALID')
    try { parsed = JSON.parse(raw.slice(start, end + 1)) } catch {
      throw new BetterAuthCollisionPreflightError('AUTH_PREFLIGHT_D1_JSON_INVALID')
    }
  }
  const blocks = Array.isArray(parsed) ? parsed : [parsed]
  const rows = []
  for (const block of blocks) {
    if (Array.isArray(block?.results)) rows.push(...block.results)
    else if (Array.isArray(block?.result?.[0]?.results)) rows.push(...block.result[0].results)
    else if (Array.isArray(block?.result)) {
      for (const item of block.result) if (Array.isArray(item?.results)) rows.push(...item.results)
    }
  }
  return rows
}

export function createRemoteBetterAuthCollisionPreflight({
  execFile = execFileAsync,
  environment = 'staging',
  configPath = 'apps/edge-api/wrangler.jsonc',
} = {}) {
  if (!ALLOWED_ENVIRONMENTS.has(environment)) throw new BetterAuthCollisionPreflightError('AUTH_PREFLIGHT_ENVIRONMENT_INVALID')
  const resolvedConfig = resolve(REPO_ROOT, configPath)

  return async function preflight({ projection, allowExistingTenant = false } = {}) {
    const queries = buildBetterAuthCollisionQueries(projection)
    const run = async (binding, name, query) => {
      if (!/^SELECT\s/iu.test(query) || query.slice(0, -1).includes(';')) {
        throw new BetterAuthCollisionPreflightError('AUTH_PREFLIGHT_QUERY_NOT_READ_ONLY', undefined, { binding, query: name })
      }
      try {
        // Wrangler's --file mode reports only import statistics, not SELECT
        // result rows. These fixed, internally generated lookups contain no
        // password hashes and use --command so collision rows are observable.
        const { stdout } = await execFile(process.execPath, [WRANGLER_CLI,'d1','execute',binding,'--remote','--env',environment,'--config',resolvedConfig,'--command',query,'--json'], {
          cwd: REPO_ROOT,
          encoding: 'utf8',
          maxBuffer: 8 * 1024 * 1024,
          windowsHide: true,
          env: process.env,
        })
        return unwrapD1Json(stdout)
      } catch (error) {
        if (error instanceof BetterAuthCollisionPreflightError) throw error
        throw new BetterAuthCollisionPreflightError('AUTH_PREFLIGHT_D1_QUERY_FAILED', undefined, { binding, query: name })
      }
    }

    const target = {
      authUsers: await run('AUTH_DB', 'users', queries.authUsers),
      authAccounts: await run('AUTH_DB', 'accounts', queries.authAccounts),
      principals: await run('DB', 'principals', queries.principals),
      memberships: await run('DB', 'memberships', queries.memberships),
      tenant: await run('DB', 'tenant', queries.tenant),
    }
    const report = evaluateBetterAuthCollisionPreflight({ projection, target, allowExistingTenant })
    if (!report.ok) throw new BetterAuthCollisionPreflightError('AUTH_PREFLIGHT_COLLISION', undefined, report)
    return report
  }
}
