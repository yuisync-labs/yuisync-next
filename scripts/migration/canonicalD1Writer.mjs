import { execFile as execFileCallback } from 'node:child_process'
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

import { auditCanonicalD1Schema } from './canonicalD1SchemaAudit.mjs'

const execFileAsync = promisify(execFileCallback)
const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url))
const ALLOWED_ENVIRONMENTS = new Set(['staging', 'production'])
const MAX_STATEMENT_BYTES = 90_000
const MAX_ROWS_PER_FILE = 250
const MAX_WRITE_ATTEMPTS = 4

export const CANONICAL_WRITE_ORDER = Object.freeze([
  'tenants','tenant_module_settings','clients','pets','catalog_products','services',
  'inventory_balances','inventory_movements','module_operational_settings','module_settings_extensions',
  'booking_hours','payment_method_settings','subscription_plans','client_subscriptions',
  'loyalty_settings','loyalty_points','commission_rules','cash_register',
  'appointments','appointment_services','subscription_benefit_allocations','transport_options','appointment_transport','sales','sale_items',
  'payments','payment_splits','chat_threads','chat_messages','fiscal_documents','billing_settings',
  'accounting_services','invoices','petshop_campaign_logs','petshop_growth_booking_settings',
  'petshop_growth_booking_requests','petshop_growth_leads','petshop_growth_no_show_events',
  'petshop_growth_no_show_policy','petshop_growth_report_cards','support_threads','support_messages',
  'tenant_ai_usage_monthly',
])

export class CanonicalD1WriterError extends Error {
  constructor(code, message = 'Canonical D1 write failed.') {
    super(message)
    this.name = 'CanonicalD1WriterError'
    this.code = code
  }
}

function text(value) { return value == null ? '' : String(value).trim() }
function sql(value) {
  if (value === null) return 'NULL'
  if (typeof value === 'string') return `'${value.replaceAll("'", "''")}'`
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  throw new CanonicalD1WriterError('VALUE_INVALID')
}

function authorize(environment, runId, productionAuthorization) {
  if (!ALLOWED_ENVIRONMENTS.has(environment)) throw new CanonicalD1WriterError('ENVIRONMENT_INVALID')
  if (environment === 'production' && productionAuthorization !== `AUTHORIZE_MIGRATION_RUN:${runId}`) {
    throw new CanonicalD1WriterError('PRODUCTION_NOT_AUTHORIZED')
  }
}

export function buildCanonicalD1Sql({ collections = {}, schemaRows = [], tenantId, moduleId = 'petshop' } = {}) {
  const tenant = text(tenantId)
  const module = text(moduleId).toLowerCase()
  if (!tenant || !/^[a-z0-9][a-z0-9_-]{0,63}$/u.test(module)) throw new CanonicalD1WriterError('SCOPE_INVALID')
  const unknown = Object.keys(collections).filter((table) => !CANONICAL_WRITE_ORDER.includes(table))
  if (unknown.length) throw new CanonicalD1WriterError('TABLE_NOT_ALLOWED')
  const report = auditCanonicalD1Schema({ collections, schemaRows })
  if (!report.compatible) throw new CanonicalD1WriterError('SCHEMA_INCOMPATIBLE')

  const statements = ['PRAGMA foreign_keys=ON;']
  let rowCount = 0
  for (const table of CANONICAL_WRITE_ORDER) {
    const rows = collections[table] || []
    if (!rows.length) continue
    const columns = Object.keys(rows[0]).sort()
    const primaryKey = report.tables[table].primary_key
    if (!primaryKey.length) throw new CanonicalD1WriterError('PRIMARY_KEY_REQUIRED')
    for (const row of rows) {
      if ('tenant_id' in row && row.tenant_id !== tenant) throw new CanonicalD1WriterError('TENANT_SCOPE_MISMATCH')
      if ('module_id' in row && row.module_id !== module) throw new CanonicalD1WriterError('MODULE_SCOPE_MISMATCH')
      const keyPredicate = primaryKey.map((column) => `${column}=${sql(row[column])}`).join(' AND ')
      const statement = `INSERT INTO ${table}(${columns.join(',')}) SELECT ${columns.map((column) => sql(row[column])).join(',')} WHERE NOT EXISTS(SELECT 1 FROM ${table} WHERE ${keyPredicate});`
      if (Buffer.byteLength(statement, 'utf8') > MAX_STATEMENT_BYTES) throw new CanonicalD1WriterError('STATEMENT_TOO_LARGE')
      statements.push(statement)
      rowCount += 1
    }
  }
  return { sql: `${statements.join('\n')}\n`, rowCount, tableCounts: Object.fromEntries(CANONICAL_WRITE_ORDER.filter((table) => collections[table]?.length).map((table) => [table, collections[table].length])) }
}

export function createCanonicalD1Writer({
  execFile = execFileAsync,
  environment = 'staging',
  configPath = 'apps/edge-api/wrangler.jsonc',
  productionAuthorization = null,
} = {}) {
  const config = resolve(REPO_ROOT, configPath)
  const wrangler = resolve(REPO_ROOT, 'node_modules/wrangler/bin/wrangler.js')
  return async function writeCanonical({ runId, collections, schemaRows, tenantId, moduleId = 'petshop' }) {
    const normalizedRun = text(runId)
    if (!normalizedRun) throw new CanonicalD1WriterError('RUN_REQUIRED')
    authorize(environment, normalizedRun, productionAuthorization)
    const built = buildCanonicalD1Sql({ collections, schemaRows, tenantId, moduleId })
    const directory = await mkdtemp(join(tmpdir(), 'yuisync-canonical-migration-'))
    const file = join(directory, 'canonical.sql')
    try {
      for (const table of CANONICAL_WRITE_ORDER) {
        const rows = collections[table] || []
        for (let offset = 0; offset < rows.length; offset += MAX_ROWS_PER_FILE) {
          const chunkSql = buildCanonicalD1Sql({
            collections:{ [table]:rows.slice(offset, offset + MAX_ROWS_PER_FILE) },
            schemaRows, tenantId, moduleId,
          }).sql
          await writeFile(file, chunkSql, { encoding:'utf8', mode:0o600 })
          await chmod(file, 0o600)
          let lastWriteError
          for (let attempt = 1; attempt <= MAX_WRITE_ATTEMPTS; attempt += 1) {
            try {
              await execFile(process.execPath, [wrangler,'d1','execute','DB','--remote','--env',environment,'--config',config,'--file',file], {
                cwd: REPO_ROOT, encoding:'utf8', maxBuffer:16 * 1024 * 1024, windowsHide:true, env:process.env,
              })
              lastWriteError = null
              break
            } catch (error) {
              lastWriteError = error
              if (attempt < MAX_WRITE_ATTEMPTS) {
                await new Promise((resolveDelay) => setTimeout(resolveDelay, attempt * 750))
              }
            }
          }
          if (lastWriteError) {
            const error = new CanonicalD1WriterError('D1_WRITE_FAILED')
            error.table = table
            error.offset = offset
            error.attempts = MAX_WRITE_ATTEMPTS
            error.cause = lastWriteError
            throw error
          }
        }
      }
      return { status:'applied_or_already_present', ...built }
    } finally {
      await rm(directory, { recursive:true, force:true })
    }
  }
}
