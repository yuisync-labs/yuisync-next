#!/usr/bin/env node

import { execFileSync, spawnSync } from 'node:child_process'
import { randomBytes, randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { hash } from 'bcryptjs'

import {
  REQUIRED_CERTIFICATION_CHECKS,
  certifyStaging,
} from './fullStagingCertification.mjs'

const REPO_ROOT = resolve(new URL('../../', import.meta.url).pathname)
const EDGE_DIR = resolve(REPO_ROOT, 'apps/edge-api')
const STAGING_URL = String(process.env.YUISYNC_STAGING_URL || 'https://yuisync-edge-api-staging.gabrielboalento3004.workers.dev').replace(/\/$/, '')
const CF_TOKEN = String(process.env.CLOUDFLARE_API_TOKEN || '')
const CF_ACCOUNT = String(process.env.CLOUDFLARE_ACCOUNT_ID || '')
const RUN_ID = `cert-${Date.now()}`
const PROBE_TENANT_A = `${RUN_ID}-a`
const PROBE_TENANT_B = `${RUN_ID}-b`
const PROBE_USER = randomUUID()
const PROBE_PRINCIPAL = randomUUID()
const PROBE_EMAIL = `${RUN_ID}@staging.invalid`
const PROBE_PASSWORD = `${randomBytes(24).toString('base64url')}Aa1!`
const QUEUE_NAME = 'yuisync-events-staging'
const DLQ_NAME = 'yuisync-events-dlq-staging'
const checks = []
let authProbePromise
let queueProbePromise

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

function parseJson(value, label) {
  try { return JSON.parse(value) } catch { throw new Error(`${label}_INVALID_JSON`) }
}

function rowsFromD1(raw) {
  const parsed = parseJson(raw, 'D1')
  const batches = Array.isArray(parsed) ? parsed : [parsed]
  return batches.flatMap((batch) => Array.isArray(batch?.results) ? batch.results : [])
}

function d1Rows(binding, statement) {
  return rowsFromD1(wrangler(['d1', 'execute', binding, '--env', 'staging', '--remote', '--json', '--command', statement]))
}

function d1Run(binding, statement) {
  wrangler(['d1', 'execute', binding, '--env', 'staging', '--remote', '--command', statement])
}

function findBookmark(value) {
  if (!value) return null
  if (typeof value === 'string' && /^[0-9a-f-]{24,}$/i.test(value)) return value
  if (Array.isArray(value)) {
    for (const item of value) { const found = findBookmark(item); if (found) return found }
    return null
  }
  if (typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      if (/bookmark/i.test(key) && typeof item === 'string' && item.trim()) return item.trim()
    }
    for (const item of Object.values(value)) { const found = findBookmark(item); if (found) return found }
  }
  return null
}

function currentBookmark(binding) {
  const parsed = parseJson(wrangler(['d1', 'time-travel', 'info', binding, '--env', 'staging', '--json']), 'BOOKMARK')
  const bookmark = findBookmark(parsed)
  if (!bookmark) throw new Error(`BOOKMARK_MISSING:${binding}`)
  return bookmark
}

function objectNames(database = 'DB') {
  return new Map(d1Rows(database, "SELECT name,type FROM sqlite_schema WHERE type IN ('table','view') ORDER BY name").map((row) => [String(row.name), String(row.type)]))
}

function requireObjects(names, database = 'DB') {
  const available = objectNames(database)
  const missing = names.filter((name) => !available.has(name))
  if (missing.length) throw new Error(`MISSING_OBJECTS:${database}:${missing.join(',')}`)
  return names
}

async function record(name, probe) {
  const started = Date.now()
  try {
    const details = await probe()
    checks.push({ name, status: 'pass', duration_ms: Date.now() - started, details: details ?? null })
  } catch (error) {
    checks.push({ name, status: 'fail', duration_ms: Date.now() - started, error: error instanceof Error ? error.message : String(error) })
  }
}

async function authProbe() {
  if (authProbePromise) return authProbePromise
  authProbePromise = (async () => {
    const now = Date.now()
    const passwordHash = await hash(PROBE_PASSWORD, 12)
    const permissions = '{"petshop":true}'
    const authInsert = [
      `INSERT INTO user(id,name,email,emailVerified,image,createdAt,updatedAt) VALUES(${sql(PROBE_USER)},'Staging Certification',${sql(PROBE_EMAIL)},1,NULL,${now},${now});`,
      `INSERT INTO account(id,userId,accountId,providerId,password,createdAt,updatedAt) VALUES(${sql(`credential:${PROBE_USER}`)},${sql(PROBE_USER)},${sql(PROBE_USER)},'credential',${sql(passwordHash)},${now},${now});`,
    ].join(' ')
    const mainInsert = [
      `INSERT INTO tenants(id,slug,name,status,created_at_ms,updated_at_ms) VALUES(${sql(PROBE_TENANT_A)},${sql(PROBE_TENANT_A)},'Certification A','active',${now},${now});`,
      `INSERT INTO tenants(id,slug,name,status,created_at_ms,updated_at_ms) VALUES(${sql(PROBE_TENANT_B)},${sql(PROBE_TENANT_B)},'Certification B','active',${now},${now});`,
      `INSERT INTO identity_principals(id,provider,subject,display_name,email,status,created_at_ms,updated_at_ms) VALUES(${sql(PROBE_PRINCIPAL)},'better-auth',${sql(PROBE_USER)},'Staging Certification',${sql(PROBE_EMAIL)},'active',${now},${now});`,
      `INSERT INTO tenant_memberships(tenant_id,principal_id,status,created_at_ms,updated_at_ms,role,module_permissions_json) VALUES(${sql(PROBE_TENANT_A)},${sql(PROBE_PRINCIPAL)},'active',${now},${now},'admin',${sql(permissions)});`,
      `INSERT INTO tenant_module_settings(tenant_id,module_id,store_name,created_at_ms,updated_at_ms) VALUES(${sql(PROBE_TENANT_A)},'petshop','Certification A',${now},${now});`,
      `INSERT INTO tenant_module_settings(tenant_id,module_id,store_name,created_at_ms,updated_at_ms) VALUES(${sql(PROBE_TENANT_B)},'petshop','Certification B',${now},${now});`,
    ].join(' ')

    try {
      d1Run('AUTH_DB', authInsert)
      d1Run('DB', mainInsert)

      const signIn = await fetch(`${STAGING_URL}/api/auth/sign-in/email`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: STAGING_URL },
        body: JSON.stringify({ email: PROBE_EMAIL, password: PROBE_PASSWORD, rememberMe: false }),
        redirect: 'manual',
      })
      if (!signIn.ok) throw new Error(`AUTH_SIGNIN_HTTP_${signIn.status}`)
      const setCookies = typeof signIn.headers.getSetCookie === 'function'
        ? signIn.headers.getSetCookie()
        : [signIn.headers.get('set-cookie')].filter(Boolean)
      const cookie = setCookies.map((item) => String(item).split(';', 1)[0]).filter(Boolean).join('; ')
      if (!cookie) throw new Error('AUTH_SESSION_COOKIE_MISSING')

      const session = await fetch(`${STAGING_URL}/api/auth/get-session`, { headers: { cookie, origin: STAGING_URL } })
      if (!session.ok) throw new Error(`AUTH_SESSION_HTTP_${session.status}`)
      const sessionBody = await session.json()
      if (String(sessionBody?.user?.id || '') !== PROBE_USER) throw new Error('AUTH_SESSION_USER_MISMATCH')

      const bootstrap = await fetch(`${STAGING_URL}/api/app/bootstrap`, { headers: { cookie } })
      if (!bootstrap.ok) throw new Error(`BOOTSTRAP_HTTP_${bootstrap.status}`)
      const bootstrapBody = await bootstrap.json()
      const tenantIds = (bootstrapBody?.tenants || []).map((tenant) => String(tenant.id)).sort()
      if (tenantIds.length !== 1 || tenantIds[0] !== PROBE_TENANT_A) throw new Error(`TENANT_ISOLATION_BOOTSTRAP:${tenantIds.join(',')}`)

      const allowed = await fetch(`${STAGING_URL}/api/app/settings?tenant_id=${encodeURIComponent(PROBE_TENANT_A)}&module_id=petshop`, { headers: { cookie } })
      if (!allowed.ok) throw new Error(`TENANT_ALLOWED_HTTP_${allowed.status}`)
      const denied = await fetch(`${STAGING_URL}/api/app/settings?tenant_id=${encodeURIComponent(PROBE_TENANT_B)}&module_id=petshop`, { headers: { cookie } })
      if (denied.status !== 403) throw new Error(`TENANT_DENIED_HTTP_${denied.status}`)

      return { user_id: PROBE_USER, allowed_tenant: PROBE_TENANT_A, denied_tenant: PROBE_TENANT_B }
    } finally {
      try { d1Run('AUTH_DB', `DELETE FROM session WHERE userId=${sql(PROBE_USER)}; DELETE FROM account WHERE userId=${sql(PROBE_USER)}; DELETE FROM user WHERE id=${sql(PROBE_USER)};`) } catch {}
      try { d1Run('DB', `DELETE FROM tenant_module_settings WHERE tenant_id IN (${sql(PROBE_TENANT_A)},${sql(PROBE_TENANT_B)}); DELETE FROM tenant_memberships WHERE principal_id=${sql(PROBE_PRINCIPAL)}; DELETE FROM identity_principals WHERE id=${sql(PROBE_PRINCIPAL)}; DELETE FROM tenants WHERE id IN (${sql(PROBE_TENANT_A)},${sql(PROBE_TENANT_B)});`) } catch {}
    }
  })()
  return authProbePromise
}

function walkObjects(value, output = []) {
  if (Array.isArray(value)) for (const item of value) walkObjects(item, output)
  else if (value && typeof value === 'object') { output.push(value); for (const item of Object.values(value)) walkObjects(item, output) }
  return output
}

async function queueProbe() {
  if (queueProbePromise) return queueProbePromise
  queueProbePromise = (async () => {
    if (!CF_TOKEN || !CF_ACCOUNT) throw new Error('CLOUDFLARE_CREDENTIALS_MISSING')
    const queueJson = parseJson(wrangler(['queues', 'list', '--json']), 'QUEUES')
    const objects = walkObjects(queueJson)
    const findQueue = (name) => objects.find((item) => [item.queue_name, item.name].some((value) => String(value || '') === name))
    const queue = findQueue(QUEUE_NAME)
    const dlq = findQueue(DLQ_NAME)
    if (!queue) throw new Error(`QUEUE_MISSING:${QUEUE_NAME}`)
    if (!dlq) throw new Error(`QUEUE_MISSING:${DLQ_NAME}`)
    const queueId = String(queue.queue_id || queue.id || '')
    if (!queueId) throw new Error('QUEUE_ID_MISSING')

    const eventId = randomUUID()
    const idempotencyKey = `${RUN_ID}-queue`
    const event = {
      type: 'domain_event', version: 1, event_id: eventId,
      event_name: 'system.async_canary.requested.v1', event_version: 1,
      tenant_id: PROBE_TENANT_A,
      aggregate: { type: 'system.async_canary', id: RUN_ID, version: 1 },
      occurred_at: new Date().toISOString(), correlation_id: randomUUID(), causation_id: null,
      idempotency_key: idempotencyKey, payload: { probe_id: RUN_ID }, metadata: { source: 'staging-certification' },
    }
    const endpoint = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(CF_ACCOUNT)}/queues/${encodeURIComponent(queueId)}/messages`
    const publish = async () => {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { authorization: `Bearer ${CF_TOKEN}`, 'content-type': 'application/json' },
        body: JSON.stringify({ body: event }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok || body?.success !== true) throw new Error(`QUEUE_PUBLISH_HTTP_${response.status}`)
    }
    const readState = () => d1Rows('DB', `SELECT status,attempt_count,event_id FROM _yuisync_event_processing WHERE tenant_id=${sql(PROBE_TENANT_A)} AND idempotency_key=${sql(idempotencyKey)} LIMIT 1`)[0]
    const waitSucceeded = async () => {
      for (let attempt = 0; attempt < 30; attempt += 1) {
        const row = readState()
        if (row?.status === 'succeeded') return row
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 1000))
      }
      throw new Error('QUEUE_CANARY_TIMEOUT')
    }

    try {
      await publish()
      const first = await waitSucceeded()
      await publish()
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 2000))
      const second = readState()
      if (String(second?.event_id || '') !== eventId) throw new Error('QUEUE_IDEMPOTENCY_EVENT_CHANGED')
      if (Number(second?.attempt_count) !== Number(first?.attempt_count)) throw new Error('QUEUE_IDEMPOTENCY_RERAN')
      return { queue: QUEUE_NAME, dlq: DLQ_NAME, status: second.status, attempt_count: Number(second.attempt_count) }
    } finally {
      try { d1Run('DB', `DELETE FROM _yuisync_event_processing WHERE tenant_id=${sql(PROBE_TENANT_A)} AND idempotency_key=${sql(idempotencyKey)};`) } catch {}
    }
  })()
  return queueProbePromise
}

async function main() {
  if (new URL(STAGING_URL).hostname !== 'yuisync-edge-api-staging.gabrielboalento3004.workers.dev') throw new Error('STAGING_URL_NOT_ALLOWED')
  if (!CF_TOKEN || !CF_ACCOUNT) throw new Error('CLOUDFLARE_CREDENTIALS_MISSING')

  const requiredTables = {
    clients_pets: ['clients','pets'],
    catalog_services: ['catalog_products','services'],
    inventory: ['inventory_balances','inventory_movements'],
    operational_config: ['module_operational_settings','booking_hours','payment_method_settings'],
    appointments: ['appointments','appointment_services'],
    motodog: ['transport_options','appointment_transport'],
    sales_checkout: ['sales','sale_items'],
    payments_splits: ['payments','payment_splits'],
    chat: ['chat_threads','chat_messages'],
    operation_state: ['operation_checkpoints','operation_effects'],
    fiscal_outbox: ['fiscal_documents','effect_outbox'],
  }
  const operationalTables = [...new Set(Object.values(requiredTables).flat())]
  const aiLabObjects = ['ai_niches','ai_companies','ai_prompt_versions','ai_training_documents','ai_playground_runs','compat_niches','compat_companies','compat_prompt_versions','compat_ai_training_documents','compat_ai_playground_runs']

  await record('schema_v21', async () => {
    const row = d1Rows('DB', "SELECT value FROM _yuisync_system_metadata WHERE key='schema_version' LIMIT 1")[0]
    if (String(row?.value) !== '21') throw new Error(`SCHEMA_VERSION_${row?.value ?? 'MISSING'}`)
    return { version: 21 }
  })
  await record('tenant_isolation', async () => authProbe())
  for (const [name, names] of Object.entries(requiredTables)) await record(name, async () => ({ objects: requireObjects(names) }))
  await record('auth_db', async () => ({ objects: requireObjects(['user','session','account','verification'], 'AUTH_DB') }))
  await record('operational_reconciliation', async () => ({ canonical_objects: requireObjects(operationalTables) }))
  await record('ai_lab_migration', async () => ({ objects: requireObjects(aiLabObjects) }))
  await record('ai_lab_reconciliation', async () => {
    const names = requireObjects(aiLabObjects)
    const tables = d1Rows('DB', "SELECT COUNT(*) AS count FROM sqlite_schema WHERE name LIKE 'ai_%' OR name LIKE 'compat_ai_%'")[0]
    if (Number(tables?.count || 0) < 5) throw new Error('AI_LAB_SCHEMA_INCOMPLETE')
    return { objects: names.length }
  })
  await record('auth_identity_transition', async () => authProbe())
  await record('auth_signin', async () => authProbe())
  await record('frontend_no_supabase', async () => {
    const direct = spawnSync(process.execPath, ['scripts/check-no-runtime-supabase.mjs'], { cwd: REPO_ROOT, encoding: 'utf8', env: process.env })
    if (direct.status !== 0) throw new Error('FRONTEND_SUPABASE_CHECK_FAILED')
    const compat = spawnSync(process.execPath, ['scripts/check-edge-compat-surface.mjs', '--strict'], { cwd: REPO_ROOT, encoding: 'utf8', env: process.env })
    if (compat.status !== 0) throw new Error('FRONTEND_COMPAT_CHECK_FAILED')
    return { direct_supabase: false, compat_deferred: 0 }
  })
  await record('cloudflare_spa', async () => {
    const response = await fetch(`${STAGING_URL}/`, { redirect: 'manual' })
    const body = await response.text()
    if (!response.ok || !/<div\s+id=["']root["']/.test(body)) throw new Error(`SPA_HTTP_${response.status}`)
    return { status: response.status }
  })
  await record('transient_state_drained', async () => {
    const row = d1Rows('DB', `SELECT (SELECT COUNT(*) FROM operation_checkpoints WHERE tenant_id=${sql(PROBE_TENANT_A)}) + (SELECT COUNT(*) FROM operation_effects WHERE tenant_id=${sql(PROBE_TENANT_A)}) + (SELECT COUNT(*) FROM effect_outbox WHERE tenant_id=${sql(PROBE_TENANT_A)}) AS count`)[0]
    if (Number(row?.count || 0) !== 0) throw new Error('TRANSIENT_STATE_NOT_DRAINED')
    return { probe_rows: 0 }
  })
  await record('idempotency_rerun', async () => queueProbe())
  await record('rollback_bookmark', async () => ({ db: currentBookmark('DB'), auth_db: currentBookmark('AUTH_DB') }))
  await record('queue_dlq', async () => queueProbe())
  await record('readiness', async () => {
    const response = await fetch(`${STAGING_URL}/ready`, { headers: { accept: 'application/json' } })
    const body = await response.json().catch(() => ({}))
    if (!response.ok || body?.status !== 'ready') throw new Error(`READINESS_HTTP_${response.status}`)
    if (String(body?.checks?.schema_version) !== '21') throw new Error('READINESS_SCHEMA_MISMATCH')
    if (body?.checks?.better_auth !== 'enabled' || body?.checks?.migration_capabilities !== 'closed') throw new Error('READINESS_GATES_OPEN')
    return body.checks
  })

  const report = {
    schema: 'yuisync-staging-certification-evidence/v1',
    run_id: RUN_ID,
    commit: process.env.GITHUB_SHA || null,
    staging_url: STAGING_URL,
    generated_at: new Date().toISOString(),
    checks,
  }
  const outDir = resolve(REPO_ROOT, '.artifacts/staging-certification')
  await mkdir(outDir, { recursive: true })
  await writeFile(resolve(outDir, `${RUN_ID}.json`), `${JSON.stringify(report, null, 2)}\n`, 'utf8')

  const certification = certifyStaging({ environment: 'staging', checks, runId: RUN_ID, certifiedAt: new Date().toISOString() })
  await writeFile(resolve(outDir, `${RUN_ID}.certified.json`), `${JSON.stringify(certification, null, 2)}\n`, 'utf8')
  process.stdout.write(`${JSON.stringify({ ...certification, passed: checks.filter((item) => item.status === 'pass').length, required: REQUIRED_CERTIFICATION_CHECKS.length })}\n`)
}

main().catch(async (error) => {
  const outDir = resolve(REPO_ROOT, '.artifacts/staging-certification')
  try {
    await mkdir(outDir, { recursive: true })
    await writeFile(resolve(outDir, `${RUN_ID}.failed.json`), `${JSON.stringify({ run_id: RUN_ID, staging_url: STAGING_URL, error: error instanceof Error ? error.message : String(error), checks }, null, 2)}\n`, 'utf8')
  } catch {}
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
