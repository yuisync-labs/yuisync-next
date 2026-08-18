import { env } from 'cloudflare:workers'
import { applyD1Migrations } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'

type Migration = Parameters<typeof applyD1Migrations>[1][number]
type TestEnv = EdgeEnv & {
  DB: D1Database
  TEST_MIGRATIONS: Parameters<typeof applyD1Migrations>[1]
}

const testEnv = env as TestEnv
const db = testEnv.DB

function migrationsFrom(version: number): Migration[] {
  return testEnv.TEST_MIGRATIONS.filter((migration) => {
    const parsed = Number.parseInt(String(migration.name).split('_', 1)[0], 10)
    return Number.isFinite(parsed) && parsed > version
  })
}

async function setSchemaSnapshot(version: number) {
  await db.prepare("UPDATE _yuisync_system_metadata SET value=?1 WHERE key='schema_version'")
    .bind(String(version))
    .run()

  for (const migration of migrationsFrom(version)) {
    await db.prepare('DELETE FROM d1_migrations WHERE name=?1')
      .bind(migration.name)
      .run()
  }
}

async function dropVersion30() {
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
  `)
}

async function dropVersion29() {
  await dropVersion30()
  await db.exec(`
    DROP TRIGGER IF EXISTS client_subscription_base_usage_capacity_guard;
    DROP TRIGGER IF EXISTS client_subscription_usage_projection_from_base;
    DROP TRIGGER IF EXISTS subscription_usage_projection_after_allocation_insert;
    DROP TRIGGER IF EXISTS subscription_usage_projection_after_allocation_update;
    DROP TRIGGER IF EXISTS subscription_usage_projection_after_allocation_delete;
    DROP TRIGGER IF EXISTS package_allocation_from_late_service_consumption;
  `)
}

async function dropVersion28() {
  await dropVersion29()
  await db.exec(`
    DROP TABLE IF EXISTS whatsapp_delivery_receipts;
    DROP TABLE IF EXISTS whatsapp_outbound_messages;
  `)
}

async function dropVersion27() {
  await dropVersion28()
  await db.exec('DROP TABLE IF EXISTS whatsapp_access_credentials;')
}

async function dropVersion26() {
  await dropVersion27()
  await db.exec(`
    DROP TABLE IF EXISTS whatsapp_ingress_receipts;
    DROP TABLE IF EXISTS whatsapp_phone_connections;
    DROP TABLE IF EXISTS whatsapp_waba_accounts;
  `)
}

async function assertLatestSchema() {
  const version = await db.prepare("SELECT value FROM _yuisync_system_metadata WHERE key='schema_version'")
    .first<{ value: string }>()
  expect(version?.value).toBe('30')

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

  const outboundColumns = await db.prepare('PRAGMA table_info(whatsapp_outbound_messages)').all<{ name: string }>()
  const names = new Set(outboundColumns.results.map((row) => row.name))
  for (const required of ['idempotency_key', 'internal_message_id', 'provider_message_id', 'status', 'last_provider_status_at_ms']) {
    expect(names.has(required)).toBe(true)
  }

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

  const indexes = await db.prepare(`
    SELECT name FROM sqlite_schema
    WHERE type='index' AND name IN (
      'whatsapp_access_credentials_phone_idx',
      'whatsapp_outbound_internal_message_unique',
      'whatsapp_outbound_provider_message_unique',
      'whatsapp_outbound_phone_status_idx',
      'whatsapp_delivery_receipts_message_idx'
    )
  `).all<{ name: string }>()
  expect(new Set(indexes.results.map((row) => row.name))).toEqual(new Set([
    'whatsapp_access_credentials_phone_idx',
    'whatsapp_outbound_internal_message_unique',
    'whatsapp_outbound_provider_message_unique',
    'whatsapp_outbound_phone_status_idx',
    'whatsapp_delivery_receipts_message_idx',
  ]))
}

describe('D1 recent migration upgrade matrix', () => {
  it('upgrades v29, v28, v27, v26 and v25 snapshots to v30 using the repository migrations', async () => {
    await dropVersion30()
    await setSchemaSnapshot(29)
    await applyD1Migrations(db, migrationsFrom(29))
    await assertLatestSchema()

    await dropVersion29()
    await setSchemaSnapshot(28)
    await applyD1Migrations(db, migrationsFrom(28))
    await assertLatestSchema()

    await dropVersion28()
    await setSchemaSnapshot(27)
    await applyD1Migrations(db, migrationsFrom(27))
    await assertLatestSchema()

    await dropVersion27()
    await setSchemaSnapshot(26)
    await applyD1Migrations(db, migrationsFrom(26))
    await assertLatestSchema()

    await dropVersion26()
    await setSchemaSnapshot(25)
    await applyD1Migrations(db, migrationsFrom(25))
    await assertLatestSchema()
  })
})
