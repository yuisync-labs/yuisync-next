#!/usr/bin/env node

import { mkdir, readFile, writeFile, appendFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url))
const SOURCE_CONFIG = resolve(REPO_ROOT, 'apps/edge-api/wrangler.jsonc')
const GENERATED_CONFIG = resolve(REPO_ROOT, 'apps/edge-api/.wrangler-production.jsonc')
const ARTIFACT = resolve(REPO_ROOT, '.artifacts/production/cloudflare-resources.json')
const COMMAND = String(process.argv[2] || '').trim().toLowerCase()

export const PRODUCTION = Object.freeze({
  worker: 'yuisync-edge-api-production',
  database: 'yuisync-next-production',
  authDatabase: 'yuisync-auth-production',
  queue: 'yuisync-events-production',
  dlq: 'yuisync-events-dlq-production',
  domain: 'yuisync.app',
})

const STAGING_IDS = new Set([
  '4abe6b77-3042-4960-88ef-1fdb43d488d1',
  '9157ec55-a04d-449e-a92c-710f8e39cd51',
])

function requiredEnv(name) {
  const value = String(process.env[name] || '').trim()
  if (!value) throw new Error(`${name}_REQUIRED`)
  return value
}

function assertUuid(value, label) {
  const id = String(value || '').trim()
  if (!/^[a-f0-9-]{36}$/i.test(id)) throw new Error(`${label}_INVALID`)
  if (STAGING_IDS.has(id)) throw new Error(`${label}_REUSES_STAGING_RESOURCE`)
  return id
}

async function cloudflare(path, options = {}) {
  const accountId = requiredEnv('CLOUDFLARE_ACCOUNT_ID')
  const token = requiredEnv('CLOUDFLARE_API_TOKEN')
  const url = path.startsWith('/zones')
    ? `https://api.cloudflare.com/client/v4${path}`
    : `https://api.cloudflare.com/client/v4/accounts/${accountId}${path}`
  const response = await fetch(url, {
    ...options,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      ...(options.headers || {}),
    },
  })
  const payload = await response.json().catch(() => null)
  if (!response.ok || payload?.success !== true) {
    const detail = Array.isArray(payload?.errors)
      ? payload.errors.map((entry) => entry?.message || entry?.code).filter(Boolean).join(';')
      : `HTTP_${response.status}`
    throw new Error(`CLOUDFLARE_API_FAILED:${path}:${detail || response.status}`)
  }
  return payload
}

async function findD1(name) {
  const listed = await cloudflare(`/d1/database?name=${encodeURIComponent(name)}&per_page=100`)
  const matches = (listed.result || []).filter((row) => row?.name === name)
  if (matches.length > 1) throw new Error(`DUPLICATE_D1_NAME:${name}`)
  if (!matches[0]) return null
  return { name, id: assertUuid(matches[0]?.uuid || matches[0]?.id, `D1_${name}`), created: false }
}

async function ensureD1(name) {
  const existing = await findD1(name)
  if (existing) return existing
  const response = await cloudflare('/d1/database', {
    method: 'POST',
    body: JSON.stringify({ name }),
  })
  const id = assertUuid(response.result?.uuid || response.result?.id, `D1_${name}`)
  return { name, id, created: true }
}

async function listQueues() {
  const rows = []
  for (let page = 1; page <= 20; page += 1) {
    const listed = await cloudflare(`/queues?page=${page}&per_page=100`)
    if (Array.isArray(listed.result)) rows.push(...listed.result)
    const totalPages = Number(listed?.result_info?.total_pages || 1)
    if (page >= totalPages) break
  }
  return rows
}

async function findQueue(name, rows = null) {
  const all = rows || await listQueues()
  const matches = all.filter((row) => row?.queue_name === name)
  if (matches.length > 1) throw new Error(`DUPLICATE_QUEUE_NAME:${name}`)
  if (!matches[0]) return null
  if (!matches[0]?.queue_id) throw new Error(`QUEUE_ID_MISSING:${name}`)
  return { name, id: String(matches[0].queue_id), created: false }
}

async function ensureQueue(name) {
  const existing = await findQueue(name)
  if (existing) return existing
  const response = await cloudflare('/queues', {
    method: 'POST',
    body: JSON.stringify({ queue_name: name }),
  })
  if (!response.result?.queue_id) throw new Error(`QUEUE_ID_MISSING:${name}`)
  return { name, id: String(response.result.queue_id), created: true }
}

export function buildProductionWranglerConfig(baseConfig, resources, { attachDomain = false } = {}) {
  if (!baseConfig?.env?.staging) throw new Error('STAGING_WRANGLER_ENV_REQUIRED')
  const config = structuredClone(baseConfig)
  const staging = config.env.staging
  const production = {
    name: PRODUCTION.worker,
    // Make the isolated canary endpoint explicit. Once the Custom Domain is
    // attached, disable workers.dev so business traffic only uses yuisync.app.
    workers_dev: !attachDomain,
    preview_urls: false,
    vars: {
      APP_ENV: 'production',
      SERVICE_NAME: 'yuisync-edge-api',
      RELEASE_CHANNEL: 'production',
      EDGE_DATABASE_ENABLED: 'true',
      EDGE_ASYNC_ENABLED: 'true',
      EDGE_COORDINATION_ENABLED: 'true',
      EDGE_BETTER_AUTH_ENABLED: 'true',
      EDGE_OPERATIONAL_MIGRATION_ENABLED: 'false',
      EDGE_AUTH_MIGRATION_ENABLED: 'false',
      EDGE_AUTH_TRUSTED_ORIGINS: `https://${PRODUCTION.domain}`,
    },
    d1_databases: [
      {
        binding: 'DB',
        database_name: PRODUCTION.database,
        database_id: assertUuid(resources.database.id, 'PRODUCTION_DB'),
        migrations_dir: 'migrations',
        migrations_table: 'd1_migrations',
      },
      {
        binding: 'AUTH_DB',
        database_name: PRODUCTION.authDatabase,
        database_id: assertUuid(resources.authDatabase.id, 'PRODUCTION_AUTH_DB'),
        migrations_dir: 'auth-migrations',
        migrations_table: 'auth_d1_migrations',
      },
    ],
    queues: {
      producers: [{ binding: 'EVENTS_QUEUE', queue: PRODUCTION.queue }],
      consumers: [{
        queue: PRODUCTION.queue,
        dead_letter_queue: PRODUCTION.dlq,
        max_batch_size: 5,
        max_batch_timeout: 5,
        max_retries: 3,
        retry_delay: 15,
        max_concurrency: 2,
      }],
    },
    durable_objects: structuredClone(staging.durable_objects || { bindings: [] }),
    exports: structuredClone(staging.exports || {}),
  }
  if (attachDomain) production.routes = [{ pattern: PRODUCTION.domain, custom_domain: true }]
  config.env.production = production
  return config
}

async function writeGithubEnv(entries) {
  if (!process.env.GITHUB_ENV) return
  await appendFile(
    process.env.GITHUB_ENV,
    `${Object.entries(entries).map(([key, value]) => `${key}=${String(value)}`).join('\n')}\n`,
    'utf8',
  )
}

async function materialize(resources, { mode }) {
  if (!resources.database || !resources.authDatabase || !resources.queue || !resources.dlq) {
    throw new Error('PRODUCTION_RESOURCE_SET_INCOMPLETE')
  }
  if (resources.database.id === resources.authDatabase.id) throw new Error('PRODUCTION_D1_COLLISION')
  if (resources.queue.id === resources.dlq.id) throw new Error('PRODUCTION_QUEUE_DLQ_COLLISION')

  const attachDomain = String(process.env.YUISYNC_PRODUCTION_ATTACH_DOMAIN || '').toLowerCase() === 'true'
  const base = JSON.parse(await readFile(SOURCE_CONFIG, 'utf8'))
  const config = buildProductionWranglerConfig(base, resources, { attachDomain })
  await writeFile(GENERATED_CONFIG, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 })
  await mkdir(dirname(ARTIFACT), { recursive: true })
  await writeFile(ARTIFACT, `${JSON.stringify({
    schema: 'yuisync-production-cloudflare/v1',
    mode,
    worker: PRODUCTION.worker,
    domain: PRODUCTION.domain,
    attach_domain: attachDomain,
    resources,
  }, null, 2)}\n`, { mode: 0o600 })

  await writeGithubEnv({
    YUISYNC_PRODUCTION_WRANGLER_CONFIG: GENERATED_CONFIG,
    YUISYNC_PRODUCTION_DB_ID: resources.database.id,
    YUISYNC_PRODUCTION_AUTH_DB_ID: resources.authDatabase.id,
    YUISYNC_PRODUCTION_WORKER: PRODUCTION.worker,
    YUISYNC_PRODUCTION_DOMAIN: PRODUCTION.domain,
  })
  console.log(JSON.stringify({ status: mode, worker: PRODUCTION.worker, domain: PRODUCTION.domain, attach_domain: attachDomain, resources }))
}

async function prepare() {
  return materialize({
    database: await ensureD1(PRODUCTION.database),
    authDatabase: await ensureD1(PRODUCTION.authDatabase),
    queue: await ensureQueue(PRODUCTION.queue),
    dlq: await ensureQueue(PRODUCTION.dlq),
  }, { mode: 'prepared' })
}

async function resolveExisting() {
  const queues = await listQueues()
  const resources = {
    database: await findD1(PRODUCTION.database),
    authDatabase: await findD1(PRODUCTION.authDatabase),
    queue: await findQueue(PRODUCTION.queue, queues),
    dlq: await findQueue(PRODUCTION.dlq, queues),
  }
  const missing = Object.entries(resources).filter(([, value]) => !value).map(([key]) => key)
  if (missing.length) throw new Error(`PRODUCTION_RESOURCES_MISSING:${missing.join(',')}`)
  return materialize(resources, { mode: 'resolved' })
}

async function getZone() {
  const response = await cloudflare(`/zones?name=${encodeURIComponent(PRODUCTION.domain)}&status=active&per_page=50`)
  const zones = (response.result || []).filter((zone) => zone?.name === PRODUCTION.domain && zone?.status === 'active')
  if (zones.length !== 1) throw new Error(`PRODUCTION_ZONE_NOT_UNIQUE:${zones.length}`)
  return zones[0]
}

async function inspectDomain() {
  const zone = await getZone()
  const token = requiredEnv('CLOUDFLARE_API_TOKEN')
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/zones/${zone.id}/dns_records?name=${encodeURIComponent(PRODUCTION.domain)}&per_page=100`,
    { headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' } },
  )
  const payload = await response.json().catch(() => null)
  if (!response.ok || payload?.success !== true) throw new Error(`PRODUCTION_DNS_READ_FAILED:${response.status}`)
  const records = (payload.result || []).map((record) => ({
    id: record.id,
    type: record.type,
    name: record.name,
    content: record.content,
    proxied: record.proxied,
  }))
  console.log(JSON.stringify({ status: 'domain-inspected', zone_id: zone.id, records }))
  return { zone, records }
}

async function clearConflictingCname() {
  const { zone, records } = await inspectDomain()
  const conflicts = records.filter((record) => record.name === PRODUCTION.domain && record.type === 'CNAME')
  if (!conflicts.length) {
    console.log(JSON.stringify({ status: 'no-conflicting-cname' }))
    return
  }

  const token = requiredEnv('CLOUDFLARE_API_TOKEN')
  for (const record of conflicts) {
    const response = await fetch(`https://api.cloudflare.com/client/v4/zones/${zone.id}/dns_records/${record.id}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    })
    const payload = await response.json().catch(() => null)
    if (!response.ok || payload?.success !== true) throw new Error(`PRODUCTION_CNAME_DELETE_FAILED:${response.status}`)
  }
  console.log(JSON.stringify({ status: 'conflicting-cname-removed', count: conflicts.length }))
}

async function main() {
  if (COMMAND === 'prepare') return prepare()
  if (COMMAND === 'resolve') return resolveExisting()
  if (COMMAND === 'inspect-domain') return inspectDomain()
  if (COMMAND === 'clear-conflicting-cname') return clearConflictingCname()
  throw new Error('Usage: node scripts/migration/production-cloudflare.mjs <prepare|resolve|inspect-domain|clear-conflicting-cname>')
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
