import { createHash } from 'node:crypto'

import { isSensitiveFieldName, registryEntry, sourceKeyFor } from './legacyIntakeRegistry.mjs'
import { sealMigrationSecret } from './migrationSecretVault.mjs'

export class LegacyIntakeProjectionError extends Error {
  constructor(code, message = 'Legacy intake projection failed.') {
    super(message)
    this.name = 'LegacyIntakeProjectionError'
    this.code = code
  }
}

function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
}

function checksum(value) {
  return createHash('sha256').update(canonical(value)).digest('hex')
}

function safeModule(value) {
  const moduleId = String(value || '').trim().toLowerCase()
  return /^[a-z0-9][a-z0-9_-]{0,63}$/u.test(moduleId) ? moduleId : null
}

function maybeUrl(value, path, secrets) {
  if (typeof value !== 'string' || !/^https?:\/\//iu.test(value)) return value
  let url
  try { url = new URL(value) } catch { return value }
  let changed = false
  for (const [name, param] of [...url.searchParams.entries()]) {
    if (!isSensitiveFieldName(name) && !/(?:token|signature|sig|key|secret)$/iu.test(name)) continue
    if (param) secrets.push({ path: `${path}?${name}`, value: param })
    url.searchParams.set(name, '[redacted]')
    changed = true
  }
  return changed ? url.toString() : value
}

function sanitizeValue(value, path, secrets, extraSensitiveFields) {
  if (Array.isArray(value)) return value.map((item, index) => sanitizeValue(item, `${path}[${index}]`, secrets, extraSensitiveFields))
  if (!value || typeof value !== 'object') return maybeUrl(value, path, secrets)

  const output = {}
  for (const [key, nested] of Object.entries(value)) {
    const nestedPath = path === '$' ? `$.${key}` : `${path}.${key}`
    if (isSensitiveFieldName(key, extraSensitiveFields)) {
      if (nested != null && String(nested) !== '') secrets.push({ path: nestedPath, value: typeof nested === 'string' ? nested : canonical(nested) })
      continue
    }
    output[key] = sanitizeValue(nested, nestedPath, secrets, extraSensitiveFields)
  }
  return output
}

function assertTenantScope(entry, row, expectedTenantId, tableName) {
  if (entry.scope !== 'tenant') return
  const actual = String(row?.tenant_id || '').trim()
  if (!actual || actual !== expectedTenantId) {
    throw new LegacyIntakeProjectionError('MIGRATION_TENANT_SCOPE_MISMATCH', `${tableName} row is outside selected tenant.`)
  }
}

export function projectLegacySourceRows({
  runId,
  tableName,
  rows = [],
  tenantId,
  defaultModuleId = 'petshop',
  vaultKey = null,
  now = Date.now(),
} = {}) {
  const entry = registryEntry(tableName)
  if (!entry) throw new LegacyIntakeProjectionError('MIGRATION_TABLE_NOT_REGISTERED')
  if (entry.scope === 'view') {
    return { records: [], secrets: [], checkpoint: { source_table: tableName, source_row_count: 0, staged_row_count: 0, status: 'ignored' } }
  }
  if (!Array.isArray(rows)) throw new LegacyIntakeProjectionError('MIGRATION_ROWS_INVALID')
  const normalizedTenant = String(tenantId || '').trim()
  if (!normalizedTenant) throw new LegacyIntakeProjectionError('MIGRATION_TENANT_REQUIRED')
  const normalizedRun = String(runId || '').trim()
  if (!normalizedRun) throw new LegacyIntakeProjectionError('MIGRATION_RUN_REQUIRED')

  const records = []
  const sealedSecrets = []
  const seen = new Set()

  for (const row of rows) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) throw new LegacyIntakeProjectionError('MIGRATION_ROW_INVALID')
    assertTenantScope(entry, row, normalizedTenant, tableName)
    const sourceKey = sourceKeyFor(tableName, row)
    if (seen.has(sourceKey)) throw new LegacyIntakeProjectionError('MIGRATION_SOURCE_KEY_DUPLICATE')
    seen.add(sourceKey)

    const extracted = []
    const sanitized = sanitizeValue(row, '$', extracted, entry.secretFields || [])
    const moduleId = safeModule(row.module_id) || (entry.scope === 'tenant' ? safeModule(defaultModuleId) : null)

    if (extracted.length && !vaultKey) {
      throw new LegacyIntakeProjectionError('MIGRATION_VAULT_KEY_REQUIRED_FOR_SECRET')
    }

    const secretNames = extracted.map(({ path }) => path).sort()
    for (const item of extracted) {
      const context = { runId: normalizedRun, sourceTable: tableName, sourceKey, secretPath: item.path }
      sealedSecrets.push({
        run_id: normalizedRun,
        source_table: tableName,
        source_key: sourceKey,
        secret_path: item.path,
        tenant_id: normalizedTenant,
        destination_hint: entry.destinationHint,
        ...sealMigrationSecret(item.value, context, vaultKey),
        status: 'sealed',
        created_at_ms: now,
        updated_at_ms: now,
      })
    }

    records.push({
      run_id: normalizedRun,
      source_table: tableName,
      source_key: sourceKey,
      tenant_id: normalizedTenant,
      module_id: moduleId,
      disposition: entry.disposition,
      data_class: entry.dataClass,
      destination_hint: entry.destinationHint,
      payload_json: JSON.stringify(sanitized),
      payload_checksum: checksum(sanitized),
      secret_names_json: JSON.stringify(secretNames),
      source_created_at_ms: null,
      source_updated_at_ms: null,
      staged_at_ms: now,
    })
  }

  const recordDigest = records.map((record) => `${record.source_key}:${record.payload_checksum}`).sort()
  const stagedChecksum = createHash('sha256').update(recordDigest.join('\n')).digest('hex')

  return {
    records,
    secrets: sealedSecrets,
    checkpoint: {
      source_table: tableName,
      source_row_count: rows.length,
      staged_row_count: records.length,
      staged_checksum: stagedChecksum,
      status: 'staged',
    },
  }
}
