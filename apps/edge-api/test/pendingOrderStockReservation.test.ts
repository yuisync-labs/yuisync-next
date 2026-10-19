import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'
import { reservePendingOrderStock } from '../src/pendingOrderStockReservation'

const db = (env as EdgeEnv & {DB:D1Database}).DB
describe('native pending-order reservation — real local D1 transaction',()=>{
  it('disputa pela última unidade: uma venda, uma reserva, zero pagamento/baixa física',async()=>{
    const tenant='pending-order-last-unit',now=Date.now()
    await db.batch([
      db.prepare(`INSERT INTO tenants(id,slug,name,status,created_at_ms,updated_at_ms) VALUES(?1,?1,'Reserva fictícia','active',?2,?2)`).bind(tenant,now),
      db.prepare(`INSERT INTO catalog_products(tenant_id,module_id,id,name,price_cents,status,created_at_ms,updated_at_ms) VALUES(?1,'petshop','product','Produto',9000,'active',?2,?2)`).bind(tenant,now),
      db.prepare(`INSERT INTO inventory_balances(tenant_id,module_id,product_id,on_hand_milliunits,reserved_milliunits,reorder_milliunits,version,updated_at_ms) VALUES(?1,'petshop','product',1000,0,0,1,?2)`).bind(tenant,now),
    ])
    const write=(saleId:string,price=9000)=>db.batch([
      db.prepare(`INSERT INTO sales(tenant_id,module_id,id,operation_key,source,fulfillment_type,subtotal_cents,discount_cents,transport_fee_cents,total_cents,status,created_at_ms,updated_at_ms) VALUES(?1,'petshop',?2,?2,'whatsapp','counter',?3,0,0,?3,'pending',?4,?4)`).bind(tenant,saleId,price,now),
      reservePendingOrderStock(db,{tenantId:tenant,moduleId:'petshop',saleId,productId:'product',quantityMilliunits:1000,unitPriceCents:price,now}),
    ])
    const outcomes=await Promise.allSettled([write('first'),write('second')])
    expect(outcomes.filter(r=>r.status==='fulfilled')).toHaveLength(1)
    expect(outcomes.filter(r=>r.status==='rejected')).toHaveLength(1)
    expect(String((outcomes.find(r=>r.status==='rejected') as PromiseRejectedResult).reason)).toContain('PENDING_ORDER_STOCK_CHANGED')
    const sale=await db.prepare('SELECT id FROM sales WHERE tenant_id=?1').bind(tenant).all<{id:string}>()
    expect(sale.results).toHaveLength(1)
    expect(await db.prepare('SELECT on_hand_milliunits,reserved_milliunits FROM inventory_balances WHERE tenant_id=?1').bind(tenant).first()).toEqual({on_hand_milliunits:1000,reserved_milliunits:1000})
    for(const table of ['payments','inventory_movements'])expect(await db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE tenant_id=?1`).bind(tenant).first()).toEqual({count:0})
    // Cancellation releases the actual domain reservation, never adds stock.
    await db.prepare(`UPDATE sales SET status='cancelled' WHERE tenant_id=?1 AND id=?2`).bind(tenant,sale.results[0].id).run()
    expect(await db.prepare('SELECT on_hand_milliunits,reserved_milliunits FROM inventory_balances WHERE tenant_id=?1').bind(tenant).first()).toEqual({on_hand_milliunits:1000,reserved_milliunits:0})
    // A price change between read and batch must also roll back the sale.
    await db.prepare(`UPDATE catalog_products SET price_cents=10000 WHERE tenant_id=?1`).bind(tenant).run()
    await expect(write('stale-price')).rejects.toThrow('PENDING_ORDER_STOCK_CHANGED')
    expect(await db.prepare(`SELECT id FROM sales WHERE tenant_id=?1 AND id='stale-price'`).bind(tenant).first()).toBeNull()
    await write('new-price',10000)
    expect(await db.prepare('SELECT COUNT(*) AS count FROM pending_order_stock_reservations WHERE tenant_id=?1').bind(tenant).first()).toEqual({count:1})
    await db.prepare(`DELETE FROM sales WHERE tenant_id=?1 AND id='new-price'`).bind(tenant).run()
    expect(await db.prepare('SELECT on_hand_milliunits,reserved_milliunits FROM inventory_balances WHERE tenant_id=?1').bind(tenant).first()).toEqual({on_hand_milliunits:1000,reserved_milliunits:0})
  })
})
