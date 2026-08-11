#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const REPO_ROOT = resolve(new URL('../../', import.meta.url).pathname)
const EDGE_DIR = resolve(REPO_ROOT, 'apps/edge-api')
const FIXTURE_PATH = resolve(REPO_ROOT, '.artifacts/staging-e2e/fixture.json')
const BASE_URL = String(process.env.E2E_BASE_URL || process.env.YUISYNC_E2E_BASE_URL || process.env.YUISYNC_STAGING_URL || '').replace(/\/$/, '')
const WRANGLER_ENV = String(process.env.YUISYNC_E2E_WRANGLER_ENV || 'staging').trim()

if (!BASE_URL.startsWith('https://')) throw new Error('STAGING_MANAGED_USERS_BASE_URL_REQUIRED')
if (!/^[A-Za-z0-9_-]+$/.test(WRANGLER_ENV)) throw new Error(`INVALID_WRANGLER_ENV:${WRANGLER_ENV}`)

function sql(value) {
  if (value == null) return 'NULL'
  return `'${String(value).replaceAll("'", "''")}'`
}

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: options.cwd || REPO_ROOT,
    encoding: 'utf8',
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 16 * 1024 * 1024,
  }).trim()
}

function wrangler(args) {
  return run('npx', ['wrangler', ...args], { cwd: EDGE_DIR })
}

function d1Run(binding, statement) {
  wrangler(['d1', 'execute', binding, '--env', WRANGLER_ENV, '--remote', '--command', statement])
}

function d1Rows(binding, statement) {
  const output = wrangler(['d1', 'execute', binding, '--env', WRANGLER_ENV, '--remote', '--json', '--command', statement])
  const parsed = JSON.parse(output)
  const result = Array.isArray(parsed) ? parsed[0] : parsed
  return Array.isArray(result?.results) ? result.results : []
}

function cookieHeader(response) {
  const values = typeof response.headers.getSetCookie === 'function'
    ? response.headers.getSetCookie()
    : [response.headers.get('set-cookie')].filter(Boolean)
  return values.map((value) => String(value).split(';')[0]).filter(Boolean).join('; ')
}

async function jsonResponse(response) {
  const body = await response.json().catch(() => ({}))
  return { response, body }
}

function assert(condition, code, details = {}) {
  if (!condition) throw new Error(`${code}:${JSON.stringify(details)}`)
}

function sleep(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms))
}

async function waitForManagedUsersRoute() {
  const attempts = 45
  let last = null
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const response = await fetch(`${BASE_URL}/api/admin/users?deployment_probe=${Date.now()}-${attempt}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'cache-control': 'no-cache', origin: BASE_URL },
      cache: 'no-store',
      body: '{}',
    })
    last = {
      attempt,
      status: response.status,
      url: response.url,
      redirected: response.redirected,
      body: await response.text().catch(() => ''),
    }
    if (response.status === 401) return last
    if (response.status !== 405 && response.status !== 404) {
      throw new Error(`STAGING_MANAGED_USERS_ROUTE_UNEXPECTED:${JSON.stringify(last)}`)
    }
    if (attempt < attempts) await sleep(1000)
  }
  throw new Error(`STAGING_MANAGED_USERS_ROUTE_NOT_DEPLOYED:${JSON.stringify(last)}`)
}

async function signIn(email, password) {
  const result = await jsonResponse(await fetch(`${BASE_URL}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: BASE_URL },
    body: JSON.stringify({ email, password, rememberMe: false }),
  }))
  return { ...result, cookie: cookieHeader(result.response) }
}

async function api(path, { method = 'GET', cookie = '', body } = {}) {
  return jsonResponse(await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(cookie ? { cookie } : {}),
      origin: BASE_URL,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }))
}

const fixture = JSON.parse(await readFile(FIXTURE_PATH, 'utf8'))
const tenantId = String(fixture?.tenantId || '')
const runId = String(fixture?.runId || '')
const adminEmail = String(process.env.E2E_EMAIL || '')
const adminPassword = String(process.env.E2E_PASSWORD || '')

assert(tenantId.startsWith('e2e-') && tenantId.endsWith('-tenant'), 'UNSAFE_FIXTURE_TENANT', { tenantId })
assert(runId.startsWith('e2e-'), 'INVALID_FIXTURE_RUN', { runId })
assert(adminEmail.endsWith('@staging.invalid') && adminPassword.length >= 12, 'STAGING_E2E_CREDENTIALS_REQUIRED')

const managedEmail = `${runId}-managed@staging.invalid`
const initialPassword = `${runId}Aa1!Managed`
const updatedPassword = `${runId}Zz9!Updated`
let createdPrincipalId = ''
let createdAuthUserId = ''

try {
  const routeProbe = await waitForManagedUsersRoute()
  console.log(JSON.stringify({ event: 'staging.managed_users.route.ready', attempt: routeProbe.attempt, status: routeProbe.status }))

  const adminSignIn = await signIn(adminEmail, adminPassword)
  assert(adminSignIn.response.status === 200, 'STAGING_MANAGED_USERS_ADMIN_SIGN_IN_FAILED', { status: adminSignIn.response.status, body: adminSignIn.body })
  assert(adminSignIn.cookie.includes('better-auth'), 'STAGING_MANAGED_USERS_ADMIN_SESSION_COOKIE_MISSING')

  const created = await api('/api/admin/users', {
    method: 'POST',
    cookie: adminSignIn.cookie,
    body: {
      full_name: 'E2E Managed User',
      email: managedEmail,
      password: initialPassword,
      role: 'employee',
      staff_type: 'banho_tosa',
      permissions: { petshop: 'funcionario_pet' },
      scopeModuleId: 'petshop',
      tenantIds: [tenantId],
      activeTenantId: tenantId,
    },
  })
  assert(created.response.status === 201, 'STAGING_MANAGED_USERS_CREATE_FAILED', { status: created.response.status, body: created.body })
  createdPrincipalId = String(created.body?.profile?.id || '')
  assert(Boolean(createdPrincipalId), 'STAGING_MANAGED_USERS_CREATE_ID_MISSING', created.body)
  assert(created.body?.profile?.staff_type === 'banho_tosa', 'STAGING_MANAGED_USERS_CREATE_STAFF_TYPE_MISMATCH', created.body)
  assert(created.body?.profile?.role === 'employee', 'STAGING_MANAGED_USERS_CREATE_ROLE_MISMATCH', created.body)
  assert(created.body?.profile?.active_tenant_id === tenantId, 'STAGING_MANAGED_USERS_CREATE_ACTIVE_TENANT_MISMATCH', created.body)
  assert(Array.isArray(created.body?.profile?.tenant_ids) && created.body.profile.tenant_ids.includes(tenantId), 'STAGING_MANAGED_USERS_CREATE_TENANT_MISMATCH', created.body)
  assert(created.body?.profile?.module_permissions?.petshop === 'funcionario_pet', 'STAGING_MANAGED_USERS_CREATE_PERMISSION_MISMATCH', created.body)

  const principalRow = d1Rows('DB', `SELECT subject FROM identity_principals WHERE id=${sql(createdPrincipalId)} AND email=${sql(managedEmail)} LIMIT 1;`)[0]
  createdAuthUserId = String(principalRow?.subject || '')
  assert(Boolean(createdAuthUserId), 'STAGING_MANAGED_USERS_AUTH_SUBJECT_MISSING')

  const listed = await api(`/api/admin/users?module_id=petshop&tenant_id=${encodeURIComponent(tenantId)}`, { cookie: adminSignIn.cookie })
  assert(listed.response.status === 200, 'STAGING_MANAGED_USERS_LIST_FAILED', { status: listed.response.status, body: listed.body })
  const listedProfile = (listed.body?.profiles || []).find((profile) => profile?.id === createdPrincipalId)
  assert(Boolean(listedProfile), 'STAGING_MANAGED_USERS_LIST_CREATED_USER_MISSING', listed.body)

  const updated = await api(`/api/admin/users/${encodeURIComponent(createdPrincipalId)}`, {
    method: 'PATCH',
    cookie: adminSignIn.cookie,
    body: {
      full_name: 'E2E Managed User Updated',
      password: updatedPassword,
      role: 'employee',
      staff_type: 'vendedor_caixa',
      permissions: { petshop: 'funcionario_pet' },
      scopeModuleId: 'petshop',
      tenantIds: [tenantId],
      activeTenantId: tenantId,
    },
  })
  assert(updated.response.status === 200, 'STAGING_MANAGED_USERS_UPDATE_FAILED', { status: updated.response.status, body: updated.body })
  assert(updated.body?.profile?.full_name === 'E2E Managed User Updated', 'STAGING_MANAGED_USERS_UPDATE_NAME_MISMATCH', updated.body)
  assert(updated.body?.profile?.staff_type === 'vendedor_caixa', 'STAGING_MANAGED_USERS_UPDATE_STAFF_TYPE_MISMATCH', updated.body)

  const oldPasswordLogin = await signIn(managedEmail, initialPassword)
  assert(oldPasswordLogin.response.status !== 200, 'STAGING_MANAGED_USERS_OLD_PASSWORD_STILL_VALID', { status: oldPasswordLogin.response.status })

  const managedSignIn = await signIn(managedEmail, updatedPassword)
  assert(managedSignIn.response.status === 200 && managedSignIn.cookie.includes('better-auth'), 'STAGING_MANAGED_USERS_UPDATED_PASSWORD_LOGIN_FAILED', { status: managedSignIn.response.status, body: managedSignIn.body })

  const beforeBlock = await api('/api/app/bootstrap', { cookie: managedSignIn.cookie })
  assert(beforeBlock.response.status === 200, 'STAGING_MANAGED_USERS_BOOTSTRAP_BEFORE_BLOCK_FAILED', { status: beforeBlock.response.status, body: beforeBlock.body })

  const blocked = await api(`/api/admin/users/${encodeURIComponent(createdPrincipalId)}/status`, {
    method: 'PATCH',
    cookie: adminSignIn.cookie,
    body: { active: false },
  })
  assert(blocked.response.status === 200 && blocked.body?.profile?.active === false, 'STAGING_MANAGED_USERS_BLOCK_FAILED', { status: blocked.response.status, body: blocked.body })

  const afterBlock = await api('/api/app/bootstrap', { cookie: managedSignIn.cookie })
  assert([401, 403].includes(afterBlock.response.status), 'STAGING_MANAGED_USERS_BLOCK_DID_NOT_REVOKE_ACCESS', { status: afterBlock.response.status, body: afterBlock.body })

  const unblocked = await api(`/api/admin/users/${encodeURIComponent(createdPrincipalId)}/status`, {
    method: 'PATCH',
    cookie: adminSignIn.cookie,
    body: { active: true },
  })
  assert(unblocked.response.status === 200 && unblocked.body?.profile?.active === true, 'STAGING_MANAGED_USERS_UNBLOCK_FAILED', { status: unblocked.response.status, body: unblocked.body })

  const restoredSignIn = await signIn(managedEmail, updatedPassword)
  assert(restoredSignIn.response.status === 200, 'STAGING_MANAGED_USERS_LOGIN_AFTER_UNBLOCK_FAILED', { status: restoredSignIn.response.status, body: restoredSignIn.body })
  const restoredBootstrap = await api('/api/app/bootstrap', { cookie: restoredSignIn.cookie })
  assert(restoredBootstrap.response.status === 200, 'STAGING_MANAGED_USERS_BOOTSTRAP_AFTER_UNBLOCK_FAILED', { status: restoredBootstrap.response.status, body: restoredBootstrap.body })

  const auditRows = d1Rows('DB', `SELECT action FROM admin_audit_events WHERE target_principal_id=${sql(createdPrincipalId)} ORDER BY created_at_ms,id;`)
  const actions = new Set(auditRows.map((row) => String(row?.action || '')))
  for (const required of ['managed_user.created', 'managed_user.updated', 'managed_user.blocked', 'managed_user.unblocked']) {
    assert(actions.has(required), 'STAGING_MANAGED_USERS_AUDIT_EVENT_MISSING', { required, actions: [...actions] })
  }

  console.log(JSON.stringify({
    status: 'passed',
    tenant_id: tenantId,
    principal_id: createdPrincipalId,
    create: true,
    list: true,
    update: true,
    password_rotation: true,
    block_unblock: true,
    audit: true,
  }))
} finally {
  try {
    if (!createdAuthUserId && managedEmail.endsWith('@staging.invalid')) {
      const row = d1Rows('DB', `SELECT subject,id FROM identity_principals WHERE email=${sql(managedEmail)} LIMIT 1;`)[0]
      createdAuthUserId = String(row?.subject || '')
      createdPrincipalId ||= String(row?.id || '')
    }
    if (createdPrincipalId) {
      d1Run('DB', `DELETE FROM tenant_memberships WHERE principal_id=${sql(createdPrincipalId)}; DELETE FROM identity_principals WHERE id=${sql(createdPrincipalId)};`)
    }
    if (createdAuthUserId) {
      d1Run('AUTH_DB', `DELETE FROM session WHERE userId=${sql(createdAuthUserId)}; DELETE FROM account WHERE userId=${sql(createdAuthUserId)}; DELETE FROM user WHERE id=${sql(createdAuthUserId)};`)
    }
  } catch (error) {
    console.error(`Managed user E2E cleanup failed: ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  }
}
