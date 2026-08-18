import { applyD1Migrations } from 'cloudflare:test'
import { expect } from 'vitest'

type Migration = Parameters<typeof applyD1Migrations>[1][number]

function migrationsFrom(migrations: Parameters<typeof applyD1Migrations>[1], version: number): Migration[] {
  return migrations.filter((migration) => {
    const parsed = Number.parseInt(String(migration.name).split('_', 1)[0], 10)
    return Number.isFinite(parsed) && parsed > version
  })
}

async function resetMigrationHistoryTo(db: D1Database, migrations: Parameters<typeof applyD1Migrations>[1], version: number) {
  await db.prepare("UPDATE _yuisync_system_metadata SET value=?1 WHERE key='schema_version'")
    .bind(String(version))
    .run()

  for (const migration of migrationsFrom(migrations, version)) {
    await db.prepare('DELETE FROM d1_migrations WHERE name=?1')
      .bind(migration.name)
      .run()
  }
}

async function removePostV25Schema(db: D1Database) {
  await db.exec(`
    DROP TRIGGER IF EXISTS cash_register_single_open_insert_guard;
    DROP TRIGGER IF EXISTS cash_register_single_open_reopen_guard;
    DROP VIEW IF EXISTS compat_chat_sessions;
    DROP VIEW IF EXISTS compat_chat_messages;
    ALTER TABLE chat_threads DROP COLUMN context_json;
    ALTER TABLE chat_threads DROP COLUMN closed_at_ms;
    ALTER TABLE chat_threads DROP COLUMN csat_score;
    ALTER TABLE chat_threads DROP COLUMN assigned_staff_key;
    ALTER TABLE chat_threads DROP COLUMN intent;
    ALTER TABLE chat_threads DROP COLUMN customer_name;

    DROP TRIGGER IF EXISTS client_subscription_base_usage_capacity_guard;
    DROP TRIGGER IF EXISTS client_subscription_usage_projection_from_base;
    DROP TRIGGER IF EXISTS subscription_usage_projection_after_allocation_insert;
    DROP TRIGGER IF EXISTS subscription_usage_projection_after_allocation_update;
    DROP TRIGGER IF EXISTS subscription_usage_projection_after_allocation_delete;
    DROP TRIGGER IF EXISTS package_allocation_from_late_service_consumption;

    DROP TABLE IF EXISTS whatsapp_delivery_receipts;
    DROP TABLE IF EXISTS whatsapp_outbound_messages;
    DROP TABLE IF EXISTS whatsapp_access_credentials;
    DROP TABLE IF EXISTS whatsapp_ingress_receipts;
    DROP TABLE IF EXISTS whatsapp_phone_connections;
    DROP TABLE IF EXISTS whatsapp_waba_accounts;
  `)
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
  await removePostV25Schema(db)
  await resetMigrationHistoryTo(db, migrations, 25)

  const before = await db.prepare("SELECT value FROM _yuisync_system_metadata WHERE key='schema_version'")
    .first<{ value: string }>()
  expect(before?.value).toBe('25')

  await applyD1Migrations(db, migrationsFrom(migrations, 25))
  await assertV30(db)
}
