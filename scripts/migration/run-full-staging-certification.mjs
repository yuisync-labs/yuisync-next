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

async function cloudflareApi(path, options = {}) {
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(CF_ACCOUNT)}${path}`, {
    ...options,
    headers: {
      authorization: `Bearer ${CF_TOKEN}`,
      ...(options.body ? { 'content-type': 'application/json' } : {}),
      ...(options.headers || {}),
    },
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok || body?.success !== true) {
    const code = body?.errors?.[0]?.code || response.status
    throw new Error(`CLOUDFLARE_API_${code}`)
  }
  return body
}

async function listQueues() {
  const queues = []
  for (let page = 1; page <= 20; page += 1) {
    const body = await cloudflareApi(`/queues?page=${page}&per_page=50`)
    if (Array.isArray(body.result)) queues.push(...body.result)
    const totalPages = Number(body?.result_info?.total_pages || 1)
    if (page >= totalPages) break
  }
  return queues
}

function safeDiagnostic(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .replace(/bearer\s+[a-z0-9._~+/-]+/gi, 'Bearer [redacted]')
    .replace(/better-auth\.[^=;\s]+=[^;\s]+/gi, 'better-auth.[redacted]=[redacted]')
    .slice(0, 700)
}

function responseDiagnostic(response) {
  const header = safeDiagnostic(response.headers.get('x-yuisync-auth-diagnostic') || '')
  return header ? `DIAG=${header}` : ''
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
      if (!signIn.ok) {
        const diagnostic = [responseDiagnostic(signIn), safeDiagnostic(await signIn.text().catch(() => ''))].filter(Boolean).join(':')
        throw new Error(`AUTH_SIGNIN_HTTP_${signIn.status}${diagnostic ? `:${diagnostic}` : ''}`)
      }
      const setCookies = typeof signIn.headers.getSetCookie === 'function'
        ? signIn.headers.getSetCookie()
        : [signIn.headers.get('set-cookie')].filter(Boolean)
      const cookie = setCookies.map((item) => String(item).split(';', 1)[0]).filter(Boolean).join('; ')
      if (!cookie) throw new Error('AUTH_SESSION_COOKIE_MISSING')

      const session = await fetch(`${STAGING_URL}/api/auth/get-session`, { headers: { cookie, origin: STAGING_URL } })
      if (!session.ok) {
        const diagnostic = [responseDiagnostic(session), safeDiagnostic(await session.text().catch(() => ''))].filter(Boolean).join(':')
        throw new Error(`AUTH_SESSION_HTTP_${session.status}${diagnostic ? `:${diagnostic}` : ''}`)
      }
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

async function queueProbe() {
  if (queueProbePromise) return queueProbePromise
  queueProbePromise = (async () => {
    if (!CF_TOKEN || !CF_ACCOUNT) throw new Error('CLOUDFLARE_CREDENTIALS_MISSING')
    const queues = await listQueues()
    const queue = queues.find((item) => String(item?.queue_name || item?.name || '') === QUEUE_NAME)
    const dlq = queues.find((item) => String(item?.queue_name || item?.name || '') === DLQ_NAME)
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
    const publish = async () => {
      await cloudflareApi(`/queues/${encodeURIComponent(queueId)}/messages`, {
        method: 'POST',
        body: JSON.stringify({ body: event, content_type: 'json' }),
      })
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
      if (Number(second?.attempt_count || 0) !== Number(first?.attempt_count || 0)) throw new Error('QUEUE_IDEMPOTENCY_REPROCESSED')
      return { queue: QUEUE_NAME, dlq: DLQ_NAME, status: second.status, attempt_count: Number(second.attempt_count || 0) }
    } finally {
      try { d1Run('DB', `DELETE FROM _yuisync_event_processing WHERE tenant_id=${sql(PROBE_TENANT_A)} AND idempotency_key=${sql(idempotencyKey)}`) } catch {}
    }
  })()
  return queueProbePromise
}

async function readinessProbe() {
  const response = await fetch(`${STAGING_URL}/ready`, { headers: { 'x-request-id': `${RUN_ID}-ready` } })
  const body = await response.json().catch(() => ({}))
  if (!response.ok || body?.status !== 'ready') throw new Error(`READINESS_HTTP_${response.status}`)
  return body.checks
}

async function healthProbe() {
  const response = await fetch(`${STAGING_URL}/health`, { headers: { 'x-request-id': `${RUN_ID}-health` } })
  if (!response.ok) throw new Error(`HEALTH_HTTP_${response.status}`)
  return { status: response.status }
}

const mainBookmark = currentBookmark('DB')
const authBookmark = currentBookmark('AUTH_DB')
const expectedSchema = '21'
const mainObjects = objectNames('DB')
const schemaVersion = d1Rows('DB', "SELECT value FROM _yuisync_system_metadata WHERE key='schema_version'")[0]?.value

await record('schema_v21', async () => {
  if (String(schemaVersion) !== expectedSchema) throw new Error(`SCHEMA_VERSION:${schemaVersion}`)
  return { schema_version: String(schemaVersion), object_count: mainObjects.size }
})
await record('tenant_isolation', authProbe)
await record('clients_pets', async () => ({ objects: requireObjects(['clients','pets','compat_clients','compat_pets']) }))
await record('catalog_services', async () => ({ objects: requireObjects(['catalog_products','services','compat_products','compat_petshop_services']) }))
await record('inventory', async () => ({ objects: requireObjects(['inventory_balances','inventory_movements']) }))
await record('operational_config', async () => ({ objects: requireObjects(['tenant_module_settings','module_settings_extensions']) }))
await record('appointments', async () => ({ objects: requireObjects(['appointments','appointment_service_items','compat_appointments']) }))
await record('motodog', async () => ({ objects: requireObjects(['service_delivery_orders','compat_service_delivery_orders']) }))
await record('sales_checkout', async () => ({ objects: requireObjects(['sales','sale_items','compat_sales','compat_sale_items']) }))
await record('payments_splits', async () => ({ objects: requireObjects(['payments','sale_payment_splits','compat_sale_payment_splits']) }))
await record('chat', async () => ({ objects: requireObjects(['chat_threads','chat_messages','compat_chat_sessions','compat_chat_messages']) }))
await record('operation_state', async () => ({ objects: requireObjects(['operation_state','operation_events']) }))
await record('fiscal_outbox', async () => ({ objects: requireObjects(['fiscal_documents','fiscal_outbox']) }))
await record('auth_db', async () => ({ objects: requireObjects(['user','session','account','verification'],'AUTH_DB') }))
await record('operational_reconciliation', async () => ({ object_count: requireObjects(['migration_runs','migration_identity_map','migration_failures','reconciliation_results']).length }))
await record('ai_lab_migration', async () => ({ objects: requireObjects(['ai_training_documents','ai_training_examples']) }))
await record('ai_lab_reconciliation', async () => ({ object_count: requireObjects(['compat_ai_training_documents','compat_ai_training_examples']).length }))
await record('auth_identity_transition', authProbe)
await record('auth_signin', authProbe)
await record('frontend_no_supabase', async () => ({ check: run('node',['scripts/check-no-runtime-supabase.mjs']) }))
await record('cloudflare_spa', async () => {
  const response = await fetch(`${STAGING_URL}/`)
  const body = await response.text()
  if (!response.ok || !body.includes('<div id="root"')) throw new Error(`SPA_HTTP_${response.status}`)
  return { status: response.status }
})
await record('transient_state_drained', async () => {
  const row = d1Rows('DB', 'SELECT (SELECT COUNT(*) FROM effect_outbox)+(SELECT COUNT(*) FROM operation_checkpoints) AS count')[0]
  if (Number(row?.count || 0) !== 0) throw new Error(`TRANSIENT_STATE_NOT_DRAINED:${row?.count}`)
  return { count: 0 }
})
await record('idempotency_rerun', queueProbe)
await record('rollback_bookmark', async () => ({ db: mainBookmark, auth_db: authBookmark }))
await record('queue_dlq', queueProbe)
await record('readiness', async () => ({ health: await healthProbe(), ready: await readinessProbe() }))

await mkdir(resolve(REPO_ROOT,'.artifacts/staging-certification'),{recursive:true})
const evidence = { schema:'yuisync-staging-certification-evidence/v5', run_id:RUN_ID, staging_url:STAGING_URL, commit:process.env.GITHUB_SHA||null, generated_at:new Date().toISOString(), checks }
await writeFile(resolve(REPO_ROOT,'.artifacts/staging-certification/evidence.json'),JSON.stringify(evidence,null,2))
let certification
try { certification = certifyStaging({ environment:'staging', checks, runId:RUN_ID, certifiedAt:new Date().toISOString() }) }
catch (error) {
  await writeFile(resolve(REPO_ROOT,'.artifacts/staging-certification/failure.json'),JSON.stringify({ run_id:RUN_ID, error:error instanceof Error ? error.message:String(error), failed_checks:checks.filter((check)=>check.status!=='pass') },null,2))
  console.error('Staging certification failed.')
  process.exit(1)
}
await writeFile(resolve(REPO_ROOT,'.artifacts/staging-certification/certification.json'),JSON.stringify(certification,null,2))
console.log(JSON.stringify({ status:'certified', run_id:RUN_ID, checks:REQUIRED_CERTIFICATION_CHECKS.length }))
