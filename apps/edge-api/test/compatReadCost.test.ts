import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'
import { selectRows } from '../src/compatApiRuntime.js'

describe('compatibility D1 read cost', () => {
  it('usa a página padrão quando o navegador envia limit e range nulos', async () => {
    const database = (env as EdgeEnv & { DB: D1Database }).DB
    const tenantId = `page-default-${crypto.randomUUID()}`, now = Date.now()
    await database.prepare("INSERT INTO tenants(id,slug,name,status,created_at_ms,updated_at_ms) VALUES(?1,?1,'Pagination','active',?2,?2)").bind(tenantId, now).run()
    try {
      await database.batch(['a', 'b', 'c'].map(id => database.prepare("INSERT INTO clients(tenant_id,module_id,id,name,status,created_at_ms,updated_at_ms) VALUES(?1,'petshop',?2,?2,'active',?3,?3)").bind(tenantId, id, now)))
      const scope = { tenantId, moduleId: 'petshop' }, config = { read: 'clients' }
      expect((await selectRows(database, 'clients', config, { limit: null, range: null }, scope)).rows).toHaveLength(3)
      expect((await selectRows(database, 'clients', config, { limit: 1, range: null }, scope)).rows).toHaveLength(1)
      expect((await selectRows(database, 'clients', config, { range: { from: 1, to: 2 } }, scope)).rows).toHaveLength(2)
    } finally {
      await database.prepare('DELETE FROM clients WHERE tenant_id=?1').bind(tenantId).run()
      await database.prepare('DELETE FROM tenants WHERE id=?1').bind(tenantId).run()
    }
  })
  it('does not scan for a total unless explicitly requested, including default pagination', async () => {
    const database = (env as EdgeEnv & { DB: D1Database }).DB
    const queries: string[] = []
    const db = { prepare(sql: string) { queries.push(sql); return database.prepare(sql) } }
    const scope = { tenantId: 'cost-test-nonexistent', moduleId: 'petshop' }
    for (const body of [{}, { limit: 5 }, { limit: 5, offset: 10 }]) {
      queries.length = 0
      const result = await selectRows(db, 'clients', { read: 'clients' }, body, scope)
      expect(result.count).toBeNull()
      expect(queries).toHaveLength(1)
      expect(queries[0]).not.toContain('COUNT(*)')
      expect(queries[0]).toContain('LIMIT')
    }
    queries.length = 0
    const result = await selectRows(db, 'clients', { read: 'clients' }, { count: 'exact', limit: 5 }, scope)
    expect(result.count).toBe(0)
    expect(queries.filter(sql => sql.includes('COUNT(*)'))).toHaveLength(1)
  })
})
