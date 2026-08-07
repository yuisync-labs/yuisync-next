import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'

import { D1ReadOnlyAdapter } from '../src/adapters/d1ReadOnly'

const testEnv = env as EdgeEnv & { DB: D1Database }

describe('D1 integration in workerd', () => {
  it('aplica todas as migrations no banco isolado de testes', async () => {
    const row = await testEnv.DB
      .prepare('SELECT value FROM _yuisync_system_metadata WHERE key = ?')
      .bind('schema_version')
      .first<{ value: string }>()

    expect(row).toEqual({ value: '3' })

    const tables = await testEnv.DB
      .prepare(`
        SELECT name
        FROM sqlite_schema
        WHERE type = 'table'
          AND name IN (
            '_yuisync_event_processing',
            'tenants',
            'identity_principals',
            'tenant_memberships'
          )
        ORDER BY name
      `)
      .all<{ name: string }>()

    expect(tables.results.map((table) => table.name)).toEqual([
      '_yuisync_event_processing',
      'identity_principals',
      'tenant_memberships',
      'tenants',
    ])
  })

  it('executa o canário pelo binding D1 real do ambiente de teste', async () => {
    const adapter = new D1ReadOnlyAdapter({ database: testEnv.DB })

    await expect(adapter.checkCanary({
      requestId: 'request-d1-workerd',
      timeoutMs: 1_000,
    })).resolves.toMatchObject({
      status: 'ready',
      readOnly: true,
    })
  })
})
