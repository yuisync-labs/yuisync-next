import { execFile as execFileCallback } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

import { auditCanonicalD1Schema, buildD1SchemaAuditQuery } from '../canonicalD1SchemaAudit.mjs'
import { CANONICAL_WRITE_ORDER } from '../canonicalD1Writer.mjs'
import { parseWranglerD1Json } from '../foundationExtractors.mjs'
import { projectLegacyCanonicalSnapshot } from '../legacyCanonicalProjection.mjs'
import { attachNormalizedAppointmentClients, projectNormalizedSupabaseClientsPets } from '../normalizedClientsPetsIntake.mjs'
import { extractSupabaseOperationalTables } from '../operationalExtractors.mjs'
import {
  buildInsertStatement,
  buildUpdateStatement,
  planCanonicalRows,
  primaryKeySignature,
  selectChangedRows,
  snapshotHash,
  sqlLiteral,
} from './finalSyncCore.mjs'

const execFile = promisify(execFileCallback)
const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url))
const WRANGLER = resolve(REPO_ROOT, 'node_modules/wrangler/bin/wrangler.js')
const CONFIG = resolve(REPO_ROOT, 'apps/edge-api/.wrangler-production.jsonc')
const RECONCILIATIONS_PATH = resolve(dirname(fileURLToPath(import.meta.url)), 'quatro-patas-reconciliations.json')
const TENANT_ID = '29d6a509-8b35-47d0-ad19-7cee6f17328c'
const MODULE_ID = 'petshop'
const DEFAULT_START = '2026-09-02T03:00:00.000Z'
const AUTHORIZATION = 'quatro-patas-final-sync'
const FROZEN_SNAPSHOT_PATH = resolve(REPO_ROOT, '.migration/quatro-patas-final-source.json')
const PAGE_SIZE = 500
const MAX_PAGES = 100
const D1_KEY_CHUNK = 35
const SQL_ROW_CHUNK = 100

function argument(name, fallback = '') {
  const prefix = `--${name}=`
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) || fallback
}

function mode() {
  const explicit = argument('mode')
  const positional = process.argv.slice(2).find((value) => !value.startsWith('--'))
  const value = explicit || positional || 'audit'
  if (!['audit', 'plan', 'apply', 'verify'].includes(value)) throw new Error(`INVALID_MODE:${value}`)
  return value
}

function required(name) {
  const value = String(process.env[name] || '').trim()
  if (!value) throw new Error(`MISSING_${name}`)
  return value
}

function epoch(value, label) {
  const parsed = Date.parse(String(value || ''))
  if (!Number.isFinite(parsed)) throw new Error(`INVALID_${label}`)
  return parsed
}

function sourceHeaders(key, range) {
  return {
    accept: 'application/json',
    apikey: key,
    range,
    ...(key.startsWith('sb_secret_') ? {} : { authorization:`Bearer ${key}` }),
  }
}

async function readRawSourceTable(table, { module = true } = {}) {
  const baseUrl = required('SUPABASE_URL')
  const key = required('SUPABASE_SECRET_KEY')
  const rows = []
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const url = new URL(`/rest/v1/${table}`, baseUrl)
    url.searchParams.set('select', '*')
    url.searchParams.set('tenant_id', `eq.${TENANT_ID}`)
    if (module) url.searchParams.set('module_id', `eq.${MODULE_ID}`)
    url.searchParams.set('order', 'id.asc')
    const response = await fetch(url, {
      method:'GET',
      headers:sourceHeaders(key, `${page * PAGE_SIZE}-${page * PAGE_SIZE + PAGE_SIZE - 1}`),
      redirect:'error',
    })
    if (!response.ok) throw new Error(`SOURCE_${table.toUpperCase()}_HTTP_${response.status}`)
    const batch = await response.json()
    if (!Array.isArray(batch)) throw new Error(`SOURCE_${table.toUpperCase()}_INVALID`)
    rows.push(...batch)
    if (batch.length < PAGE_SIZE) return rows
  }
  throw new Error(`SOURCE_${table.toUpperCase()}_PAGINATION_LIMIT`)
}

async function readReconciliations() {
  const manifest = JSON.parse(await readFile(RECONCILIATIONS_PATH, 'utf8'))
  if (manifest.tenant_id !== TENANT_ID || manifest.module_id !== MODULE_ID || !Array.isArray(manifest.overrides)) {
    throw new Error('RECONCILIATION_SCOPE_INVALID')
  }
  return manifest
}

async function sourceSnapshot(cutoffMs, reconciliations) {
  const [operational, clients, pets, appointments] = await Promise.all([
    extractSupabaseOperationalTables({
      supabaseUrl:required('SUPABASE_URL'),
      adminApiKey:required('SUPABASE_SECRET_KEY'),
      scope:{ tenant_id:TENANT_ID, module_id:MODULE_ID },
    }),
    readRawSourceTable('clients'),
    readRawSourceTable('pets'),
    readRawSourceTable('appointments'),
  ])
  const projected = projectLegacyCanonicalSnapshot({ tables:operational.tables }, {
    tenantId:TENANT_ID,
    moduleId:MODULE_ID,
    reconciliationOverrides:reconciliations.overrides,
  })
  const normalized = projectNormalizedSupabaseClientsPets({
    clients,
    pets,
    appointments,
    scope:{ tenant_id:TENANT_ID, module_id:MODULE_ID },
    now:cutoffMs,
  })
  const aligned = attachNormalizedAppointmentClients({ appointments:projected.collections.appointments, pets:normalized.pets })
  return {
    projection:projected.projection,
    collections:{ clients:normalized.clients, pets:normalized.pets, ...projected.collections, appointments:aligned.appointments },
  }
}

async function stableSourceSnapshot(startMs, cutoffMs, reconciliations) {
  const first = await sourceSnapshot(cutoffMs, reconciliations)
  const second = await sourceSnapshot(cutoffMs, reconciliations)
  const firstDelta = selectChangedRows(first.collections, { startMs, cutoffMs })
  const secondDelta = selectChangedRows(second.collections, { startMs, cutoffMs })
  const firstHash = snapshotHash(firstDelta)
  const secondHash = snapshotHash(secondDelta)
  if (firstHash === secondHash) return { snapshot:second, delta:secondDelta, hash:secondHash, reads:2 }
  const third = await sourceSnapshot(cutoffMs, reconciliations)
  const thirdDelta = selectChangedRows(third.collections, { startMs, cutoffMs })
  const thirdHash = snapshotHash(thirdDelta)
  if (secondHash !== thirdHash) throw new Error('SOURCE_SNAPSHOT_UNSTABLE')
  return { snapshot:third, delta:thirdDelta, hash:thirdHash, reads:3 }
}

async function writeFrozenSnapshot({ startMs, cutoffMs, stable }) {
  await mkdir(dirname(FROZEN_SNAPSHOT_PATH), { recursive:true })
  await writeFile(FROZEN_SNAPSHOT_PATH, `${JSON.stringify({
    version:1,
    tenant_id:TENANT_ID,
    module_id:MODULE_ID,
    source_start:new Date(startMs).toISOString(),
    source_cutoff:new Date(cutoffMs).toISOString(),
    source_snapshot_hash:stable.hash,
    projection:stable.snapshot.projection,
    collections:stable.delta,
  })}\n`, { encoding:'utf8', mode:0o600 })
}

async function readFrozenSnapshot(startMs, cutoffMs) {
  const frozen = JSON.parse(await readFile(FROZEN_SNAPSHOT_PATH, 'utf8'))
  if (frozen.tenant_id !== TENANT_ID || frozen.module_id !== MODULE_ID
    || frozen.source_start !== new Date(startMs).toISOString()
    || frozen.source_cutoff !== new Date(cutoffMs).toISOString()
    || snapshotHash(frozen.collections) !== frozen.source_snapshot_hash) {
    throw new Error('FROZEN_SOURCE_SNAPSHOT_INVALID')
  }
  return frozen
}

async function wrangler(args, { maxBuffer = 20 * 1024 * 1024 } = {}) {
  return execFile(process.execPath, [WRANGLER, ...args], {
    cwd:REPO_ROOT,
    encoding:'utf8',
    maxBuffer,
    windowsHide:true,
    env:process.env,
  })
}

async function d1Select(statement) {
  const windowsSafeStatement = String(statement).replaceAll('p."notnull"', 'p.[notnull]')
  const result = await wrangler([
    'd1','execute','yuisync-next-production','--remote','--env','production','--config',CONFIG,
    '--command',windowsSafeStatement,'--json',
  ])
  return parseWranglerD1Json(result.stdout)
}

function predicates(rows, primaryKey) {
  return rows.map((row) => `(${primaryKey.map((column) => `${column}=${sqlLiteral(row[column])}`).join(' AND ')})`).join(' OR ')
}

async function destinationRows(table, rows, primaryKey) {
  const found = []
  for (let offset = 0; offset < rows.length; offset += D1_KEY_CHUNK) {
    found.push(...await d1Select(`SELECT * FROM ${table} WHERE ${predicates(rows.slice(offset, offset + D1_KEY_CHUNK), primaryKey)}`))
  }
  return found
}

async function buildPlan(collections) {
  const tableNames = Object.keys(collections)
  if (!tableNames.length) return { schemaRows:[], plans:{}, summary:{} }
  const schemaRows = await d1Select(buildD1SchemaAuditQuery(tableNames))
  const schema = auditCanonicalD1Schema({ collections, schemaRows })
  if (!schema.compatible) throw new Error(`D1_SCHEMA_INCOMPATIBLE:${JSON.stringify(schema.tables)}`)
  const plans = {}
  const summary = {}
  for (const table of CANONICAL_WRITE_ORDER) {
    const sourceRows = collections[table] || []
    if (!sourceRows.length) continue
    const primaryKey = schema.tables[table].primary_key
    const existing = await destinationRows(table, sourceRows, primaryKey)
    const plan = planCanonicalRows({ sourceRows, destinationRows:existing, primaryKey })
    plans[table] = { ...plan, primaryKey }
    summary[table] = {
      selected:sourceRows.length,
      inserts:plan.inserts.length,
      updates:plan.updates.length,
      unchanged:plan.unchanged.length,
      conflicts:plan.conflicts.length,
    }
  }
  return { schemaRows, plans, summary }
}

async function backupD1(runId) {
  const directory = resolve(REPO_ROOT, '.migration/backups')
  const path = resolve(directory, `${runId}.sql`)
  await mkdir(directory, { recursive:true })
  await wrangler([
    'd1','export','yuisync-next-production','--remote','--env','production','--config',CONFIG,
    '--output',path,'--skip-confirmation',
  ], { maxBuffer:40 * 1024 * 1024 })
  return path
}

async function applySql(statements) {
  const directory = await mkdtemp(join(tmpdir(), 'yuisync-final-sync-'))
  const file = join(directory, 'batch.sql')
  try {
    for (let offset = 0; offset < statements.length; offset += SQL_ROW_CHUNK) {
      const sql = `PRAGMA foreign_keys=ON;\n${statements.slice(offset, offset + SQL_ROW_CHUNK).join('\n')}\n`
      await writeFile(file, sql, { encoding:'utf8', mode:0o600 })
      await wrangler([
        'd1','execute','yuisync-next-production','--remote','--env','production','--config',CONFIG,'--file',file,
      ])
    }
  } finally {
    await rm(directory, { recursive:true, force:true })
  }
}

function statementsForPlan(plans, cutoffMs, reconciliations) {
  const statements = []
  for (const override of reconciliations.overrides) {
    if (override.action !== 'exclude_subscription_benefit') continue
    statements.push(`UPDATE subscription_benefit_allocations SET state='released',released_at_ms=${cutoffMs},updated_at_ms=${cutoffMs},version=version+1 WHERE tenant_id=${sqlLiteral(TENANT_ID)} AND module_id=${sqlLiteral(MODULE_ID)} AND appointment_id=${sqlLiteral(override.appointment_id)} AND benefit_key=${sqlLiteral(override.benefit_key)} AND state IN ('reserved','consumed');`)
  }
  for (const table of CANONICAL_WRITE_ORDER) {
    const plan = plans[table]
    if (!plan) continue
    for (const row of plan.inserts) statements.push(buildInsertStatement(table, row))
    for (const row of plan.updates) {
      const statement = buildUpdateStatement(table, row, plan.primaryKey)
      if (statement) statements.push(statement)
    }
  }
  return statements
}

async function writePlannedSql(statements) {
  const path = resolve(REPO_ROOT, '.migration/quatro-patas-final-apply.sql')
  await writeFile(path, `PRAGMA foreign_keys=ON;\n${statements.join('\n')}\n`, { encoding:'utf8', mode:0o600 })
  return path
}

async function verifyReconciliations(reconciliations) {
  for (const override of reconciliations.overrides) {
    if (override.action !== 'exclude_subscription_benefit') continue
    const appointment = await d1Select(`SELECT id,status,subtotal_cents,subscription_id,subscription_benefit_used,subscription_benefit_status,subscription_discount_cents FROM appointments WHERE tenant_id=${sqlLiteral(TENANT_ID)} AND module_id=${sqlLiteral(MODULE_ID)} AND id=${sqlLiteral(override.appointment_id)}`)
    const allocations = await d1Select(`SELECT state FROM subscription_benefit_allocations WHERE tenant_id=${sqlLiteral(TENANT_ID)} AND module_id=${sqlLiteral(MODULE_ID)} AND appointment_id=${sqlLiteral(override.appointment_id)} AND benefit_key=${sqlLiteral(override.benefit_key)} AND state IN ('reserved','consumed')`)
    const row = appointment[0]
    if (!row || row.status !== 'completed' || Number(row.subtotal_cents) !== 13000 || row.subscription_id != null || Number(row.subscription_benefit_used) !== 0 || Number(row.subscription_discount_cents) !== 0 || allocations.length !== 0) {
      throw new Error('RECONCILIATION_VERIFY_FAILED')
    }
  }
}

function conflictCount(summary) {
  return Object.values(summary).reduce((total, item) => total + item.conflicts, 0)
}

function conflictDetails(plans) {
  return Object.fromEntries(Object.entries(plans)
    .filter(([, plan]) => plan.conflicts.length)
    .map(([table, plan]) => [table, plan.conflicts]))
}

async function writeReport(report) {
  const path = resolve(REPO_ROOT, '.migration/quatro-patas-final-sync-report.json')
  await mkdir(dirname(path), { recursive:true })
  await writeFile(path, `${JSON.stringify(report, null, 2)}\n`, { encoding:'utf8', mode:0o600 })
  return path
}

async function main() {
  const selectedMode = mode()
  const startMs = epoch(argument('start', process.env.QUATRO_PATAS_SYNC_START || DEFAULT_START), 'START')
  const cutoffMs = epoch(argument('cutoff', new Date().toISOString()), 'CUTOFF')
  if (startMs >= cutoffMs) throw new Error('SYNC_WINDOW_INVALID')
  const reconciliations = await readReconciliations()
  let projection
  let sourceHash
  let sourceReads
  let delta
  if (selectedMode === 'audit') {
    console.log(JSON.stringify({ stage:'source-snapshot', mode:selectedMode, start:new Date(startMs).toISOString(), cutoff:new Date(cutoffMs).toISOString() }))
    const stable = await stableSourceSnapshot(startMs, cutoffMs, reconciliations)
    await writeFrozenSnapshot({ startMs, cutoffMs, stable })
    projection = stable.snapshot.projection
    sourceHash = stable.hash
    sourceReads = stable.reads
    delta = stable.delta
  } else {
    console.log(JSON.stringify({ stage:'frozen-source-snapshot', mode:selectedMode, start:new Date(startMs).toISOString(), cutoff:new Date(cutoffMs).toISOString() }))
    const frozen = await readFrozenSnapshot(startMs, cutoffMs)
    projection = frozen.projection
    sourceHash = frozen.source_snapshot_hash
    sourceReads = 0
    delta = frozen.collections
  }
  const selectedCounts = Object.fromEntries(Object.entries(delta).map(([table, rows]) => [table, rows.length]))
  const baseReport = {
    version:1,
    tenant_id:TENANT_ID,
    module_id:MODULE_ID,
    mode:selectedMode,
    source_start:new Date(startMs).toISOString(),
    source_cutoff:new Date(cutoffMs).toISOString(),
    source_snapshot_hash:sourceHash,
    source_reads:sourceReads,
    projection,
    selected_counts:selectedCounts,
    reconciliation_count:reconciliations.overrides.length,
  }
  if (selectedMode === 'audit') {
    const report = { ...baseReport, status:'audited' }
    const reportPath = await writeReport(report)
    console.log(JSON.stringify({ ...report, report_path:reportPath }, null, 2))
    return
  }

  console.log(JSON.stringify({ stage:'d1-plan', tables:Object.keys(delta) }))
  const planned = await buildPlan(delta)
  const report = {
    ...baseReport,
    plan:planned.summary,
    conflicts:conflictCount(planned.summary),
    conflict_details:conflictDetails(planned.plans),
  }
  const plannedStatements = statementsForPlan(planned.plans, cutoffMs, reconciliations)
  const plannedSqlPath = await writePlannedSql(plannedStatements)
  if (selectedMode === 'plan') {
    const reportPath = await writeReport({ ...report, status:'planned' })
    console.log(JSON.stringify({ ...report, status:'planned', statements:plannedStatements.length, sql_path:plannedSqlPath, report_path:reportPath }, null, 2))
    return
  }

  if (selectedMode === 'apply') {
    if (argument('authorize') !== AUTHORIZATION) throw new Error('PRODUCTION_AUTHORIZATION_REQUIRED')
    const runId = `quatro-patas-final-${new Date(cutoffMs).toISOString().replaceAll(/[:.]/g, '-')}`
    console.log(JSON.stringify({ stage:'backup', run_id:runId }))
    const backupPath = await backupD1(runId)
    console.log(JSON.stringify({ stage:'apply', run_id:runId }))
    if (plannedStatements.length) await applySql(plannedStatements)
    const statements = plannedStatements.length
    await verifyReconciliations(reconciliations)
    const after = await buildPlan(delta)
    const pending = Object.values(after.summary).reduce((total, item) => total + item.inserts + item.updates, 0)
    if (pending !== 0) throw new Error(`POST_APPLY_RECONCILIATION_PENDING:${pending}`)
    const finalReport = { ...report, status:'applied-and-verified', run_id:runId, statements, backup_path:backupPath, post_apply:after.summary }
    const reportPath = await writeReport(finalReport)
    console.log(JSON.stringify({ ...finalReport, report_path:reportPath }, null, 2))
    return
  }

  await verifyReconciliations(reconciliations)
  const pending = Object.values(planned.summary).reduce((total, item) => total + item.inserts + item.updates, 0)
  if (pending !== 0) throw new Error(`VERIFY_PENDING:${pending}`)
  const reportPath = await writeReport({ ...report, status:'verified' })
  console.log(JSON.stringify({ ...report, status:'verified', report_path:reportPath }, null, 2))
}

main().catch((error) => {
  console.error(JSON.stringify({ status:'failed', error:String(error?.message || error) }))
  process.exitCode = 1
})
