import { createHash } from 'node:crypto'

export function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

export function snapshotHash(collections = {}) {
  return createHash('sha256').update(stableJson(collections)).digest('hex')
}

export function rowHash(row = {}) {
  return createHash('sha256').update(stableJson(row)).digest('hex')
}

export function rowTimestamp(row = {}) {
  const preferred = Number(row.updated_at_ms)
  if (Number.isFinite(preferred) && preferred > 0) return preferred
  const timestamps = Object.entries(row).flatMap(([key, value]) => {
    if (!key.endsWith('_at_ms')) return []
    const parsed = Number(value)
    return Number.isFinite(parsed) && parsed > 0 ? [parsed] : []
  })
  return timestamps.length ? Math.max(...timestamps) : 0
}

export function primaryKeySignature(row, primaryKey = []) {
  if (!primaryKey.length) throw new Error('PRIMARY_KEY_REQUIRED')
  return primaryKey.map((column) => `${column}:${stableJson(row?.[column])}`).join('|')
}

export function rowsEqual(left, right) {
  if (!left || !right) return false
  const sourceColumns = Object.keys(left)
  const projectedDestination = Object.fromEntries(sourceColumns.map((column) => [column, right[column]]))
  return stableJson(left) === stableJson(projectedDestination)
}

export function planCanonicalRows({ sourceRows = [], destinationRows = [], primaryKey = [] } = {}) {
  const destination = new Map(destinationRows.map((row) => [primaryKeySignature(row, primaryKey), row]))
  const result = { inserts: [], updates: [], unchanged: [], conflicts: [] }
  for (const source of sourceRows) {
    const key = primaryKeySignature(source, primaryKey)
    const current = destination.get(key)
    if (!current) {
      result.inserts.push(source)
      continue
    }
    if (rowsEqual(source, current)) {
      result.unchanged.push(source)
      continue
    }
    const sourceTimestamp = rowTimestamp(source)
    const destinationTimestamp = rowTimestamp(current)
    if (sourceTimestamp > destinationTimestamp) {
      result.updates.push(source)
      continue
    }
    result.conflicts.push({
      key,
      reason: sourceTimestamp === destinationTimestamp ? 'equal_timestamp_divergence' : 'destination_newer',
      source_timestamp_ms: sourceTimestamp,
      destination_timestamp_ms: destinationTimestamp,
      differing_columns:Object.keys(source)
        .filter((column) => stableJson(source[column]) !== stableJson(current[column]))
        .sort(),
      source_hash:rowHash(source),
      destination_hash:rowHash(Object.fromEntries(Object.keys(source).map((column) => [column, current[column]]))),
    })
  }
  return result
}

export function selectChangedRows(collections = {}, { startMs, cutoffMs } = {}) {
  const selected = {}
  for (const [table, rows] of Object.entries(collections)) {
    const changed = rows.filter((row) => {
      const timestamp = rowTimestamp(row)
      return timestamp >= startMs && timestamp <= cutoffMs
    })
    if (changed.length) selected[table] = changed
  }

  const includeBy = (table, column, values) => {
    if (!values.size || !collections[table]?.length) return
    const existing = new Map((selected[table] || []).map((row) => [stableJson(row), row]))
    for (const row of collections[table]) {
      if (values.has(row[column])) existing.set(stableJson(row), row)
    }
    if (existing.size) selected[table] = [...existing.values()]
  }

  const appointmentIds = new Set((selected.appointments || []).map((row) => row.id))
  includeBy('appointment_services', 'appointment_id', appointmentIds)
  includeBy('appointment_transport', 'appointment_id', appointmentIds)
  includeBy('subscription_benefit_allocations', 'appointment_id', appointmentIds)

  const subscriptionIds = new Set((selected.client_subscriptions || []).map((row) => row.id))
  includeBy('subscription_benefit_allocations', 'subscription_id', subscriptionIds)

  const saleIds = new Set((selected.sales || []).map((row) => row.id))
  includeBy('sale_items', 'sale_id', saleIds)
  includeBy('payments', 'sale_id', saleIds)
  includeBy('invoices', 'sale_id', saleIds)

  const paymentIds = new Set((selected.payments || []).map((row) => row.id))
  includeBy('payment_splits', 'payment_id', paymentIds)

  return Object.fromEntries(Object.entries(selected).filter(([, rows]) => rows.length))
}

export function sqlLiteral(value) {
  if (value == null) return 'NULL'
  if (typeof value === 'boolean') return value ? '1' : '0'
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return `'${String(value).replaceAll("'", "''")}'`
}

export function buildUpsertStatement(table, row, primaryKey) {
  const columns = Object.keys(row).sort()
  const updates = columns.filter((column) => !primaryKey.includes(column))
  const guard = columns.includes('updated_at_ms')
    ? ` WHERE excluded.updated_at_ms > ${table}.updated_at_ms`
    : ''
  return `INSERT INTO ${table}(${columns.join(',')}) VALUES(${columns.map((column) => sqlLiteral(row[column])).join(',')}) ON CONFLICT(${primaryKey.join(',')}) DO ${updates.length ? `UPDATE SET ${updates.map((column) => `${column}=excluded.${column}`).join(',')}${guard}` : 'NOTHING'};`
}

export function buildInsertStatement(table, row) {
  const columns = Object.keys(row).sort()
  return `INSERT INTO ${table}(${columns.join(',')}) VALUES(${columns.map((column) => sqlLiteral(row[column])).join(',')});`
}

export function buildUpdateStatement(table, row, primaryKey) {
  const columns = Object.keys(row).sort()
  const updates = columns.filter((column) => !primaryKey.includes(column))
  if (!updates.length) return null
  const keyPredicate = primaryKey.map((column) => `${column}=${sqlLiteral(row[column])}`).join(' AND ')
  const timestampGuard = columns.includes('updated_at_ms')
    ? ` AND updated_at_ms < ${sqlLiteral(row.updated_at_ms)}`
    : ''
  return `UPDATE ${table} SET ${updates.map((column) => `${column}=${sqlLiteral(row[column])}`).join(',')} WHERE ${keyPredicate}${timestampGuard};`
}
