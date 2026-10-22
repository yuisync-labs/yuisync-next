import { env } from 'cloudflare:workers'
import type { applyD1Migrations } from 'cloudflare:test'
import { upgradeHistoricalDatabase } from './d1ColdUpgradeV25Harness'
import { describe, expect, it } from 'vitest'

type TestEnv = EdgeEnv & {
  MIGRATION_V25: D1Database
  MIGRATION_V26: D1Database
  MIGRATION_V27: D1Database
  MIGRATION_V28: D1Database
  MIGRATION_V29: D1Database
  TEST_MIGRATIONS: Parameters<typeof applyD1Migrations>[1]
}

const testEnv = env as TestEnv

async function assertLatestSchema(db: D1Database) {
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
  it.each([29, 28, 27, 26, 25] as const)('upgrades a fresh v%i database through all current migrations', async (version) => {
    const db = testEnv[`MIGRATION_V${version}`]
    await upgradeHistoricalDatabase(db, testEnv.TEST_MIGRATIONS, version)
    await assertLatestSchema(db)
  }, 30_000)
})
