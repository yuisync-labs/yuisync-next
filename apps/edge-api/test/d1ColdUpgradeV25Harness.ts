import { applyD1Migrations } from 'cloudflare:test'
import { expect } from 'vitest'

/** Build a real historical database, then apply every subsequent migration.
 * MIGRATION_DB deliberately skips the latest-schema setup used by API tests.
 */
export async function upgradeHistoricalDatabase(
  db: D1Database,
  migrations: Parameters<typeof applyD1Migrations>[1],
  version: number,
) {
  const migrationVersion = (name: string) => Number.parseInt(name.split('_', 1)[0], 10)
  const historical = migrations.filter(migration => migrationVersion(migration.name) <= version)
  const subsequent = migrations.filter(migration => migrationVersion(migration.name) > version)
  expect(historical.length).toBeGreaterThan(0)
  expect(subsequent.length).toBeGreaterThan(0)
  // A fresh fixture prevents newer columns, indexes or receipts surviving a fake downgrade.
  expect(await db.prepare("SELECT name FROM sqlite_schema WHERE name='d1_migrations'").first()).toBeNull()
  await applyD1Migrations(db, historical)
  const before = await db.prepare("SELECT value FROM _yuisync_system_metadata WHERE key='schema_version'")
    .first<{value: string}>()
  expect(before?.value).toBe(String(version))
  const oldLuna = await db.prepare("SELECT name FROM sqlite_schema WHERE name='luna_proposals'").first()
  expect(oldLuna).toBeNull()

  await applyD1Migrations(db, subsequent)
  // Migration receipts must also make a deployment retry safe.
  await applyD1Migrations(db, migrations)
  const applied = await db.prepare('SELECT name FROM d1_migrations ORDER BY name').all<{name: string}>()
  expect(applied.results.map(row => row.name)).toEqual(migrations.map(migration => migration.name).sort())
  expect((await db.prepare('PRAGMA foreign_key_check').all()).results).toEqual([])
  const proposalColumns = await db.prepare('PRAGMA table_info(luna_proposals)').all<{name: string}>()
  expect(proposalColumns.results.filter(column => column.name === 'operation_id')).toHaveLength(1)
}

async function assertV30(db: D1Database) {
  const version = await db.prepare("SELECT value FROM _yuisync_system_metadata WHERE key='schema_version'")
    .first<{ value: string }>()
  expect(version?.value).toBe('30')

  const violations = await db.prepare('PRAGMA foreign_key_check').all()
  expect(violations.results).toEqual([])

  const tables = await db.prepare(`
    SELECT name FROM sqlite_schema
    WHERE type='table' AND name IN (
      'whatsapp_waba_accounts',
      'whatsapp_phone_connections',
      'whatsapp_ingress_receipts',
      'whatsapp_access_credentials',
      'whatsapp_outbound_messages',
      'whatsapp_delivery_receipts'
    )
    ORDER BY name
  `).all<{ name: string }>()
  expect(tables.results.map((row) => row.name)).toEqual([
    'whatsapp_access_credentials',
    'whatsapp_delivery_receipts',
    'whatsapp_ingress_receipts',
    'whatsapp_outbound_messages',
    'whatsapp_phone_connections',
    'whatsapp_waba_accounts',
  ])

  const chatColumns = await db.prepare('PRAGMA table_info(chat_threads)').all<{ name: string }>()
  const chatNames = new Set(chatColumns.results.map((row) => row.name))
  for (const required of ['customer_name', 'intent', 'assigned_staff_key', 'csat_score', 'closed_at_ms', 'context_json']) {
    expect(chatNames.has(required)).toBe(true)
  }

  const columnChecks = [
    ['appointments', 'grooming_machine_no'],
    ['loyalty_points', 'expires_at_ms'],
    ['client_subscriptions', 'legacy_metadata_json'],
    ['support_threads', 'assigned_to'],
    ['support_threads', 'last_message_preview'],
  ] as const
  for (const [table, required] of columnChecks) {
    const columns = await db.prepare(`PRAGMA table_info(${table})`).all<{ name: string }>()
    expect(new Set(columns.results.map((row) => row.name)).has(required)).toBe(true)
  }

  const triggers = await db.prepare(`
    SELECT name FROM sqlite_schema
    WHERE type='trigger' AND name IN (
      'client_subscription_base_usage_capacity_guard',
      'client_subscription_usage_projection_from_base',
      'subscription_usage_projection_after_allocation_insert',
      'subscription_usage_projection_after_allocation_update',
      'subscription_usage_projection_after_allocation_delete',
      'package_allocation_from_late_service_consumption',
      'cash_register_single_open_insert_guard',
      'cash_register_single_open_reopen_guard'
    )
  `).all<{ name: string }>()
  expect(new Set(triggers.results.map((row) => row.name))).toEqual(new Set([
    'client_subscription_base_usage_capacity_guard',
    'client_subscription_usage_projection_from_base',
    'subscription_usage_projection_after_allocation_insert',
    'subscription_usage_projection_after_allocation_update',
    'subscription_usage_projection_after_allocation_delete',
    'package_allocation_from_late_service_consumption',
    'cash_register_single_open_insert_guard',
    'cash_register_single_open_reopen_guard',
  ]))
}

export async function runColdUpgradeV25(
  db: D1Database,
  migrations: Parameters<typeof applyD1Migrations>[1],
) {
  await upgradeHistoricalDatabase(db, migrations, 25)
  await assertV30(db)
}
