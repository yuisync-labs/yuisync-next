import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'

import { adjustInventoryStock } from '../src/inventoryAdjustment'

const db = (env as EdgeEnv & { DB: D1Database }).DB

async function seedInventory() {
  const suffix = crypto.randomUUID()
  const tenantId = `inventory-${suffix}`
  const productId = `product-${suffix}`
  const now = Date.now()

  await db.batch([
    db.prepare("INSERT INTO tenants(id,slug,name,status,created_at_ms,updated_at_ms) VALUES(?1,?2,'Inventory Test','active',?3,?3)")
      .bind(tenantId, `inventory-${suffix}`, now),
    db.prepare(`
      INSERT INTO catalog_products(
        tenant_id,module_id,id,name,price_cents,cost_cents,status,created_at_ms,updated_at_ms
      ) VALUES(?1,'petshop',?2,'Produto Teste',1000,500,'active',?3,?3)
    `).bind(tenantId, productId, now),
    db.prepare(`
      INSERT INTO inventory_balances(
        tenant_id,module_id,product_id,on_hand_milliunits,reserved_milliunits,reorder_milliunits,version,updated_at_ms
      ) VALUES(?1,'petshop',?2,10000,2000,1000,1,?3)
    `).bind(tenantId, productId, now),
  ])

  return { tenantId, productId }
}

async function cleanup(tenantId: string) {
  await db.prepare("DELETE FROM inventory_movements WHERE tenant_id=?1 AND module_id='petshop'").bind(tenantId).run()
  await db.prepare("DELETE FROM inventory_balances WHERE tenant_id=?1 AND module_id='petshop'").bind(tenantId).run()
  await db.prepare("DELETE FROM catalog_products WHERE tenant_id=?1 AND module_id='petshop'").bind(tenantId).run()
  await db.prepare('DELETE FROM tenants WHERE id=?1').bind(tenantId).run()
}

describe('atomic inventory adjustment', () => {
  it('applies a delta and records the exact before/after movement', async () => {
    const seeded = await seedInventory()
    try {
      const result = await adjustInventoryStock(db, {
        tenantId: seeded.tenantId,
        moduleId: 'petshop',
        productId: seeded.productId,
        deltaUnits: 3,
        operationKey: `adjust:${seeded.productId}`,
        movementType: 'adjustment',
        reason: 'test',
      })

      expect(result).toMatchObject({ stock_before: 10, stock_after: 13, delta: 3, duplicated: false })

      const balance = await db.prepare(`
        SELECT on_hand_milliunits,reserved_milliunits,version
        FROM inventory_balances
        WHERE tenant_id=?1 AND module_id='petshop' AND product_id=?2
      `).bind(seeded.tenantId, seeded.productId).first<{
        on_hand_milliunits: number
        reserved_milliunits: number
        version: number
      }>()
      expect(balance).toEqual({ on_hand_milliunits: 13000, reserved_milliunits: 2000, version: 2 })

      const movement = await db.prepare(`
        SELECT movement_type,delta_milliunits,stock_before_milliunits,stock_after_milliunits
        FROM inventory_movements
        WHERE tenant_id=?1 AND module_id='petshop' AND operation_key=?2
      `).bind(seeded.tenantId, `adjust:${seeded.productId}`).first<{
        movement_type: string
        delta_milliunits: number
        stock_before_milliunits: number
        stock_after_milliunits: number
      }>()
      expect(movement).toEqual({
        movement_type: 'adjustment',
        delta_milliunits: 3000,
        stock_before_milliunits: 10000,
        stock_after_milliunits: 13000,
      })
    } finally {
      await cleanup(seeded.tenantId)
    }
  })

  it('is idempotent for the same operation key and delta', async () => {
    const seeded = await seedInventory()
    const operationKey = `purchase:${seeded.productId}`
    try {
      const first = await adjustInventoryStock(db, {
        tenantId: seeded.tenantId,
        moduleId: 'petshop',
        productId: seeded.productId,
        deltaUnits: 2.5,
        operationKey,
        movementType: 'purchase',
      })
      const duplicate = await adjustInventoryStock(db, {
        tenantId: seeded.tenantId,
        moduleId: 'petshop',
        productId: seeded.productId,
        deltaUnits: 2.5,
        operationKey,
        movementType: 'purchase',
      })

      expect(first.stock_after).toBe(12.5)
      expect(duplicate).toMatchObject({ stock_before: 10, stock_after: 12.5, delta: 2.5, duplicated: true })

      const count = await db.prepare(`
        SELECT COUNT(*) AS count FROM inventory_movements
        WHERE tenant_id=?1 AND module_id='petshop' AND operation_key=?2
      `).bind(seeded.tenantId, operationKey).first<{ count: number }>()
      expect(Number(count?.count || 0)).toBe(1)
    } finally {
      await cleanup(seeded.tenantId)
    }
  })

  it('rejects an adjustment below reserved stock without changing the balance', async () => {
    const seeded = await seedInventory()
    try {
      await expect(adjustInventoryStock(db, {
        tenantId: seeded.tenantId,
        moduleId: 'petshop',
        productId: seeded.productId,
        deltaUnits: -9,
        operationKey: `invalid:${seeded.productId}`,
        movementType: 'adjustment',
      })).rejects.toMatchObject({ code: 'INSUFFICIENT_AVAILABLE_STOCK', status: 409 })

      const balance = await db.prepare(`
        SELECT on_hand_milliunits,reserved_milliunits,version
        FROM inventory_balances
        WHERE tenant_id=?1 AND module_id='petshop' AND product_id=?2
      `).bind(seeded.tenantId, seeded.productId).first<{
        on_hand_milliunits: number
        reserved_milliunits: number
        version: number
      }>()
      expect(balance).toEqual({ on_hand_milliunits: 10000, reserved_milliunits: 2000, version: 1 })

      const count = await db.prepare(`
        SELECT COUNT(*) AS count FROM inventory_movements
        WHERE tenant_id=?1 AND module_id='petshop' AND operation_key=?2
      `).bind(seeded.tenantId, `invalid:${seeded.productId}`).first<{ count: number }>()
      expect(Number(count?.count || 0)).toBe(0)
    } finally {
      await cleanup(seeded.tenantId)
    }
  })
})
