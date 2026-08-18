import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'

import {
  AdminMaintenanceError,
  resetChatHistoryForScope,
  resetStockForScope,
} from '../src/adminMaintenance'

const db = (env as EdgeEnv & { DB: D1Database }).DB

async function seedTenant(prefix: string) {
  const suffix = crypto.randomUUID()
  const tenantId = `${prefix}-${suffix}`
  const now = Date.now()
  await db.prepare("INSERT INTO tenants(id,slug,name,status,created_at_ms,updated_at_ms) VALUES(?1,?2,?3,'active',?4,?4)")
    .bind(tenantId, `${prefix}-${suffix}`, `${prefix} test`, now).run()
  return { tenantId, now }
}

async function cleanupTenant(tenantId: string) {
  await db.prepare("DELETE FROM operation_effects WHERE tenant_id=?1 AND module_id='petshop'").bind(tenantId).run()
  await db.prepare("DELETE FROM operation_checkpoints WHERE tenant_id=?1 AND module_id='petshop'").bind(tenantId).run()
  await db.prepare("DELETE FROM chat_messages WHERE tenant_id=?1 AND module_id='petshop'").bind(tenantId).run()
  await db.prepare("DELETE FROM chat_threads WHERE tenant_id=?1 AND module_id='petshop'").bind(tenantId).run()
  await db.prepare("DELETE FROM inventory_movements WHERE tenant_id=?1 AND module_id='petshop'").bind(tenantId).run()
  await db.prepare("DELETE FROM inventory_balances WHERE tenant_id=?1 AND module_id='petshop'").bind(tenantId).run()
  await db.prepare("DELETE FROM catalog_products WHERE tenant_id=?1 AND module_id='petshop'").bind(tenantId).run()
  await db.prepare('DELETE FROM tenants WHERE id=?1').bind(tenantId).run()
}

describe('admin maintenance integrity', () => {
  it('resets chat state in dependency order and removes operation effects with the checkpoint', async () => {
    const { tenantId, now } = await seedTenant('chat-reset')
    const threadId = `thread-${crypto.randomUUID()}`
    const checkpointId = `checkpoint-${crypto.randomUUID()}`
    try {
      await db.batch([
        db.prepare(`
          INSERT INTO chat_threads(
            tenant_id,module_id,id,channel,status,created_at_ms,updated_at_ms
          ) VALUES(?1,'petshop',?2,'internal','open',?3,?3)
        `).bind(tenantId, threadId, now),
        db.prepare(`
          INSERT INTO chat_messages(
            tenant_id,module_id,id,thread_id,direction,actor_type,content_text,created_at_ms
          ) VALUES(?1,'petshop',?2,?3,'inbound','customer','oi',?4)
        `).bind(tenantId, `message-${crypto.randomUUID()}`, threadId, now),
        db.prepare(`
          INSERT INTO operation_checkpoints(
            tenant_id,module_id,id,thread_id,operation_type,stage,facts_json,confirmations_json,status,version,updated_at_ms
          ) VALUES(?1,'petshop',?2,?3,'bath_booking','collecting','{}','[]','running',1,?4)
        `).bind(tenantId, checkpointId, threadId, now),
        db.prepare(`
          INSERT INTO operation_effects(
            tenant_id,module_id,operation_id,effect_key,effect_type,payload_json,status,attempt_count,created_at_ms,updated_at_ms
          ) VALUES(?1,'petshop',?2,'effect-1','test','{}','pending',0,?3,?3)
        `).bind(tenantId, checkpointId, now),
      ])

      const result = await resetChatHistoryForScope(db, { tenantId, moduleId: 'petshop' })
      expect(result).toEqual({ threads_deleted: 1, messages_deleted: 1, checkpoints_deleted: 1 })

      for (const table of ['chat_threads', 'chat_messages', 'operation_checkpoints', 'operation_effects']) {
        const row = await db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE tenant_id=?1 AND module_id='petshop'`)
          .bind(tenantId).first<{ count: number }>()
        expect(Number(row?.count || 0), table).toBe(0)
      }
    } finally {
      await cleanupTenant(tenantId)
    }
  })

  it('zeros unreserved stock and records an auditable adjustment movement', async () => {
    const { tenantId, now } = await seedTenant('stock-reset')
    const productId = `product-${crypto.randomUUID()}`
    try {
      await db.batch([
        db.prepare(`
          INSERT INTO catalog_products(
            tenant_id,module_id,id,name,price_cents,cost_cents,status,created_at_ms,updated_at_ms
          ) VALUES(?1,'petshop',?2,'Produto',1000,500,'active',?3,?3)
        `).bind(tenantId, productId, now),
        db.prepare(`
          INSERT INTO inventory_balances(
            tenant_id,module_id,product_id,on_hand_milliunits,reserved_milliunits,reorder_milliunits,version,updated_at_ms
          ) VALUES(?1,'petshop',?2,7500,0,1000,1,?3)
        `).bind(tenantId, productId, now),
      ])

      const result = await resetStockForScope(db, { tenantId, moduleId: 'petshop' })
      expect(result).toEqual({ products_reset: 1 })

      const balance = await db.prepare(`
        SELECT on_hand_milliunits,reserved_milliunits,version
        FROM inventory_balances
        WHERE tenant_id=?1 AND module_id='petshop' AND product_id=?2
      `).bind(tenantId, productId).first<{
        on_hand_milliunits: number; reserved_milliunits: number; version: number
      }>()
      expect(balance).toEqual({ on_hand_milliunits: 0, reserved_milliunits: 0, version: 2 })

      const movement = await db.prepare(`
        SELECT movement_type,delta_milliunits,stock_before_milliunits,stock_after_milliunits,reason
        FROM inventory_movements
        WHERE tenant_id=?1 AND module_id='petshop' AND product_id=?2
      `).bind(tenantId, productId).first<{
        movement_type: string; delta_milliunits: number; stock_before_milliunits: number; stock_after_milliunits: number; reason: string
      }>()
      expect(movement).toEqual({
        movement_type: 'adjustment',
        delta_milliunits: -7500,
        stock_before_milliunits: 7500,
        stock_after_milliunits: 0,
        reason: 'Zeragem administrativa de estoque',
      })
    } finally {
      await cleanupTenant(tenantId)
    }
  })

  it('blocks the whole stock reset while any reservation exists', async () => {
    const { tenantId, now } = await seedTenant('stock-reserved')
    const productId = `product-${crypto.randomUUID()}`
    try {
      await db.batch([
        db.prepare(`
          INSERT INTO catalog_products(
            tenant_id,module_id,id,name,price_cents,cost_cents,status,created_at_ms,updated_at_ms
          ) VALUES(?1,'petshop',?2,'Produto reservado',1000,500,'active',?3,?3)
        `).bind(tenantId, productId, now),
        db.prepare(`
          INSERT INTO inventory_balances(
            tenant_id,module_id,product_id,on_hand_milliunits,reserved_milliunits,reorder_milliunits,version,updated_at_ms
          ) VALUES(?1,'petshop',?2,5000,1000,1000,1,?3)
        `).bind(tenantId, productId, now),
      ])

      let caught: unknown = null
      try {
        await resetStockForScope(db, { tenantId, moduleId: 'petshop' })
      } catch (error) {
        caught = error
      }
      expect(caught).toBeInstanceOf(AdminMaintenanceError)
      expect(caught).toMatchObject({ code: 'STOCK_RESET_BLOCKED_BY_RESERVATIONS', status: 409 })

      const balance = await db.prepare(`
        SELECT on_hand_milliunits,reserved_milliunits,version
        FROM inventory_balances
        WHERE tenant_id=?1 AND module_id='petshop' AND product_id=?2
      `).bind(tenantId, productId).first<{
        on_hand_milliunits: number; reserved_milliunits: number; version: number
      }>()
      expect(balance).toEqual({ on_hand_milliunits: 5000, reserved_milliunits: 1000, version: 1 })
    } finally {
      await cleanupTenant(tenantId)
    }
  })
})
