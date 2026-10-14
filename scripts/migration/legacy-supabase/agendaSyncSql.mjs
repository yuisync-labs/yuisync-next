import { buildInsertStatement, sqlLiteral } from './finalSyncCore.mjs'

const keys = (table) => ['tenant_id', 'module_id', ...(table === 'appointment_services'
  ? ['appointment_id', 'position'] : table === 'appointment_transport' ? ['appointment_id']
    : table === 'module_settings_extensions' ? [] : ['id'])]
const predicate = (row, columns) => columns.map((column) => `${column} IS ${sqlLiteral(row[column])}`).join(' AND ')

// Submit every statement in one D1 batch. A failed guard must roll back the
// entire batch; do not split this into independently committed chunks.
export function buildAgendaSyncSql(plan, destination) {
  if (plan.conflicts.length) throw new Error('AGENDA_SYNC_CONFLICTS')
  const statements = []
  for (const table of ['appointments', 'appointment_services', 'appointment_transport']) {
    const rows = destination[table] || []
    for (let start = 0; start < rows.length; start += 30) {
      const chunk = rows.slice(start, start + 30)
      const matches = chunk.map((row) => {
        const columns = table === 'appointments' ? [...keys(table), 'updated_at_ms', 'version', 'status', 'responsible_staff_key', 'responsible_staff_name'] : Object.keys(row)
        return `(${predicate(row, columns)})`
      }).join(' OR ')
      statements.push(`SELECT CASE WHEN COUNT(*)=${chunk.length} THEN 1 ELSE json('agenda_concurrency_guard_failed') END FROM ${table} WHERE ${matches};`)
    }
  }
  const order = ['clients', 'pets', 'services', 'transport_options', 'commission_rules', 'module_settings_extensions', 'appointments', 'appointment_services', 'appointment_transport']
  for (const table of order) {
    for (const row of plan.inserts[table] || []) statements.push(buildInsertStatement(table, row))
    for (const { before, after } of plan.updates[table] || []) {
      statements.push(`SELECT CASE WHEN EXISTS(SELECT 1 FROM ${table} WHERE ${predicate(before, Object.keys(before))}) THEN 1 ELSE json('agenda_concurrency_guard_failed') END;`)
      const columns = Object.keys(after).filter((column) => !keys(table).includes(column))
      statements.push(`UPDATE ${table} SET ${columns.map((column) => `${column}=${sqlLiteral(after[column])}`).join(',')} WHERE ${predicate(before, keys(table))};`)
    }
  }
  return statements
}
