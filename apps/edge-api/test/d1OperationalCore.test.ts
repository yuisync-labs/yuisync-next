import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'

const db = (env as EdgeEnv & { DB: D1Database }).DB
const now = 1_000

async function seed(tenantId: string) {
  await db.prepare(`INSERT INTO tenants(id,slug,name,status,created_at_ms,updated_at_ms) VALUES(?,?,?,'active',?,?)`)
    .bind(tenantId, tenantId, tenantId, now, now).run()
  await db.prepare(`INSERT INTO clients(tenant_id,module_id,id,name,status,created_at_ms,updated_at_ms) VALUES(?,'petshop','client','Tutor','active',?,?)`)
    .bind(tenantId, now, now).run()
  await db.prepare(`INSERT INTO pets(tenant_id,module_id,id,client_id,name,species,status,created_at_ms,updated_at_ms) VALUES(?,'petshop','pet','client','Thor','dog','active',?,?)`)
    .bind(tenantId, now, now).run()
  await db.prepare(`INSERT INTO catalog_products(tenant_id,module_id,id,name,price_cents,cost_cents,status,created_at_ms,updated_at_ms) VALUES(?,'petshop','product','Racao',1000,500,'active',?,?)`)
    .bind(tenantId, now, now).run()
  await db.prepare(`INSERT INTO services(tenant_id,module_id,id,code,name,group_type,default_price_cents,default_duration_min,commission_type,commission_basis_points,status,created_at_ms,updated_at_ms) VALUES(?,'petshop','service','banho','Banho','banho_tosa',5500,60,'percentage',0,'active',?,?)`)
    .bind(tenantId, now, now).run()
}

async function appointment(tenantId: string) {
  return db.prepare(`INSERT INTO appointments(tenant_id,module_id,id,client_id,pet_id,scheduled_at_ms,duration_min,status,source,subtotal_cents,transport_fee_cents,version,created_at_ms,updated_at_ms) VALUES(?,'petshop','appt','client','pet',100000,60,'scheduled','manual',5500,0,1,?,?)`)
    .bind(tenantId, now, now).run()
}

async function sale(tenantId: string) {
  return db.prepare(`INSERT INTO sales(tenant_id,module_id,id,operation_key,client_id,source,fulfillment_type,subtotal_cents,discount_cents,transport_fee_cents,total_cents,status,created_at_ms,updated_at_ms) VALUES(?,'petshop','sale','sale-op','client','manual','counter',1000,0,0,1000,'completed',?,?)`)
    .bind(tenantId, now, now).run()
}

describe('operational core invariants', () => {
  it('inventory keeps fractional milliunits exact and rejects negative balance', async () => {
    const t = 'tenant-inventory'; await seed(t)
    await db.prepare(`INSERT INTO inventory_balances(tenant_id,module_id,product_id,on_hand_milliunits,reserved_milliunits,reorder_milliunits,version,updated_at_ms) VALUES(?,'petshop','product',1250,250,500,1,?)`).bind(t, now).run()
    await expect(db.prepare(`INSERT INTO inventory_movements(tenant_id,module_id,id,operation_key,product_id,movement_type,delta_milliunits,stock_before_milliunits,stock_after_milliunits,created_at_ms) VALUES(?,'petshop','m1','op1','product','sale',-500,1250,750,?)`).bind(t, now).run()).resolves.toMatchObject({ success: true })
    await expect(db.prepare(`UPDATE inventory_balances SET on_hand_milliunits=-1 WHERE tenant_id=? AND module_id='petshop' AND product_id='product'`).bind(t).run()).rejects.toThrow()
  })

  it('inventory operation_key is idempotency-unique inside scope', async () => {
    const t = 'tenant-inventory-key'; await seed(t)
    const sql = `INSERT INTO inventory_movements(tenant_id,module_id,id,operation_key,product_id,movement_type,delta_milliunits,stock_before_milliunits,stock_after_milliunits,created_at_ms) VALUES(?,'petshop',?,'same-op','product','purchase',100,0,100,?)`
    await db.prepare(sql).bind(t, 'm1', now).run()
    await expect(db.prepare(sql).bind(t, 'm2', now).run()).rejects.toThrow()
  })

  it('operational config is typed instead of a settings God-row', async () => {
    const t = 'tenant-config'; await seed(t)
    await expect(db.prepare(`INSERT INTO module_operational_settings(tenant_id,module_id,timezone,booking_horizon_days,minimum_lead_minutes,default_duration_minutes,max_services_per_appointment,autonomy_mode,version,updated_at_ms) VALUES(?,'petshop','America/Sao_Paulo',90,0,60,10,'autonomous',1,?)`).bind(t, now).run()).resolves.toMatchObject({ success: true })
    await expect(db.prepare(`INSERT INTO booking_hours(tenant_id,module_id,weekday,opens_minute,closes_minute,active) VALUES(?,'petshop',1,900,800,1)`).bind(t).run()).rejects.toThrow()
  })

  it('appointment service snapshots are tied to the same scoped service', async () => {
    const t = 'tenant-agenda'; await seed(t); await appointment(t)
    await expect(db.prepare(`INSERT INTO appointment_services(tenant_id,module_id,appointment_id,position,service_id,service_code,service_name,service_group,unit_price_cents,duration_min,benefit_used) VALUES(?,'petshop','appt',0,'service','banho','Banho','banho_tosa',5500,60,0)`).bind(t).run()).resolves.toMatchObject({ success: true })
  })

  it('motodog transport is attached to one real appointment', async () => {
    const t = 'tenant-motodog'; await seed(t); await appointment(t)
    await db.prepare(`INSERT INTO transport_options(tenant_id,module_id,id,label,fee_cents,max_weight_grams,pickup_required,dropoff_required,outside_city,status,sort_order) VALUES(?,'petshop','buscar_e_levar','Buscar e levar',2000,10000,1,1,0,'active',1)`).bind(t).run()
    await expect(db.prepare(`INSERT INTO appointment_transport(tenant_id,module_id,appointment_id,option_id,fee_cents,status,updated_at_ms) VALUES(?,'petshop','appt','buscar_e_levar',2000,'scheduled',?)`).bind(t, now).run()).resolves.toMatchObject({ success: true })
  })

  it('sale totals and product/service item XOR are enforced', async () => {
    const t = 'tenant-sale'; await seed(t); await sale(t)
    await expect(db.prepare(`INSERT INTO sale_items(tenant_id,module_id,sale_id,position,item_type,product_id,item_name,quantity_milliunits,unit_price_cents,subtotal_cents,upsell) VALUES(?,'petshop','sale',0,'product','product','Racao',1000,1000,1000,0)`).bind(t).run()).resolves.toMatchObject({ success: true })
    await expect(db.prepare(`INSERT INTO sale_items(tenant_id,module_id,sale_id,position,item_type,product_id,service_id,item_name,quantity_milliunits,unit_price_cents,subtotal_cents,upsell) VALUES(?,'petshop','sale',1,'product','product','service','Bad',1000,1000,1000,0)`).bind(t).run()).rejects.toThrow()
  })

  it('payment and financial effect idempotency keys cannot duplicate', async () => {
    const t = 'tenant-payment'; await seed(t); await sale(t)
    const sql = `INSERT INTO payments(tenant_id,module_id,id,sale_id,operation_key,method,amount_cents,status,created_at_ms,updated_at_ms) VALUES(?,'petshop',?,'sale','pay-op','pix',1000,'pending',?,?)`
    await db.prepare(sql).bind(t, 'pay1', now, now).run()
    await expect(db.prepare(sql).bind(t, 'pay2', now, now).run()).rejects.toThrow()
    await db.prepare(`INSERT INTO financial_effects(tenant_id,module_id,operation_key,effect_type,aggregate_id,status,attempt_count,updated_at_ms) VALUES(?,'petshop','effect-op','payment_capture','pay1','pending',0,?)`).bind(t, now).run()
    await expect(db.prepare(`INSERT INTO financial_effects(tenant_id,module_id,operation_key,effect_type,aggregate_id,status,attempt_count,updated_at_ms) VALUES(?,'petshop','effect-op','payment_capture','pay1','pending',0,?)`).bind(t, now).run()).rejects.toThrow()
  })
})