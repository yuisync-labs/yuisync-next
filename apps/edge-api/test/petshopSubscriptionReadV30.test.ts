import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'

import { PETSHOP_SUBSCRIPTION_LIST_SQL } from '../src/petshopPlansApi'

const db = (env as EdgeEnv & { DB: D1Database }).DB

describe('PetShop subscription reads on schema v30', () => {
  it('compiles against the canonical clients table without phantom legacy columns', async () => {
    const columns = await db.prepare('PRAGMA table_info(clients)').all<{ name: string }>()
    const names = new Set(columns.results.map((row) => row.name))

    expect(names.has('details_json')).toBe(false)
    expect(names.has('address')).toBe(true)
    expect(names.has('neighborhood')).toBe(true)
    expect(names.has('city')).toBe(true)

    const rows = await db.prepare(PETSHOP_SUBSCRIPTION_LIST_SQL)
      .bind(`missing-${crypto.randomUUID()}`, 'petshop')
      .all()

    expect(rows.results).toEqual([])
  })
})
