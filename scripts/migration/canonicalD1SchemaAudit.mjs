export class CanonicalD1SchemaAuditError extends Error {
  constructor(code, message = 'Canonical D1 schema audit failed.') {
    super(message)
    this.name = 'CanonicalD1SchemaAuditError'
    this.code = code
  }
}

function text(value) { return value == null ? '' : String(value).trim() }

export function buildD1SchemaAuditQuery(tableNames = []) {
  const names = [...new Set(tableNames.map(text).filter((name) => /^[a-z][a-z0-9_]*$/u.test(name)))].sort()
  if (!names.length) throw new CanonicalD1SchemaAuditError('TABLES_REQUIRED')
  const list = names.map((name) => `'${name}'`).join(',')
  return `SELECT m.name AS table_name,p.name AS column_name,p."notnull" AS is_required,p.dflt_value AS default_value,p.pk AS primary_key_position FROM sqlite_master AS m JOIN pragma_table_info(m.name) AS p WHERE m.type='table' AND m.name IN (${list}) ORDER BY m.name,p.cid`
}

export function auditCanonicalD1Schema({ collections = {}, schemaRows = [] } = {}) {
  if (!collections || typeof collections !== 'object' || Array.isArray(collections) || !Array.isArray(schemaRows)) {
    throw new CanonicalD1SchemaAuditError('INPUT_INVALID')
  }

  const schema = new Map()
  for (const row of schemaRows) {
    const table = text(row?.table_name)
    const column = text(row?.column_name)
    if (!table || !column) throw new CanonicalD1SchemaAuditError('SCHEMA_ROW_INVALID')
    if (!schema.has(table)) schema.set(table, new Map())
    schema.get(table).set(column, row)
  }

  const tables = {}
  let compatible = true
  for (const [table, rawRows] of Object.entries(collections).sort(([left], [right]) => left.localeCompare(right, 'en'))) {
    if (!Array.isArray(rawRows)) throw new CanonicalD1SchemaAuditError('COLLECTION_INVALID')
    const destination = schema.get(table)
    const sourceColumnSets = rawRows.map((row) => {
      if (!row || typeof row !== 'object' || Array.isArray(row)) throw new CanonicalD1SchemaAuditError('ROW_INVALID')
      return Object.keys(row).sort()
    })
    const sourceColumns = [...new Set(sourceColumnSets.flat())].sort()
    const inconsistentRows = sourceColumnSets.filter((columns) => JSON.stringify(columns) !== JSON.stringify(sourceColumns)).length
    const missingDestinationColumns = destination ? sourceColumns.filter((column) => !destination.has(column)) : sourceColumns
    const missingRequiredSourceColumns = destination && rawRows.length > 0
      ? [...destination.values()]
        .filter((column) => Number(column.is_required) === 1 && column.default_value == null && !sourceColumns.includes(column.column_name))
        .map((column) => column.column_name)
        .sort()
      : []
    const tableCompatible = Boolean(destination) && inconsistentRows === 0 && missingDestinationColumns.length === 0 && missingRequiredSourceColumns.length === 0
    if (!tableCompatible) compatible = false
    tables[table] = {
      rows: rawRows.length,
      destination_table_present: Boolean(destination),
      inconsistent_rows: inconsistentRows,
      missing_destination_columns: missingDestinationColumns,
      missing_required_source_columns: missingRequiredSourceColumns,
      primary_key: destination
        ? [...destination.values()].filter((column) => Number(column.primary_key_position) > 0).sort((a, b) => Number(a.primary_key_position) - Number(b.primary_key_position)).map((column) => column.column_name)
        : [],
    }
  }

  return { compatible, tables }
}
