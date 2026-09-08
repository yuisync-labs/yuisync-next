import { execFile as execFileCallback } from 'node:child_process'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

import { DateTime } from 'luxon'

import { buildD1SchemaAuditQuery } from '../canonicalD1SchemaAudit.mjs'
import { buildCanonicalD1Sql } from '../canonicalD1Writer.mjs'
import { parseWranglerD1Json } from '../foundationExtractors.mjs'
import { projectLegacyCanonicalSnapshot } from '../legacyCanonicalProjection.mjs'
import { attachNormalizedAppointmentClients, projectNormalizedSupabaseClientsPets } from '../normalizedClientsPetsIntake.mjs'
import { extractSupabaseOperationalTables } from '../operationalExtractors.mjs'
import { snapshotHash, sqlLiteral } from './finalSyncCore.mjs'

const execFile = promisify(execFileCallback)
const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url))
const WRANGLER = resolve(REPO_ROOT, 'node_modules/wrangler/bin/wrangler.js')
const CONFIG = resolve(REPO_ROOT, process.env.QUATRO_PATAS_WRANGLER_CONFIG || '.migration/quatro-patas-production-wrangler.jsonc')
const RECONCILIATIONS_PATH = resolve(dirname(fileURLToPath(import.meta.url)), 'quatro-patas-reconciliations.json')
const TENANT_ID = '29d6a509-8b35-47d0-ad19-7cee6f17328c'
const MODULE_ID = 'petshop'
const DATABASE = 'yuisync-next-production'
const PAGE_SIZE = 500
const MAX_PAGES = 100
const ZONE = 'America/Sao_Paulo'
const REPORT_PATH = resolve(REPO_ROOT, '.migration/quatro-patas-today-sync-report.json')
const ROLLBACK_PATH = resolve(REPO_ROOT, '.migration/quatro-patas-today-rollback.json')
const SQL_PATH = resolve(REPO_ROOT, '.migration/quatro-patas-today-apply.sql')

function argument(name, fallback = '') {
  const prefix = `--${name}=`
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) || fallback
}

function mode() {
  const positional = process.argv.slice(2).find((value) => !value.startsWith('--')) || 'audit'
  if (!['audit', 'apply', 'verify'].includes(positional)) throw new Error(`INVALID_MODE:${positional}`)
  return positional
}

function required(name) {
  const value = String(process.env[name] || '').trim()
  if (!value) throw new Error(`MISSING_${name}`)
  return value
}

function normalize(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
}

function sourceHeaders(key, range) {
  return {
    accept: 'application/json',
    apikey: key,
    range,
    ...(key.startsWith('sb_secret_') ? {} : { authorization: `Bearer ${key}` }),
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
      method: 'GET',
      headers: sourceHeaders(key, `${page * PAGE_SIZE}-${page * PAGE_SIZE + PAGE_SIZE - 1}`),
      redirect: 'error',
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

async function sourceSnapshot(now) {
  const reconciliations = await readReconciliations()
  const [operational, clients, pets, appointments] = await Promise.all([
    extractSupabaseOperationalTables({
      supabaseUrl: required('SUPABASE_URL'),
      adminApiKey: required('SUPABASE_SECRET_KEY'),
      scope: { tenant_id: TENANT_ID, module_id: MODULE_ID },
    }),
    readRawSourceTable('clients'),
    readRawSourceTable('pets'),
    readRawSourceTable('appointments'),
  ])
  const projected = projectLegacyCanonicalSnapshot({ tables: operational.tables }, {
    tenantId: TENANT_ID,
    moduleId: MODULE_ID,
    reconciliationOverrides: reconciliations.overrides,
  })
  const normalized = projectNormalizedSupabaseClientsPets({
    clients,
    pets,
    appointments,
    scope: { tenant_id: TENANT_ID, module_id: MODULE_ID },
    now,
  })
  const aligned = attachNormalizedAppointmentClients({ appointments: projected.collections.appointments, pets: normalized.pets })
  return {
    clients: normalized.clients,
    pets: normalized.pets,
    ...projected.collections,
    appointments: aligned.appointments,
  }
}

function dayBounds(dateValue) {
  const start = DateTime.fromISO(dateValue, { zone: ZONE }).startOf('day')
  if (!start.isValid || start.toISODate() !== dateValue) throw new Error(`INVALID_DATE:${dateValue}`)
  return { startMs: start.toMillis(), endMs: start.plus({ days: 1 }).toMillis() }
}

function appointmentsForDay(collections, bounds) {
  return (collections.appointments || []).filter((row) => Number(row.scheduled_at_ms) >= bounds.startMs && Number(row.scheduled_at_ms) < bounds.endMs)
}

function sourceRelevantHash(collections, bounds) {
  const appointments = appointmentsForDay(collections, bounds)
  const ids = new Set(appointments.map((row) => row.id))
  return snapshotHash({
    appointments,
    appointment_services: (collections.appointment_services || []).filter((row) => ids.has(row.appointment_id)),
    appointment_transport: (collections.appointment_transport || []).filter((row) => ids.has(row.appointment_id)),
    subscription_benefit_allocations: (collections.subscription_benefit_allocations || []).filter((row) => ids.has(row.appointment_id)),
  })
}

async function stableSource(bounds) {
  const now = Date.now()
  const first = await sourceSnapshot(now)
  const second = await sourceSnapshot(now)
  const firstHash = sourceRelevantHash(first, bounds)
  const secondHash = sourceRelevantHash(second, bounds)
  if (firstHash === secondHash) return { collections: second, hash: secondHash, reads: 2 }
  const third = await sourceSnapshot(now)
  const thirdHash = sourceRelevantHash(third, bounds)
  if (secondHash !== thirdHash) throw new Error('SOURCE_TODAY_SNAPSHOT_UNSTABLE')
  return { collections: third, hash: thirdHash, reads: 3 }
}

async function wrangler(args, { maxBuffer = 20 * 1024 * 1024 } = {}) {
  return execFile(process.execPath, [WRANGLER, ...args], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    maxBuffer,
    windowsHide: true,
    env: process.env,
  })
}

async function d1Select(statement) {
  const windowsSafe = String(statement).replaceAll('p."notnull"', 'p.[notnull]')
  const result = await wrangler(['d1', 'execute', DATABASE, '--remote', '--env', 'production', '--config', CONFIG, '--command', windowsSafe, '--json'])
  return parseWranglerD1Json(result.stdout)
}

function localLabel(ms) {
  return DateTime.fromMillis(Number(ms), { zone: ZONE }).toFormat('dd/LL HH:mm')
}

function targetRows(bounds) {
  return d1Select(`
    SELECT a.id,a.scheduled_at_ms,a.duration_min,a.status,a.updated_at_ms,a.version,
      p.name AS pet_name,c.name AS owner_name
    FROM appointments a
    LEFT JOIN pets p ON p.tenant_id=a.tenant_id AND p.module_id=a.module_id AND p.id=a.pet_id
    LEFT JOIN clients c ON c.tenant_id=a.tenant_id AND c.module_id=a.module_id AND c.id=a.client_id
    WHERE a.tenant_id=${sqlLiteral(TENANT_ID)} AND a.module_id=${sqlLiteral(MODULE_ID)}
      AND a.scheduled_at_ms>=${bounds.startMs} AND a.scheduled_at_ms<${bounds.endMs}
    ORDER BY a.scheduled_at_ms,a.id
  `)
}

function sourceView(collections, appointments) {
  const pets = new Map((collections.pets || []).map((row) => [row.id, row]))
  const clients = new Map((collections.clients || []).map((row) => [row.id, row]))
  return appointments.map((row) => ({
    id: row.id,
    scheduled_at_ms: Number(row.scheduled_at_ms),
    duration_min: Number(row.duration_min),
    status: row.status,
    updated_at_ms: Number(row.updated_at_ms || 0),
    subscription_id: row.subscription_id || null,
    pet_name: pets.get(row.pet_id)?.name || '',
    owner_name: clients.get(row.client_id)?.name || '',
  }))
}

function selectedCollections(all, missingAppointments) {
  const appointmentIds = new Set(missingAppointments.map((row) => row.id))
  const clientIds = new Set(missingAppointments.map((row) => row.client_id).filter(Boolean))
  const petIds = new Set(missingAppointments.map((row) => row.pet_id).filter(Boolean))
  const servicesForAppointments = (all.appointment_services || []).filter((row) => appointmentIds.has(row.appointment_id))
  const serviceIds = new Set(servicesForAppointments.map((row) => row.service_id).filter(Boolean))
  const serviceCodes = new Set(servicesForAppointments.map((row) => row.service_code).filter(Boolean))
  const transport = (all.appointment_transport || []).filter((row) => appointmentIds.has(row.appointment_id))
  const transportIds = new Set(transport.map((row) => row.option_id).filter(Boolean))

  const out = {
    clients: (all.clients || []).filter((row) => clientIds.has(row.id)),
    pets: (all.pets || []).filter((row) => petIds.has(row.id)),
    services: (all.services || []).filter((row) => serviceIds.has(row.id) || serviceCodes.has(row.code)),
    appointments: missingAppointments,
    appointment_services: servicesForAppointments,
    transport_options: (all.transport_options || []).filter((row) => transportIds.has(row.id)),
    appointment_transport: transport,
  }
  return Object.fromEntries(Object.entries(out).filter(([, rows]) => rows.length))
}

async function inspect(dateValue) {
  const bounds = dayBounds(dateValue)
  const stable = await stableSource(bounds)
  const sourceAppointments = appointmentsForDay(stable.collections, bounds)
  const target = await targetRows(bounds)
  const targetById = new Map(target.map((row) => [row.id, row]))
  const sourceRows = sourceView(stable.collections, sourceAppointments)
  const missingAppointments = sourceAppointments.filter((row) => !targetById.has(row.id))
  const missingView = sourceView(stable.collections, missingAppointments)
  const mismatches = sourceRows.flatMap((source) => {
    const current = targetById.get(source.id)
    if (!current) return []
    const scheduleMismatch = Number(current.scheduled_at_ms) !== source.scheduled_at_ms
    const durationMismatch = Number(current.duration_min) !== source.duration_min
    if (!scheduleMismatch && !durationMismatch) return []
    return [{
      id: source.id,
      pet_name: source.pet_name,
      owner_name: source.owner_name,
      source_time: localLabel(source.scheduled_at_ms),
      target_time: localLabel(current.scheduled_at_ms),
      source_duration_min: source.duration_min,
      target_duration_min: Number(current.duration_min),
      source_updated_at_ms: source.updated_at_ms,
      target_updated_at_ms: Number(current.updated_at_ms || 0),
    }]
  })

  const correctionCandidates = mismatches.filter((row) => normalize(row.pet_name) === 'belinha')
  const otherMismatches = mismatches.filter((row) => normalize(row.pet_name) !== 'belinha')
  const report = {
    schema: 'yuisync-quatro-patas-today-sync/v1',
    date: dateValue,
    timezone: ZONE,
    tenant_id: TENANT_ID,
    source_reads: stable.reads,
    source_hash: stable.hash,
    source_appointments: sourceRows.length,
    target_appointments_before: target.length,
    missing_count: missingView.length,
    missing: missingView.map((row) => ({ ...row, local_time: localLabel(row.scheduled_at_ms) })),
    mismatches,
    correction_candidates: correctionCandidates,
    other_mismatches: otherMismatches,
  }
  await mkdir(dirname(REPORT_PATH), { recursive: true })
  await writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  return { report, stable, bounds, missingAppointments, correctionCandidates, otherMismatches }
}

function validateApplyPlan(state) {
  const { report, missingAppointments, correctionCandidates, otherMismatches } = state
  if (report.source_appointments < 1 || report.source_appointments > 100) throw new Error(`TODAY_SOURCE_COUNT_OUT_OF_RANGE:${report.source_appointments}`)
  if (missingAppointments.length > 50) throw new Error(`TODAY_MISSING_COUNT_OUT_OF_RANGE:${missingAppointments.length}`)
  const packageMissing = missingAppointments.filter((row) => row.subscription_id || Number(row.subscription_benefit_used || 0) !== 0)
  if (packageMissing.length) throw new Error(`MISSING_PACKAGE_APPOINTMENTS_REQUIRE_SEPARATE_REVIEW:${packageMissing.map((row) => row.id).join(',')}`)
  if (otherMismatches.length) throw new Error(`UNEXPECTED_EXISTING_APPOINTMENT_MISMATCH:${otherMismatches.map((row) => row.id).join(',')}`)
  if (correctionCandidates.length > 1) throw new Error(`BELINHA_CORRECTION_AMBIGUOUS:${correctionCandidates.length}`)
  if (correctionCandidates.length === 1) {
    const row = correctionCandidates[0]
    if (!row.source_time.endsWith('13:00') || !row.target_time.endsWith('15:50')) {
      throw new Error(`BELINHA_CORRECTION_GUARD_FAILED:${row.source_time}:${row.target_time}`)
    }
  }
}

async function apply(dateValue) {
  const state = await inspect(dateValue)
  validateApplyPlan(state)
  const collections = selectedCollections(state.stable.collections, state.missingAppointments)
  const tableNames = Object.keys(collections)
  let insertSql = 'PRAGMA foreign_keys=ON;\n'
  let tableCounts = {}
  if (tableNames.length) {
    const schemaRows = await d1Select(buildD1SchemaAuditQuery(tableNames))
    const built = buildCanonicalD1Sql({ collections, schemaRows, tenantId: TENANT_ID, moduleId: MODULE_ID })
    insertSql = built.sql
    tableCounts = built.tableCounts
  }

  const correction = state.correctionCandidates[0] || null
  let correctionSql = ''
  if (correction) {
    const source = state.stable.collections.appointments.find((row) => row.id === correction.id)
    const current = (await targetRows(state.bounds)).find((row) => row.id === correction.id)
    if (!source || !current) throw new Error('BELINHA_CORRECTION_ROW_NOT_FOUND')
    const now = Date.now()
    correctionSql = `\nUPDATE appointments SET scheduled_at_ms=${sqlLiteral(source.scheduled_at_ms)},duration_min=${sqlLiteral(source.duration_min)},updated_at_ms=${now},version=version+1 WHERE tenant_id=${sqlLiteral(TENANT_ID)} AND module_id=${sqlLiteral(MODULE_ID)} AND id=${sqlLiteral(source.id)} AND scheduled_at_ms=${sqlLiteral(current.scheduled_at_ms)};\n`
  }

  if (!state.missingAppointments.length && !correction) return verify(dateValue)

  const rollback = await wrangler(['d1', 'time-travel', 'info', DATABASE, '--remote', '--env', 'production', '--config', CONFIG, '--json'])
  await writeFile(ROLLBACK_PATH, rollback.stdout, { encoding: 'utf8', mode: 0o600 })
  await writeFile(SQL_PATH, `${insertSql}${correctionSql}`, { encoding: 'utf8', mode: 0o600 })
  await wrangler(['d1', 'execute', DATABASE, '--remote', '--env', 'production', '--config', CONFIG, '--file', SQL_PATH], { maxBuffer: 30 * 1024 * 1024 })

  const verified = await verify(dateValue)
  const report = {
    ...state.report,
    status: 'applied-and-verified',
    applied_at: new Date().toISOString(),
    inserted_table_counts: tableCounts,
    corrected_appointment_id: correction?.id || null,
    verification: verified,
  }
  await writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  return report
}

async function verify(dateValue) {
  const bounds = dayBounds(dateValue)
  const stable = await stableSource(bounds)
  const sourceAppointments = appointmentsForDay(stable.collections, bounds)
  const target = await targetRows(bounds)
  const targetById = new Map(target.map((row) => [row.id, row]))
  const missing = sourceAppointments.filter((row) => !targetById.has(row.id))
  const mismatches = sourceAppointments.filter((row) => {
    const current = targetById.get(row.id)
    return current && (Number(current.scheduled_at_ms) !== Number(row.scheduled_at_ms) || Number(current.duration_min) !== Number(row.duration_min))
  })
  const result = {
    date: dateValue,
    source_appointments: sourceAppointments.length,
    target_appointments_after: target.length,
    missing_ids: missing.map((row) => row.id),
    mismatched_ids: mismatches.map((row) => row.id),
    verified: missing.length === 0 && mismatches.length === 0,
  }
  if (!result.verified) throw new Error(`TODAY_SYNC_VERIFY_FAILED:${JSON.stringify(result)}`)
  return result
}

async function main() {
  const selectedMode = mode()
  const dateValue = argument('date', DateTime.now().setZone(ZONE).toISODate())
  required('SUPABASE_URL')
  required('SUPABASE_SECRET_KEY')
  required('CLOUDFLARE_API_TOKEN')
  await readFile(CONFIG, 'utf8')
  if (selectedMode === 'audit') console.log(JSON.stringify((await inspect(dateValue)).report, null, 2))
  else if (selectedMode === 'apply') console.log(JSON.stringify(await apply(dateValue), null, 2))
  else console.log(JSON.stringify(await verify(dateValue), null, 2))
}

main().catch(async (error) => {
  console.error(error?.stack || String(error))
  try { await rm(SQL_PATH, { force: true }) } catch {}
  process.exitCode = 1
})
