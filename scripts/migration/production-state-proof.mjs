#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url))
const EDGE_DIR = resolve(REPO_ROOT, 'apps/edge-api')
const CAPTURE_PATH = resolve(REPO_ROOT, '.artifacts/production-release/state-before-migration.json')
const VERIFY_PATH = resolve(REPO_ROOT, '.artifacts/production-rollback/state-after-restore.json')
const COMMAND = String(process.argv[2] || '').trim().toLowerCase()

const AGENDA_SQL = `
SELECT 'appointments' AS surface,
       COALESCE(status,'') AS dimension_a,
       COALESCE(source,'') AS dimension_b,
       COALESCE(subscription_benefit_status,'') AS dimension_c,
       COUNT(*) AS row_count,
       COALESCE(SUM(scheduled_at_ms),0) AS metric_1,
       COALESCE(SUM(duration_min),0) AS metric_2,
       COALESCE(SUM(subtotal_cents),0) AS metric_3,
       COALESCE(SUM(transport_fee_cents),0) AS metric_4,
       COALESCE(SUM(version),0) AS metric_5,
       COALESCE(SUM(updated_at_ms),0) AS metric_6
FROM appointments
GROUP BY 1,2,3,4
UNION ALL
SELECT 'appointment_services',
       COALESCE(service_group,''),
       COALESCE(service_code,''),
       CAST(benefit_used AS TEXT),
       COUNT(*),
       COALESCE(SUM(unit_price_cents),0),
       COALESCE(SUM(duration_min),0),
       COALESCE(SUM(COALESCE(catalog_price_cents,0)),0),
       COALESCE(SUM(COALESCE(commission_basis_points,0)),0),
       COALESCE(SUM(position),0),
       0
FROM appointment_services
GROUP BY 1,2,3,4
UNION ALL
SELECT 'benefit_allocations',
       COALESCE(state,''),
       COALESCE(benefit_kind,''),
       COALESCE(benefit_key,''),
       COUNT(*),
       COALESCE(SUM(catalog_price_cents),0),
       COALESCE(SUM(version),0),
       COALESCE(SUM(COALESCE(reserved_at_ms,0)),0),
       COALESCE(SUM(COALESCE(consumed_at_ms,0)),0),
       COALESCE(SUM(COALESCE(released_at_ms,0)),0),
       COALESCE(SUM(updated_at_ms),0)
FROM subscription_benefit_allocations
GROUP BY 1,2,3,4
ORDER BY 1,2,3,4;
`

const FINANCIAL_SQL = `
SELECT 'sales' AS surface,
       COALESCE(status,'') AS dimension_a,
       COALESCE(source,'') AS dimension_b,
       COALESCE(origin_type,'') AS dimension_c,
       COUNT(*) AS row_count,
       COALESCE(SUM(subtotal_cents),0) AS metric_1,
       COALESCE(SUM(discount_cents),0) AS metric_2,
       COALESCE(SUM(transport_fee_cents),0) AS metric_3,
       COALESCE(SUM(total_cents),0) AS metric_4,
       COALESCE(SUM(created_at_ms),0) AS metric_5,
       COALESCE(SUM(updated_at_ms),0) AS metric_6
FROM sales
GROUP BY 1,2,3,4
UNION ALL
SELECT 'payments',
       COALESCE(status,''),
       COALESCE(method,''),
       COALESCE(provider,''),
       COUNT(*),
       COALESCE(SUM(amount_cents),0),
       COALESCE(SUM(COALESCE(received_at_ms,0)),0),
       COALESCE(SUM(created_at_ms),0),
       COALESCE(SUM(updated_at_ms),0),
       0,
       0
FROM payments
GROUP BY 1,2,3,4
UNION ALL
SELECT 'cash_register',
       CASE WHEN closed_at_ms IS NULL THEN 'open' ELSE 'closed' END,
       '',
       '',
       COUNT(*),
       COALESCE(SUM(opening_balance_cents),0),
       COALESCE(SUM(COALESCE(closing_balance_cents,0)),0),
       COALESCE(SUM(COALESCE(expected_balance_cents,0)),0),
       COALESCE(SUM(COALESCE(difference_cents,0)),0),
       COALESCE(SUM(opened_at_ms),0),
       COALESCE(SUM(COALESCE(closed_at_ms,0)),0)
FROM cash_register
GROUP BY 1,2,3,4
UNION ALL
SELECT 'client_subscriptions',
       COALESCE(status,''),
       COALESCE(plan_id,''),
       '',
       COUNT(*),
       COALESCE(SUM(started_at_ms),0),
       COALESCE(SUM(COALESCE(cancelled_at_ms,0)),0),
       COALESCE(SUM(created_at_ms),0),
       COALESCE(SUM(updated_at_ms),0),
       COALESCE(SUM(length(services_used_json)),0),
       COALESCE(SUM(length(benefit_ledger_base_used_json)),0)
FROM client_subscriptions
GROUP BY 1,2,3,4
ORDER BY 1,2,3,4;
`

function required(name) {
  const value = String(process.env[name] || '').trim()
  if (!value) throw new Error(`${name}_REQUIRED`)
  return value
}

export function canonicalRows(rows) {
  return [...(Array.isArray(rows) ? rows : [])]
    .map((row) => Object.fromEntries(Object.entries(row || {}).sort(([a], [b]) => a.localeCompare(b))))
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
}

export function stateFingerprint(rows) {
  return createHash('sha256').update(JSON.stringify(canonicalRows(rows))).digest('hex')
}

export function buildStateProof({ agendaRows, financialRows, capturedAt = new Date().toISOString() }) {
  const agenda = canonicalRows(agendaRows)
  const financial = canonicalRows(financialRows)
  return {
    schema: 'yuisync-production-state-proof/v1',
    captured_at: capturedAt,
    agenda: { sha256: stateFingerprint(agenda), groups: agenda.length, rows: agenda },
    financial: { sha256: stateFingerprint(financial), groups: financial.length, rows: financial },
  }
}

export function verifyStateProof(proof, expected) {
  const agendaExpected = String(expected?.agenda || '').trim().toLowerCase()
  const financialExpected = String(expected?.financial || '').trim().toLowerCase()
  if (!/^[0-9a-f]{64}$/.test(agendaExpected)) throw new Error('EXPECTED_AGENDA_STATE_SHA256_INVALID')
  if (!/^[0-9a-f]{64}$/.test(financialExpected)) throw new Error('EXPECTED_FINANCIAL_STATE_SHA256_INVALID')
  if (proof?.agenda?.sha256 !== agendaExpected) throw new Error(`ROLLBACK_AGENDA_STATE_MISMATCH:${agendaExpected}:${proof?.agenda?.sha256 || 'missing'}`)
  if (proof?.financial?.sha256 !== financialExpected) throw new Error(`ROLLBACK_FINANCIAL_STATE_MISMATCH:${financialExpected}:${proof?.financial?.sha256 || 'missing'}`)
  return true
}

function wranglerRows(sql) {
  const config = required('YUISYNC_PRODUCTION_WRANGLER_CONFIG')
  const output = execFileSync('npx', [
    'wrangler', 'd1', 'execute', 'DB', '--env', 'production', '--remote',
    '--config', config, '--json', '--command', sql,
  ], {
    cwd: EDGE_DIR,
    env: process.env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 16 * 1024 * 1024,
  })
  const parsed = JSON.parse(output)
  return (Array.isArray(parsed) ? parsed : [parsed]).flatMap((entry) => Array.isArray(entry?.results) ? entry.results : [])
}

async function capture(path, verify = false) {
  const proof = buildStateProof({
    agendaRows: wranglerRows(AGENDA_SQL),
    financialRows: wranglerRows(FINANCIAL_SQL),
  })
  if (verify) {
    verifyStateProof(proof, {
      agenda: required('PRODUCTION_EXPECTED_AGENDA_STATE_SHA256'),
      financial: required('PRODUCTION_EXPECTED_FINANCIAL_STATE_SHA256'),
    })
  }
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(proof, null, 2)}\n`, 'utf8')
  console.log(JSON.stringify({
    status: verify ? 'verified' : 'captured',
    agenda_sha256: proof.agenda.sha256,
    financial_sha256: proof.financial.sha256,
  }))
  return proof
}

async function main() {
  if (COMMAND === 'capture') return capture(CAPTURE_PATH, false)
  if (COMMAND === 'verify') return capture(VERIFY_PATH, true)
  throw new Error('Usage: node scripts/migration/production-state-proof.mjs <capture|verify>')
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
