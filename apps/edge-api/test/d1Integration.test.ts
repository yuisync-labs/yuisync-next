import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'

import { D1ReadOnlyAdapter } from '../src/adapters/d1ReadOnly'

const testEnv = env as EdgeEnv & { DB: D1Database }

describe('D1 integration in workerd', () => {
  it('aplica todas as migrations no banco isolado de testes', async () => {
    const row = await testEnv.DB.prepare('SELECT value FROM _yuisync_system_metadata WHERE key = ?')
      .bind('schema_version').first<{ value: string }>()
    expect(row).toEqual({ value: '20' })

    const required = [
      'clients','pets','catalog_products','services','inventory_balances','inventory_movements',
      'module_operational_settings','appointments','appointment_services','transport_options','appointment_transport',
      'sales','sale_items','payments','payment_splits','financial_effects','chat_threads','chat_messages',
      'operation_checkpoints','operation_effects','fiscal_documents','effect_outbox',
    ]
    const tables = await testEnv.DB.prepare(`SELECT name FROM sqlite_schema WHERE type='table' ORDER BY name`)
      .all<{ name: string }>()
    const actual = new Set(tables.results.map((table) => table.name))
    for (const name of required) expect(actual.has(name), `missing table ${name}`).toBe(true)

    const membershipColumns = await testEnv.DB.prepare(`PRAGMA table_info(tenant_memberships)`).all<{ name:string }>()
    const membershipColumnNames = new Set(membershipColumns.results.map((column)=>column.name))
    expect(membershipColumnNames.has('role')).toBe(true)
    expect(membershipColumnNames.has('module_permissions_json')).toBe(true)
  })

  it('executa o canário pelo binding D1 real do ambiente de teste', async () => {
    const adapter = new D1ReadOnlyAdapter({ database: testEnv.DB })
    await expect(adapter.checkCanary({ requestId: 'request-d1-workerd', timeoutMs: 1_000 }))
      .resolves.toMatchObject({ status: 'ready', readOnly: true })
  })
})
