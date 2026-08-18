import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'

const db = (env as EdgeEnv & { DB: D1Database }).DB

async function seed() {
  const suffix = crypto.randomUUID()
  const tenantId = `ledger29-${suffix}`
  const clientId = `client-${suffix}`
  const petId = `pet-${suffix}`
  const planId = `plan-${suffix}`
  const subscriptionId = `sub-${suffix}`
  const serviceId = `service-${suffix}`
  const serviceCode = `banho-${suffix}`
  const consumedAppointmentId = `consumed-${suffix}`
  const reservedAppointmentId = `reserved-${suffix}`
  const lateAppointmentId = `late-${suffix}`
  const now = Date.now()

  await db.batch([
    db.prepare("INSERT INTO tenants(id,slug,name,status,created_at_ms,updated_at_ms) VALUES(?1,?2,'Ledger V29','active',?3,?3)")
      .bind(tenantId, `ledger29-${suffix}`, now),
    db.prepare("INSERT INTO clients(tenant_id,module_id,id,name,status,created_at_ms,updated_at_ms) VALUES(?1,'petshop',?2,'Tutor Ledger','active',?3,?3)")
      .bind(tenantId, clientId, now),
    db.prepare("INSERT INTO pets(tenant_id,module_id,id,client_id,name,species,weight_kg,status,created_at_ms,updated_at_ms) VALUES(?1,'petshop',?2,?3,'Pet Ledger','dog',8,'active',?4,?4)")
      .bind(tenantId, petId, clientId, now),
    db.prepare(`INSERT INTO services(
      tenant_id,module_id,id,code,name,group_type,default_price_cents,default_duration_min,
      commission_type,commission_basis_points,sort_order,status,created_at_ms,updated_at_ms,
      min_weight_kg,max_weight_kg,species_target,min_weight_grams,max_weight_grams
    ) VALUES(?1,'petshop',?2,?3,'Banho Ledger','banho_tosa',5500,60,'percentage',500,1,'active',?4,?4,0,10.099,'dog',0,10099)`)
      .bind(tenantId, serviceId, serviceCode, now),
    db.prepare(`INSERT INTO subscription_plans(
      tenant_id,module_id,id,name,price_cents,billing_cycle,services_json,status,created_at_ms,updated_at_ms
    ) VALUES(?1,'petshop',?2,'Plano Ledger',10000,'monthly',?3,'active',?4,?4)`)
      .bind(tenantId, planId, JSON.stringify([{ service_type: serviceCode, qty_per_cycle: 4 }]), now),
    db.prepare(`INSERT INTO client_subscriptions(
      tenant_id,module_id,id,plan_id,client_id,status,started_at_ms,next_billing_date,
      services_used_json,cancelled_at_ms,created_at_ms,updated_at_ms,benefit_ledger_base_used_json
    ) VALUES(?1,'petshop',?2,?3,?4,'active',?5,'2026-09-18',?6,NULL,?5,?5,?6)`)
      .bind(tenantId, subscriptionId, planId, clientId, now, JSON.stringify({ [serviceCode]: 2 })),
    db.prepare(`INSERT INTO appointments(
      tenant_id,module_id,id,client_id,pet_id,scheduled_at_ms,duration_min,service_group,status,source,
      subtotal_cents,transport_fee_cents,notes,version,created_at_ms,updated_at_ms,
      subscription_id,subscription_benefit_used,subscription_benefit_status,subscription_benefits_json,
      subscription_label,subscription_discount_cents,billing_intent_type,billing_intent_subscription_id
    ) VALUES(?1,'petshop',?2,?3,?4,?5,60,'banho_tosa','completed','manual',5500,0,NULL,1,?6,?6,
      ?7,1,'consumed',?8,'Plano Ledger',5500,'subscription',?7)`)
      .bind(tenantId, consumedAppointmentId, clientId, petId, now - 1000, now, subscriptionId, JSON.stringify([{ kind: 'service', service_code: serviceCode, status: 'consumed' }])),
    db.prepare(`INSERT INTO appointments(
      tenant_id,module_id,id,client_id,pet_id,scheduled_at_ms,duration_min,service_group,status,source,
      subtotal_cents,transport_fee_cents,notes,version,created_at_ms,updated_at_ms,
      subscription_id,subscription_benefit_used,subscription_benefit_status,subscription_benefits_json,
      subscription_label,subscription_discount_cents,billing_intent_type,billing_intent_subscription_id
    ) VALUES(?1,'petshop',?2,?3,?4,?5,60,'banho_tosa','scheduled','manual',5500,0,NULL,1,?6,?6,
      ?7,1,'reserved',?8,'Plano Ledger',5500,'subscription',?7)`)
      .bind(tenantId, reservedAppointmentId, clientId, petId, now + 3600000, now, subscriptionId, JSON.stringify([{ kind: 'service', service_code: serviceCode, status: 'reserved' }])),
    db.prepare(`INSERT INTO appointment_services(
      tenant_id,module_id,appointment_id,position,service_id,service_code,service_name,service_group,
      unit_price_cents,duration_min,benefit_used,catalog_price_cents,commission_basis_points,
      min_weight_kg,max_weight_kg,species_target,min_weight_grams,max_weight_grams
    ) VALUES(?1,'petshop',?2,0,?3,?4,'Banho Ledger','banho_tosa',5500,60,1,5500,500,0,10.099,'dog',0,10099)`)
      .bind(tenantId, consumedAppointmentId, serviceId, serviceCode),
    db.prepare(`INSERT INTO appointment_services(
      tenant_id,module_id,appointment_id,position,service_id,service_code,service_name,service_group,
      unit_price_cents,duration_min,benefit_used,catalog_price_cents,commission_basis_points,
      min_weight_kg,max_weight_kg,species_target,min_weight_grams,max_weight_grams
    ) VALUES(?1,'petshop',?2,0,?3,?4,'Banho Ledger','banho_tosa',5500,60,1,5500,500,0,10.099,'dog',0,10099)`)
      .bind(tenantId, reservedAppointmentId, serviceId, serviceCode),
    db.prepare(`INSERT INTO subscription_benefit_allocations(
      tenant_id,module_id,id,subscription_id,appointment_id,appointment_service_position,
      benefit_kind,benefit_key,service_code,state,operation_key,catalog_price_cents,
      version,reserved_at_ms,consumed_at_ms,released_at_ms,created_at_ms,updated_at_ms
    ) VALUES(?1,'petshop',?2,?3,?4,0,'service',?5,?5,'consumed',?6,5500,1,NULL,?7,NULL,?7,?7)`)
      .bind(tenantId, `consumed-alloc-${suffix}`, subscriptionId, consumedAppointmentId, serviceCode, `consumed-op-${suffix}`, now),
    db.prepare(`INSERT INTO subscription_benefit_allocations(
      tenant_id,module_id,id,subscription_id,appointment_id,appointment_service_position,
      benefit_kind,benefit_key,service_code,state,operation_key,catalog_price_cents,
      version,reserved_at_ms,consumed_at_ms,released_at_ms,created_at_ms,updated_at_ms
    ) VALUES(?1,'petshop',?2,?3,?4,0,'service',?5,?5,'reserved',?6,5500,1,?7,NULL,NULL,?7,?7)`)
      .bind(tenantId, `reserved-alloc-${suffix}`, subscriptionId, reservedAppointmentId, serviceCode, `reserved-op-${suffix}`, now),
  ])

  return { suffix, tenantId, clientId, petId, planId, subscriptionId, serviceId, serviceCode, lateAppointmentId, now }
}

async function cleanup(tenantId: string) {
  await db.prepare("DELETE FROM subscription_benefit_allocations WHERE tenant_id=?1 AND module_id='petshop'").bind(tenantId).run()
  await db.prepare("DELETE FROM appointment_services WHERE tenant_id=?1 AND module_id='petshop'").bind(tenantId).run()
  await db.prepare("DELETE FROM appointments WHERE tenant_id=?1 AND module_id='petshop'").bind(tenantId).run()
  await db.prepare("DELETE FROM client_subscriptions WHERE tenant_id=?1 AND module_id='petshop'").bind(tenantId).run()
  await db.prepare("DELETE FROM subscription_plans WHERE tenant_id=?1 AND module_id='petshop'").bind(tenantId).run()
  await db.prepare("DELETE FROM services WHERE tenant_id=?1 AND module_id='petshop'").bind(tenantId).run()
  await db.prepare("DELETE FROM pets WHERE tenant_id=?1 AND module_id='petshop'").bind(tenantId).run()
  await db.prepare("DELETE FROM clients WHERE tenant_id=?1 AND module_id='petshop'").bind(tenantId).run()
  await db.prepare('DELETE FROM tenants WHERE id=?1').bind(tenantId).run()
}

describe('package usage ledger v29', () => {
  it('projects manual base + consumed allocations and rejects base that collides with a real reservation', async () => {
    const seeded = await seed()
    try {
      const projected = await db.prepare(`SELECT services_used_json,benefit_ledger_base_used_json FROM client_subscriptions WHERE tenant_id=?1 AND module_id='petshop' AND id=?2`)
        .bind(seeded.tenantId, seeded.subscriptionId)
        .first<{ services_used_json: string; benefit_ledger_base_used_json: string }>()
      expect(JSON.parse(projected?.benefit_ledger_base_used_json || '{}')[seeded.serviceCode]).toBe(2)
      expect(JSON.parse(projected?.services_used_json || '{}')[seeded.serviceCode]).toBe(3)

      await expect(db.prepare(`
        UPDATE client_subscriptions
        SET benefit_ledger_base_used_json=?3
        WHERE tenant_id=?1 AND module_id='petshop' AND id=?2
      `).bind(seeded.tenantId, seeded.subscriptionId, JSON.stringify({ [seeded.serviceCode]: 3 })).run())
        .rejects.toThrow(/PACKAGE_USAGE_RESERVED_CONFLICT/)

      const after = await db.prepare(`SELECT services_used_json,benefit_ledger_base_used_json FROM client_subscriptions WHERE tenant_id=?1 AND module_id='petshop' AND id=?2`)
        .bind(seeded.tenantId, seeded.subscriptionId)
        .first<{ services_used_json: string; benefit_ledger_base_used_json: string }>()
      expect(JSON.parse(after?.benefit_ledger_base_used_json || '{}')[seeded.serviceCode]).toBe(2)
      expect(JSON.parse(after?.services_used_json || '{}')[seeded.serviceCode]).toBe(3)
    } finally {
      await cleanup(seeded.tenantId)
    }
  })

  it('creates the canonical consumed allocation when coverage is marked on a service after appointment completion', async () => {
    const seeded = await seed()
    try {
      await db.prepare(`
        UPDATE subscription_benefit_allocations
        SET state='released',released_at_ms=?3,updated_at_ms=?3
        WHERE tenant_id=?1 AND subscription_id=?2 AND state='reserved'
      `).bind(seeded.tenantId, seeded.subscriptionId, seeded.now + 100).run()

      await db.prepare(`INSERT INTO appointments(
        tenant_id,module_id,id,client_id,pet_id,scheduled_at_ms,duration_min,service_group,status,source,
        subtotal_cents,transport_fee_cents,notes,version,created_at_ms,updated_at_ms,
        subscription_id,subscription_benefit_used,subscription_benefit_status,subscription_benefits_json,
        subscription_label,subscription_discount_cents,billing_intent_type,billing_intent_subscription_id
      ) VALUES(?1,'petshop',?2,?3,?4,?5,60,'banho_tosa','completed','manual',5500,0,NULL,1,?6,?6,
        ?7,1,'consumed',?8,'Plano Ledger',5500,'subscription',?7)`)
        .bind(seeded.tenantId, seeded.lateAppointmentId, seeded.clientId, seeded.petId, seeded.now + 7200000, seeded.now, seeded.subscriptionId, JSON.stringify([{ kind: 'service', service_code: seeded.serviceCode, status: 'consumed' }]))
        .run()
      await db.prepare(`INSERT INTO appointment_services(
        tenant_id,module_id,appointment_id,position,service_id,service_code,service_name,service_group,
        unit_price_cents,duration_min,benefit_used,catalog_price_cents,commission_basis_points,
        min_weight_kg,max_weight_kg,species_target,min_weight_grams,max_weight_grams
      ) VALUES(?1,'petshop',?2,0,?3,?4,'Banho Ledger','banho_tosa',5500,60,0,5500,500,0,10.099,'dog',0,10099)`)
        .bind(seeded.tenantId, seeded.lateAppointmentId, seeded.serviceId, seeded.serviceCode)
        .run()

      await db.prepare(`UPDATE appointment_services SET benefit_used=1 WHERE tenant_id=?1 AND module_id='petshop' AND appointment_id=?2 AND position=0`)
        .bind(seeded.tenantId, seeded.lateAppointmentId)
        .run()

      const allocation = await db.prepare(`SELECT state,benefit_key FROM subscription_benefit_allocations WHERE tenant_id=?1 AND module_id='petshop' AND appointment_id=?2 AND appointment_service_position=0`)
        .bind(seeded.tenantId, seeded.lateAppointmentId)
        .first<{ state: string; benefit_key: string }>()
      expect(allocation).toEqual({ state: 'consumed', benefit_key: seeded.serviceCode })

      const projected = await db.prepare(`SELECT services_used_json FROM client_subscriptions WHERE tenant_id=?1 AND module_id='petshop' AND id=?2`)
        .bind(seeded.tenantId, seeded.subscriptionId)
        .first<{ services_used_json: string }>()
      expect(JSON.parse(projected?.services_used_json || '{}')[seeded.serviceCode]).toBe(4)
    } finally {
      await cleanup(seeded.tenantId)
    }
  })
})
