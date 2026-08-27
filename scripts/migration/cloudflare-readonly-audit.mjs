#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url))
const EDGE_DIR = resolve(REPO_ROOT, 'apps/edge-api')
const WRANGLER = process.platform === 'win32' ? 'npx.cmd' : 'npx'

export const REQUIRED_MAIN_TABLES = Object.freeze([
  '_yuisync_system_metadata',
  'tenants',
  'identity_principals',
  'tenant_memberships',
  'clients',
  'pets',
  'services',
  'appointments',
  'appointment_services',
  'sales',
  'sale_items',
  'payments',
  'cash_register',
  'client_subscriptions',
  'subscription_benefit_allocations',
])

export const REQUIRED_AUTH_TABLES = Object.freeze(['account', 'session', 'user', 'verification'])

export const MAIN_INVARIANT_QUERIES = Object.freeze({
  foreign_keys: 'PRAGMA foreign_key_check;',
  orphan_pets: `SELECT COUNT(*) AS count FROM pets child LEFT JOIN clients parent ON parent.tenant_id=child.tenant_id AND parent.module_id=child.module_id AND parent.id=child.client_id WHERE parent.id IS NULL;`,
  orphan_appointments_clients: `SELECT COUNT(*) AS count FROM appointments child LEFT JOIN clients parent ON parent.tenant_id=child.tenant_id AND parent.module_id=child.module_id AND parent.id=child.client_id WHERE parent.id IS NULL;`,
  orphan_appointments_pets: `SELECT COUNT(*) AS count FROM appointments child LEFT JOIN pets parent ON parent.tenant_id=child.tenant_id AND parent.module_id=child.module_id AND parent.id=child.pet_id WHERE parent.id IS NULL;`,
  orphan_appointment_services: `SELECT COUNT(*) AS count FROM appointment_services child LEFT JOIN appointments parent ON parent.tenant_id=child.tenant_id AND parent.module_id=child.module_id AND parent.id=child.appointment_id WHERE parent.id IS NULL;`,
  orphan_sale_items: `SELECT COUNT(*) AS count FROM sale_items child LEFT JOIN sales parent ON parent.tenant_id=child.tenant_id AND parent.module_id=child.module_id AND parent.id=child.sale_id WHERE parent.id IS NULL;`,
  orphan_payments: `SELECT COUNT(*) AS count FROM payments child LEFT JOIN sales parent ON parent.tenant_id=child.tenant_id AND parent.module_id=child.module_id AND parent.id=child.sale_id WHERE parent.id IS NULL;`,
  orphan_memberships_tenant: `SELECT COUNT(*) AS count FROM tenant_memberships child LEFT JOIN tenants parent ON parent.id=child.tenant_id WHERE parent.id IS NULL;`,
  orphan_memberships_principal: `SELECT COUNT(*) AS count FROM tenant_memberships child LEFT JOIN identity_principals parent ON parent.id=child.principal_id WHERE parent.id IS NULL;`,
  stale_e2e_tenants: `SELECT COUNT(*) AS count FROM tenants WHERE id LIKE 'e2e-%-tenant';`,
})

export const AUTH_INVARIANT_QUERIES = Object.freeze({
  orphan_sessions: 'SELECT COUNT(*) AS count FROM session child LEFT JOIN user parent ON parent.id=child.userId WHERE parent.id IS NULL;',
  orphan_accounts: 'SELECT COUNT(*) AS count FROM account child LEFT JOIN user parent ON parent.id=child.userId WHERE parent.id IS NULL;',
  stale_e2e_users: `SELECT COUNT(*) AS count FROM user WHERE email LIKE 'e2e-%@staging.invalid';`,
})

export function assertReadOnlySql(statement) {
  const normalized = String(statement || '')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\r\n]*/g, ' ')
    .trim()
  if (!/^(SELECT|WITH|PRAGMA)\b/i.test(normalized)) throw new Error('AUDIT_SQL_MUST_BE_READ_ONLY')
  if (/\b(INSERT|UPDATE|DELETE|REPLACE|CREATE|ALTER|DROP|ATTACH|DETACH|VACUUM|REINDEX)\b/i.test(normalized)) {
    throw new Error('AUDIT_SQL_MUTATION_FORBIDDEN')
  }
  return normalized
}

export function rowsFromWrangler(raw) {
  const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
  return (Array.isArray(parsed) ? parsed : [parsed])
    .flatMap((entry) => Array.isArray(entry?.results) ? entry.results : [])
}

export function evaluateAudit({ ready, mainTables, authTables, schemaVersion, quickCheckRows, mainInvariantRows, authInvariantRows }) {
  const missingMainTables = REQUIRED_MAIN_TABLES.filter((name) => !mainTables.includes(name))
  const missingAuthTables = REQUIRED_AUTH_TABLES.filter((name) => !authTables.includes(name))
  const failures = []

  if (ready?.status !== 'ready') failures.push(`ready:${ready?.status || 'unavailable'}`)
  if (String(schemaVersion || '') !== '30') failures.push(`schema_version:${schemaVersion || 'missing'}`)
  if (missingMainTables.length) failures.push(`missing_main_tables:${missingMainTables.join(',')}`)
  if (missingAuthTables.length) failures.push(`missing_auth_tables:${missingAuthTables.join(',')}`)
  if (quickCheckRows.length !== 1 || String(quickCheckRows[0]?.quick_check || '').toLowerCase() !== 'ok') {
    failures.push('quick_check')
  }

  for (const [name, rows] of Object.entries(mainInvariantRows)) {
    const count = name === 'foreign_keys' ? rows.length : Number(rows[0]?.count || 0)
    if (count !== 0) failures.push(`${name}:${count}`)
  }
  for (const [name, rows] of Object.entries(authInvariantRows)) {
    const count = Number(rows[0]?.count || 0)
    if (count !== 0) failures.push(`${name}:${count}`)
  }

  return {
    status: failures.length ? 'failed' : 'passed',
    schema_version: String(schemaVersion || ''),
    readiness: ready?.status || 'unavailable',
    main_table_count: mainTables.length,
    auth_table_count: authTables.length,
    invariant_count: Object.keys(mainInvariantRows).length + Object.keys(authInvariantRows).length,
    failures,
  }
}

function parseArgs(argv) {
  const options = { env: '', config: '', baseUrl: '' }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--env') options.env = String(argv[++index] || '')
    else if (arg === '--config') options.config = String(argv[++index] || '')
    else if (arg === '--base-url') options.baseUrl = String(argv[++index] || '').replace(/\/$/, '')
    else throw new Error(`UNKNOWN_ARGUMENT:${arg}`)
  }
  if (!['staging', 'production'].includes(options.env)) throw new Error('AUDIT_ENV_MUST_BE_STAGING_OR_PRODUCTION')
  if (!options.baseUrl.startsWith('https://')) throw new Error('AUDIT_BASE_URL_MUST_BE_HTTPS')
  return options
}

function wrangler(args, config) {
  const finalArgs = ['wrangler', ...args]
  if (config) finalArgs.push('--config', config)
  return execFileSync(WRANGLER, finalArgs, {
    cwd: EDGE_DIR,
    encoding: 'utf8',
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 16 * 1024 * 1024,
  }).trim()
}

function d1Rows(binding, statement, options) {
  const sql = assertReadOnlySql(statement)
  return rowsFromWrangler(wrangler([
    'd1', 'execute', binding,
    '--env', options.env,
    '--remote',
    '--json',
    '--command', sql,
  ], options.config))
}

async function fetchJson(url) {
  const response = await fetch(url, { headers: { accept: 'application/json', 'cache-control': 'no-cache' } })
  const body = await response.json().catch(() => null)
  if (!response.ok) throw new Error(`AUDIT_HTTP_FAILED:${response.status}:${url}`)
  return body
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const [health, ready] = await Promise.all([
    fetchJson(`${options.baseUrl}/health`),
    fetchJson(`${options.baseUrl}/ready`),
  ])
  if (health?.status !== 'ok') throw new Error(`AUDIT_HEALTH_NOT_OK:${health?.status || 'unavailable'}`)

  const mainTables = d1Rows('DB', "SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name;", options).map((row) => String(row.name))
  const authTables = d1Rows('AUTH_DB', "SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name;", options).map((row) => String(row.name))
  const schemaVersion = d1Rows('DB', "SELECT value FROM _yuisync_system_metadata WHERE key='schema_version' LIMIT 1;", options)[0]?.value
  const quickCheckRows = d1Rows('DB', 'PRAGMA quick_check;', options)
  const mainInvariantRows = Object.fromEntries(
    Object.entries(MAIN_INVARIANT_QUERIES).map(([name, sql]) => [name, d1Rows('DB', sql, options)]),
  )
  const authInvariantRows = Object.fromEntries(
    Object.entries(AUTH_INVARIANT_QUERIES).map(([name, sql]) => [name, d1Rows('AUTH_DB', sql, options)]),
  )
  const result = evaluateAudit({ ready, mainTables, authTables, schemaVersion, quickCheckRows, mainInvariantRows, authInvariantRows })
  console.log(JSON.stringify({
    schema: 'yuisync-cloudflare-readonly-audit/v1',
    environment: options.env,
    base_url: options.baseUrl,
    ...result,
  }))
  if (result.status !== 'passed') process.exitCode = 1
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
