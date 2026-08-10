export const REQUIRED_DOMAIN_TABLES = Object.freeze([
  'clients','pets','catalog_products','services','inventory_balances','inventory_movements',
  'module_operational_settings','booking_hours','payment_method_settings',
  'appointments','appointment_services','transport_options','appointment_transport',
  'sales','sale_items','payments','payment_splits','financial_effects',
  'chat_threads','chat_messages','operation_checkpoints','operation_effects','fiscal_documents','effect_outbox',
])

export type DomainSchemaReadiness = Readonly<{
  status: 'ready' | 'not_ready'
  schemaVersion: number | null
  missingTables: readonly string[]
}>

export async function checkDomainSchemaReadiness(database?: D1Database): Promise<DomainSchemaReadiness> {
  if (!database) return { status: 'not_ready', schemaVersion: null, missingTables: REQUIRED_DOMAIN_TABLES }
  const [version, tables] = await Promise.all([
    database.prepare(`SELECT value FROM _yuisync_system_metadata WHERE key='schema_version'`).first<{ value: string }>(),
    database.prepare(`SELECT name FROM sqlite_schema WHERE type='table'`).all<{ name: string }>(),
  ])
  const available = new Set(tables.results.map((row) => row.name))
  const missingTables = REQUIRED_DOMAIN_TABLES.filter((name) => !available.has(name))
  const schemaVersion = Number.parseInt(version?.value ?? '', 10)
  return {
    status: missingTables.length === 0 && schemaVersion >= 15 ? 'ready' : 'not_ready',
    schemaVersion: Number.isFinite(schemaVersion) ? schemaVersion : null,
    missingTables,
  }
}