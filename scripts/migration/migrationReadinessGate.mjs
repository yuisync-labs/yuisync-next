import { createHash } from 'node:crypto'
import { validateRegistryCoverage } from './legacyIntakeRegistry.mjs'

export const REQUIRED_INTAKE_TABLES = Object.freeze([
  'migration_runs',
  'migration_source_records',
  'migration_source_payload_chunks',
  'migration_secret_vault',
  'migration_table_checkpoints',
  'migration_reconciliation',
])

export class MigrationReadinessError extends Error {
  constructor(code, report) {
    super(code)
    this.name = 'MigrationReadinessError'
    this.code = code
    this.report = report
  }
}

export function schemaFingerprint(items = []) {
  const canonical = [...items]
    .map((item) => ({
      name: String(item?.table_name || item?.name || '').toLowerCase(),
      type: String(item?.table_type || item?.type || ''),
      columns: [...(item?.columns || [])].map(String).sort(),
    }))
    .sort((a, b) => a.name.localeCompare(b.name, 'en'))
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex')
}

export function evaluateMigrationReadiness({
  discoveredSource = [],
  destinationTables = [],
  authSummary = null,
  secretSummary = null,
  storageSummary = null,
  clientsPetsSummary = null,
  payloadSummary = null,
} = {}) {
  const checks = []
  const coverage = validateRegistryCoverage(discoveredSource)
  checks.push({ id: 'source_registry_coverage', ok: coverage.ok, failures: coverage.failures, warnings: coverage.warnings })

  const destinationSet = new Set(destinationTables.map((value) => String(value).toLowerCase()))
  const missingIntakeTables = REQUIRED_INTAKE_TABLES.filter((name) => !destinationSet.has(name))
  checks.push({ id: 'destination_intake_schema', ok: missingIntakeTables.length === 0, missing: missingIntakeTables })

  if (authSummary) {
    const hashesOk = Number(authSummary.total || 0) === Number(authSummary.bcrypt || 0)
    const membershipsOk = Number(authSummary.explicit_memberships || 0) > 0
      && Number(authSummary.explicit_memberships || 0) <= Number(authSummary.total || 0)
    checks.push({ id: 'auth_bcrypt_compatibility', ok: hashesOk, ...authSummary })
    checks.push({ id: 'auth_explicit_memberships', ok: membershipsOk, explicit_memberships: authSummary.explicit_memberships, total: authSummary.total })
  }

  if (secretSummary) {
    const secrets = Number(secretSummary.secret_values || 0)
    checks.push({ id: 'secret_vault_requirement', ok: secrets === 0 || secretSummary.vault_ready === true, ...secretSummary })
  }

  if (storageSummary) {
    checks.push({
      id: 'storage_external_assets',
      ok: Number(storageSummary.supabase_hosted_assets || 0) === 0 || storageSummary.asset_migration_ready === true,
      ...storageSummary,
    })
  }

  if (clientsPetsSummary) {
    const lossless = Number(clientsPetsSummary.destination_pets || 0) === Number(clientsPetsSummary.source_pets || 0)
      && Number(clientsPetsSummary.destination_clients || 0) >= Number(clientsPetsSummary.source_clients || 0)
      && Number(clientsPetsSummary.ambiguous_matches || 0) === 0
    checks.push({ id: 'clients_pets_lossless_projection', ok: lossless, ...clientsPetsSummary })
  }

  if (payloadSummary) {
    const oversized = Number(payloadSummary.oversized_rows || 0)
    checks.push({
      id: 'oversized_payload_support',
      ok: oversized === 0 || payloadSummary.chunking_ready === true,
      ...payloadSummary,
    })
  }

  return { ready: checks.every((check) => check.ok), checks }
}

export function assertMigrationReady(input) {
  const report = evaluateMigrationReadiness(input)
  if (!report.ready) throw new MigrationReadinessError('MIGRATION_NOT_READY', report)
  return report
}
