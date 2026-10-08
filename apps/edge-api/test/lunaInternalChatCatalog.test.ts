import { env } from 'cloudflare:workers'
import { beforeAll, describe, expect, it } from 'vitest'
import { searchInternalChatProducts } from '../src/internalChatApi'

const db = (env as EdgeEnv & { DB: D1Database }).DB
const tenantId = 'native-catalog-' + crypto.randomUUID()
const otherTenantId = 'native-catalog-other-' + crypto.randomUUID()

beforeAll(async () => {
  const now = Date.now()
  const tenant = (id: string) => db.prepare(`INSERT INTO tenants
    (id,slug,name,status,created_at_ms,updated_at_ms) VALUES (?1,?1,'Chat Catalog Test','active',?2,?2)`).bind(id, now)
  const product = (tenant: string, id: string, status = 'active') =>
    db.prepare(`INSERT INTO catalog_products
      (tenant_id,module_id,id,name,price_cents,status,created_at_ms,updated_at_ms)
      VALUES (?1,'petshop',?2,'Ração Teste',12990,?3,?4,?4)`).bind(tenant, id, status, now)
  const balance = (id: string, onHand: number, reserved: number) =>
    db.prepare(`INSERT INTO inventory_balances
      (tenant_id,module_id,product_id,on_hand_milliunits,reserved_milliunits,reorder_milliunits,version,updated_at_ms)
      VALUES (?1,'petshop',?2,?3,?4,0,1,?5)`).bind(tenantId, id, onHand, reserved, now)
  await db.batch([
    tenant(tenantId), tenant(otherTenantId),
    product(tenantId, 'partial'), product(tenantId, 'fully-reserved'),
    product(tenantId, 'no-balance'), product(tenantId, 'disabled', 'inactive'),
    product(otherTenantId, 'foreign'),
    balance('partial', 5000, 3000),
    balance('fully-reserved', 1000, 1000),
    balance('disabled', 2000, 0),
  ])
})

describe('Luna native D1 catalog lookup', () => {
  it('counts only available units after subtracting reservations', async () => {
    const results = await searchInternalChatProducts(db, tenantId, 'petshop', 'Ração')
    expect(results).toHaveLength(3)
    const partial = results.find(item => item.id === 'partial')
    expect(partial).toEqual({
      id: 'partial',
      name: 'Ração Teste',
      price_reais: 129.9,
      stock_quantity: 2,
    })
    expect(results.find(item => item.id === 'fully-reserved')?.stock_quantity).toBe(0)
    expect(results.find(item => item.id === 'no-balance')?.stock_quantity).toBe(0)
  })

  it('does not expose another tenant, module or inactive products', async () => {
    const results = await searchInternalChatProducts(db, tenantId, 'petshop', 'Ração')
    expect(results.map(row => row.id).sort()).toEqual(['fully-reserved', 'no-balance', 'partial'])
    expect(await searchInternalChatProducts(db, tenantId, 'other', 'Ração')).toEqual([])
    const foreign = await searchInternalChatProducts(db, otherTenantId, 'petshop', 'Ração')
    expect(foreign.map(row => row.id)).toEqual(['foreign'])
  })
})
