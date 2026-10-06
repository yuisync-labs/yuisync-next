import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'
import { reservePendingOrderStock } from '../src/pendingOrderStockReservation'

const db=(env as EdgeEnv & {DB:D1Database}).DB
describe('native received-payment settlement — real local D1',()=>{
  it('refuses unpaid/authorized/partial payment, settles once and cannot reopen',async()=>{
    const tenant='stock-settlement-fixture',now=Date.now()
    await db.batch([
      db.prepare(`INSERT INTO tenants(id,slug,name,status,created_at_ms,updated_at_ms) VALUES(?1,?1,'Fixture','active',?2,?2)`).bind(tenant,now),
      db.prepare(`INSERT INTO catalog_products(tenant_id,module_id,id,name,price_cents,status,created_at_ms,updated_at_ms) VALUES(?1,'petshop','product','Produto',9000,'active',?2,?2)`).bind(tenant,now),
      db.prepare(`INSERT INTO inventory_balances(tenant_id,module_id,product_id,on_hand_milliunits,reserved_milliunits,reorder_milliunits,version,updated_at_ms) VALUES(?1,'petshop','product',2000,0,0,1,?2)`).bind(tenant,now),
      db.prepare(`INSERT INTO sales(tenant_id,module_id,id,operation_key,source,fulfillment_type,subtotal_cents,total_cents,status,created_at_ms,updated_at_ms) VALUES(?1,'petshop','sale','sale','whatsapp','counter',9000,9000,'pending',?2,?2)`).bind(tenant,now),
      db.prepare(`INSERT INTO sale_items(tenant_id,module_id,sale_id,position,item_type,product_id,item_name,quantity_milliunits,unit_price_cents,subtotal_cents) VALUES(?1,'petshop','sale',0,'product','product','Produto',1000,9000,9000)`).bind(tenant),
      reservePendingOrderStock(db,{tenantId:tenant,moduleId:'petshop',saleId:'sale',productId:'product',quantityMilliunits:1000,unitPriceCents:9000,now}),
    ])
    const complete=()=>db.prepare(`UPDATE sales SET status='completed',updated_at_ms=?2 WHERE tenant_id=?1 AND id='sale'`).bind(tenant,now+1).run()
    const balances=()=>db.prepare(`SELECT on_hand_milliunits,reserved_milliunits FROM inventory_balances WHERE tenant_id=?1`).bind(tenant).first()
    await expect(complete()).rejects.toThrow('PENDING_ORDER_PAYMENT_NOT_RECEIVED')
    await db.prepare(`INSERT INTO payments(tenant_id,module_id,id,sale_id,operation_key,method,amount_cents,status,created_at_ms,updated_at_ms) VALUES(?1,'petshop','pay','sale','pay','pix',9000,'authorized',?2,?2)`).bind(tenant,now).run()
    await expect(complete()).rejects.toThrow('PENDING_ORDER_PAYMENT_NOT_RECEIVED')
    await db.prepare(`UPDATE payments SET status='received',amount_cents=4500,received_at_ms=?2 WHERE tenant_id=?1`).bind(tenant,now).run()
    await expect(complete()).rejects.toThrow('PENDING_ORDER_PAYMENT_NOT_RECEIVED')
    expect(await balances()).toEqual({on_hand_milliunits:2000,reserved_milliunits:1000})
    await db.prepare(`UPDATE payments SET amount_cents=9000 WHERE tenant_id=?1`).bind(tenant).run()
    await complete()
    await complete()
    expect(await balances()).toEqual({on_hand_milliunits:1000,reserved_milliunits:0})
    expect(await db.prepare(`SELECT delta_milliunits,stock_before_milliunits,stock_after_milliunits FROM inventory_movements WHERE tenant_id=?1`).bind(tenant).all()).toMatchObject({results:[{delta_milliunits:-1000,stock_before_milliunits:2000,stock_after_milliunits:1000}]})
    expect(await db.prepare(`SELECT COUNT(*) AS count FROM pending_order_stock_settlements WHERE tenant_id=?1`).bind(tenant).first()).toEqual({count:1})
    expect(await db.prepare(`SELECT COUNT(*) AS count FROM payments WHERE tenant_id=?1`).bind(tenant).first()).toEqual({count:1})
    await expect(db.prepare(`UPDATE sales SET status='pending' WHERE tenant_id=?1`).bind(tenant).run()).rejects.toThrow('PENDING_ORDER_ALREADY_SETTLED')
    expect((await db.prepare(`PRAGMA foreign_key_check`).all()).results).toEqual([])
  })
})
