#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import { randomBytes, randomUUID } from 'node:crypto'
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { hash } from 'bcryptjs'

const REPO_ROOT = resolve(new URL('../../', import.meta.url).pathname)
const EDGE_DIR = resolve(REPO_ROOT, 'apps/edge-api')
const ARTIFACT_DIR = resolve(REPO_ROOT, '.artifacts/staging-e2e')
const MANIFEST_PATH = resolve(ARTIFACT_DIR, 'fixture.json')
const E2E_BASE_URL = String(
  process.env.YUISYNC_E2E_BASE_URL ||
  process.env.YUISYNC_PRODUCTION_WORKERS_URL ||
  process.env.YUISYNC_STAGING_URL ||
  'https://yuisync-edge-api-staging.gabrielboalento3004.workers.dev',
).replace(/\/$/, '')
const WRANGLER_ENV = String(process.env.YUISYNC_E2E_WRANGLER_ENV || 'staging').trim()
const WRANGLER_CONFIG = String(
  process.env.YUISYNC_E2E_WRANGLER_CONFIG ||
  process.env.YUISYNC_PRODUCTION_WRANGLER_CONFIG ||
  '',
).trim()
const COMMAND = String(process.argv[2] || '').trim().toLowerCase()
const SAFE_TABLE_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/
const E2E_TENANT_LIKE = 'e2e-%-tenant'
const E2E_EMAIL_LIKE = 'e2e-%@staging.invalid'
const MIGRATION_CONTROL_TABLES = new Set([
  'migration_runs',
  'migration_source_records',
  'migration_source_payload_chunks',
  'migration_secret_vault',
  'migration_table_checkpoints',
  'migration_reconciliation',
])

if (!/^[A-Za-z0-9_-]+$/.test(WRANGLER_ENV)) throw new Error(`INVALID_WRANGLER_ENV:${WRANGLER_ENV}`)

function sql(value) {
  if (value == null) return 'NULL'
  return `'${String(value).replaceAll("'", "''")}'`
}

function identifier(value) {
  const name = String(value || '')
  if (!SAFE_TABLE_NAME.test(name)) throw new Error(`UNSAFE_SQL_IDENTIFIER:${name}`)
  return `"${name}"`
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
  const finalArgs = ['wrangler', ...args]
  if (WRANGLER_CONFIG) finalArgs.push('--config', WRANGLER_CONFIG)
  return run('npx', finalArgs, { cwd: EDGE_DIR })
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

function password() {
  return `${randomBytes(24).toString('base64url')}Aa1!`
}

function mask(value) {
  if (process.env.GITHUB_ACTIONS === 'true' && value) console.log(`::add-mask::${value}`)
}

async function exportEnv(entries) {
  const target = process.env.GITHUB_ENV
  if (!target) return
  await appendFile(target, `${Object.entries(entries).map(([key, value]) => `${key}=${String(value)}`).join('\n')}\n`, 'utf8')
}

function fixture() {
  const runId = `e2e-${Date.now()}-${randomBytes(4).toString('hex')}`
  const tenantId = `${runId}-tenant`
  const users = [
    { key: 'admin', role: 'admin', moduleRole: 'admin_pet', envEmail: 'E2E_EMAIL', envPassword: 'E2E_PASSWORD', name: 'E2E Admin' },
    { key: 'manager', role: 'manager', moduleRole: 'funcionario_pet', envEmail: 'E2E_MANAGER_EMAIL', envPassword: 'E2E_MANAGER_PASSWORD', name: 'E2E Manager' },
    { key: 'member', role: 'member', moduleRole: 'funcionario_pet', envEmail: 'E2E_COMMON_EMAIL', envPassword: 'E2E_COMMON_PASSWORD', name: 'E2E Member' },
  ].map((user) => ({
    ...user,
    userId: randomUUID(),
    principalId: randomUUID(),
    email: `${runId}-${user.key}@staging.invalid`,
    password: password(),
  }))
  return { schema: 'yuisync-staging-e2e-fixture/v3', runId, tenantId, users }
}

function referencedTables(createSql) {
  const references = []
  const pattern = /\bREFERENCES\s+(?:"([^"]+)"|`([^`]+)`|\[([^\]]+)\]|([A-Za-z_][A-Za-z0-9_]*))/gi
  let match
  while ((match = pattern.exec(String(createSql || ''))) !== null) {
    const table = match[1] || match[2] || match[3] || match[4]
    if (table && SAFE_TABLE_NAME.test(table)) references.push(table)
  }
  return [...new Set(references)]
}

function tenantScopedDeleteOrder(schemaRows) {
  const definitions = schemaRows
    .map((row) => ({ name: String(row?.name || ''), sql: String(row?.sql || '') }))
    .filter((row) => SAFE_TABLE_NAME.test(row.name) && row.sql)
    // Migration intake/control state is not application tenant data and must
    // never be swept by ephemeral release fixtures. Excluding the whole
    // control subgraph also prevents its run_id children from being mistaken
    // for unscoped tenant children of migration_runs/source_records.
    .filter((row) => !MIGRATION_CONTROL_TABLES.has(row.name))

  const scoped = definitions
    .filter((row) => row.name !== 'tenants' && row.name !== 'identity_principals' && /\btenant_id\b/i.test(row.sql))
    .map((row) => row.name)
  const scopedSet = new Set(scoped)
  const referencesByTable = new Map(
    definitions.map((row) => [row.name, referencedTables(row.sql)]),
  )

  const unscopedChildren = definitions
    .filter((row) => !scopedSet.has(row.name) && row.name !== 'tenants' && row.name !== 'identity_principals')
    .filter((row) => referencesByTable.get(row.name)?.some((parent) => scopedSet.has(parent)))
    .map((row) => row.name)
  if (unscopedChildren.length) {
    throw new Error(`STAGING_E2E_UNSCOPED_TENANT_CHILD:${unscopedChildren.sort().join(',')}`)
  }

  const incoming = new Map(scoped.map((name) => [name, 0]))
  const parents = new Map(scoped.map((name) => [
    name,
    (referencesByTable.get(name) || []).filter((parent) => scopedSet.has(parent) && parent !== name),
  ]))
  for (const tableParents of parents.values()) {
    for (const parent of tableParents) incoming.set(parent, (incoming.get(parent) || 0) + 1)
  }

  const ready = [...incoming.entries()].filter(([, count]) => count === 0).map(([name]) => name).sort()
  const ordered = []
  while (ready.length) {
    const child = ready.shift()
    ordered.push(child)
    for (const parent of parents.get(child) || []) {
      const next = (incoming.get(parent) || 0) - 1
      incoming.set(parent, next)
      if (next === 0) {
        ready.push(parent)
        ready.sort()
      }
    }
  }

  if (ordered.length !== scoped.length) {
    const unresolved = scoped.filter((name) => !ordered.includes(name)).sort()
    throw new Error(`STAGING_E2E_TENANT_FK_CYCLE:${unresolved.join(',')}`)
  }
  return ordered
}

function mainSchemaRows() {
  return d1Rows(
    'DB',
    "SELECT name, sql FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' AND sql IS NOT NULL ORDER BY name;",
  )
}

function cleanupMainTenant(tenantId, principalIds = []) {
  const id = String(tenantId || '')
  if (!id.startsWith('e2e-') || !id.endsWith('-tenant')) {
    throw new Error(`REFUSING_NON_E2E_TENANT_CLEANUP:${id}`)
  }

  const schemaRows = mainSchemaRows()
  const deleteOrder = tenantScopedDeleteOrder(schemaRows)
  const tenantDeletes = deleteOrder
    .map((table) => `DELETE FROM ${identifier(table)} WHERE tenant_id=${sql(id)};`)
    .join(' ')
  if (tenantDeletes) d1Run('DB', tenantDeletes)

  const principals = [...new Set(principalIds.map(String).filter(Boolean))]
  if (principals.length) {
    d1Run('DB', `DELETE FROM identity_principals WHERE id IN (${principals.map(sql).join(',')});`)
  }
  d1Run('DB', `DELETE FROM tenants WHERE id=${sql(id)};`)
}

function cleanupAuthUsers(userIds = []) {
  const users = [...new Set(userIds.map(String).filter(Boolean))]
  if (!users.length) return
  const values = users.map(sql).join(',')
  d1Run('AUTH_DB', `DELETE FROM session WHERE userId IN (${values}); DELETE FROM account WHERE userId IN (${values}); DELETE FROM user WHERE id IN (${values});`)
}

function sweepStaleFixtures() {
  d1Run('AUTH_DB', `DELETE FROM session WHERE userId IN (SELECT id FROM user WHERE email LIKE ${sql(E2E_EMAIL_LIKE)}); DELETE FROM account WHERE userId IN (SELECT id FROM user WHERE email LIKE ${sql(E2E_EMAIL_LIKE)}); DELETE FROM user WHERE email LIKE ${sql(E2E_EMAIL_LIKE)};`)

  const staleTenants = d1Rows('DB', `SELECT id FROM tenants WHERE id LIKE ${sql(E2E_TENANT_LIKE)} ORDER BY id;`)
  for (const row of staleTenants) {
    const tenantId = String(row?.id || '')
    if (!tenantId) continue
    const principalRows = d1Rows('DB', `SELECT principal_id FROM tenant_memberships WHERE tenant_id=${sql(tenantId)} ORDER BY principal_id;`)
    cleanupMainTenant(tenantId, principalRows.map((principal) => principal?.principal_id).filter(Boolean))
  }
  if (staleTenants.length) console.log(JSON.stringify({ status: 'stale-fixtures-cleaned', tenant_count: staleTenants.length, wrangler_env: WRANGLER_ENV }))
}

async function setup() {
  sweepStaleFixtures()

  const current = fixture()
  const now = Date.now()
  await mkdir(ARTIFACT_DIR, { recursive: true })
  await writeFile(MANIFEST_PATH, JSON.stringify({
    schema: current.schema,
    runId: current.runId,
    tenantId: current.tenantId,
    wranglerEnv: WRANGLER_ENV,
    users: current.users.map(({ key, role, moduleRole, userId, principalId, email }) => ({ key, role, moduleRole, userId, principalId, email })),
  }, null, 2))

  const authStatements = []
  const mainStatements = [
    `INSERT INTO tenants(id,slug,name,status,created_at_ms,updated_at_ms) VALUES(${sql(current.tenantId)},${sql(current.tenantId)},'Release E2E','active',${now},${now});`,
    `INSERT INTO tenant_module_settings(tenant_id,module_id,store_name,created_at_ms,updated_at_ms) VALUES(${sql(current.tenantId)},'petshop','Release E2E',${now},${now});`,
  ]
  const env = { E2E_BASE_URL: E2E_BASE_URL }

  for (const user of current.users) {
    const passwordHash = await hash(user.password, 12)
    const modulePermissions = JSON.stringify({ petshop: { role: user.moduleRole } })
    authStatements.push(
      `INSERT INTO user(id,name,email,emailVerified,image,createdAt,updatedAt) VALUES(${sql(user.userId)},${sql(user.name)},${sql(user.email)},1,NULL,${now},${now});`,
      `INSERT INTO account(id,userId,accountId,providerId,password,createdAt,updatedAt) VALUES(${sql(`credential:${user.userId}`)},${sql(user.userId)},${sql(user.userId)},'credential',${sql(passwordHash)},${now},${now});`,
    )
    mainStatements.push(
      `INSERT INTO identity_principals(id,provider,subject,display_name,email,status,created_at_ms,updated_at_ms) VALUES(${sql(user.principalId)},'better-auth',${sql(user.userId)},${sql(user.name)},${sql(user.email)},'active',${now},${now});`,
      `INSERT INTO tenant_memberships(tenant_id,principal_id,status,created_at_ms,updated_at_ms,role,module_permissions_json) VALUES(${sql(current.tenantId)},${sql(user.principalId)},'active',${now},${now},${sql(user.role)},${sql(modulePermissions)});`,
    )
    mask(user.password)
    env[user.envEmail] = user.email
    env[user.envPassword] = user.password
  }

  try {
    d1Run('AUTH_DB', authStatements.join(' '))
    d1Run('DB', mainStatements.join(' '))
    await exportEnv(env)
    console.log(JSON.stringify({ status: 'ready', run_id: current.runId, tenant_id: current.tenantId, wrangler_env: WRANGLER_ENV, base_url: E2E_BASE_URL, users: current.users.map(({ key, role, moduleRole }) => ({ key, role, module_role: moduleRole })) }))
  } catch (error) {
    console.error(`Failed to prepare E2E fixtures: ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  }
}

async function cleanup() {
  let manifest
  try {
    manifest = JSON.parse(await readFile(MANIFEST_PATH, 'utf8'))
  } catch (error) {
    console.log(`No E2E fixture manifest to clean: ${error instanceof Error ? error.message : String(error)}`)
    return
  }

  const userIds = (manifest.users || []).map((user) => user.userId).filter(Boolean)
  const principalIds = (manifest.users || []).map((user) => user.principalId).filter(Boolean)
  const tenantId = String(manifest.tenantId || '')
  const errors = []

  try {
    cleanupAuthUsers(userIds)
  } catch (error) {
    errors.push(`AUTH_DB:${error instanceof Error ? error.message : String(error)}`)
  }

  if (tenantId) {
    try {
      cleanupMainTenant(tenantId, principalIds)
    } catch (error) {
      errors.push(`DB:${error instanceof Error ? error.message : String(error)}`)
    }
  }

  if (errors.length) {
    throw new Error(`STAGING_E2E_CLEANUP_FAILED:${errors.join('|')}`)
  }
  console.log(JSON.stringify({ status: 'cleaned', run_id: manifest.runId || null, tenant_id: tenantId || null, wrangler_env: WRANGLER_ENV }))
}

if (!['setup', 'cleanup', 'sweep'].includes(COMMAND)) {
  console.error('Usage: node scripts/migration/staging-e2e-fixtures.mjs <setup|cleanup|sweep>')
  process.exit(2)
}

if (COMMAND === 'setup') await setup()
else if (COMMAND === 'cleanup') await cleanup()
else sweepStaleFixtures()
