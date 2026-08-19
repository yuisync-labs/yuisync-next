import { createHash } from 'node:crypto'
import { registryEntry, validateRegistryCoverage } from './legacyIntakeRegistry.mjs'

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

function canonicalSourceTables(discoveredSource = []) {
  return [...new Set(discoveredSource.flatMap((item) => {
    const name = String(item?.table_name || item?.name || '').trim().toLowerCase()
    const type = String(item?.table_type || item?.type || 'BASE TABLE').toUpperCase()
    const rows = Number(item?.row_count ?? item?.rows ?? 0)
    if (!name || type === 'VIEW' || rows <= 0) return []
    const entry = registryEntry(name)
    return entry?.disposition === 'canonical' ? [name] : []
  }))].sort((left, right) => left.localeCompare(right, 'en'))
}

function normalizedTableSet(values = []) {
  return new Set((Array.isArray(values) ? values : []).map((value) => String(value || '').trim().toLowerCase()).filter(Boolean))
}

function canonicalProjectionCheck(discoveredSource, summary) {
  const required = canonicalSourceTables(discoveredSource)
  const projected = normalizedTableSet(summary?.projected_tables)
  const reconciled = normalizedTableSet(summary?.reconciled_tables)
  const mismatched = [...normalizedTableSet(summary?.mismatched_tables)].sort((left, right) => left.localeCompare(right, 'en'))
  const missingProjected = required.filter((name) => !projected.has(name))
  const missingReconciled = required.filter((name) => !reconciled.has(name))
  const relevantMismatches = mismatched.filter((name) => required.includes(name))

  return {
    id: 'canonical_projection_coverage',
    ok: missingProjected.length === 0 && missingReconciled.length === 0 && relevantMismatches.length === 0,
    required_tables: required,
    projected_tables: [...projected].sort((left, right) => left.localeCompare(right, 'en')),
    reconciled_tables: [...reconciled].sort((left, right) => left.localeCompare(right, 'en')),
    missing_projected: missingProjected,
    missing_reconciled: missingReconciled,
    mismatched_tables: relevantMismatches,
  }
}

export function evaluateMigrationReadiness({
  discoveredSource = [],
  destinationTables = [],
  authSummary = null,
  secretSummary = null,
  storageSummary = null,
  clientsPetsSummary = null,
  payloadSummary = null,
  canonicalProjectionSummary = null,
} = {}) {
  const checks = []
  const coverage = validateRegistryCoverage(discoveredSource)
  checks.push({ id: 'source_registry_coverage', ok: coverage.ok, failures: coverage.failures, warnings: coverage.warnings })

  const destinationSet = new Set(destinationTables.map((value) => String(value).toLowerCase()))
  const missingIntakeTables = REQUIRED_INTAKE_TABLES.filter((name) => !destinationSet.has(name))
  checks.push({ id: 'destination_intake_schema', ok: missingIntakeTables.length === 0, missing: missingIntakeTables })

  // A table being safely staged in migration_source_records does not mean it has
  // reached the canonical D1 domain. Every non-empty source table registered as
  // canonical must be both projected and reconciled before cutover is allowed.
  checks.push(canonicalProjectionCheck(discoveredSource, canonicalProjectionSummary))

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

export { canonicalSourceTables }
