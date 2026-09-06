import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'
import { selectRows } from '../src/compatApiRuntime.js'

describe('compatibility D1 read cost', () => {
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
