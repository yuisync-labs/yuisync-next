import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'

const db = (env as EdgeEnv & { DB: D1Database }).DB

describe('operational integrity v25 package ledger', () => {
  it('derives package capacity from allocations across reserve, consume, reopen and cancel', async () => {
    const suffix = crypto.randomUUID()
    const tenantId = `v25-tenant-${suffix}`
    const clientId = `v25-client-${suffix}`
    const petId = `v25-pet-${suffix}`
    const serviceId = `v25-service-${suffix}`
    const serviceCode = `bath-v25-${suffix}`
    const planId = `v25-plan-${suffix}`
    const subscriptionId = `v25-sub-${suffix}`
    const firstAppointmentId = `v25-appt-a-${suffix}`
    const secondAppointmentId = `v25-appt-b-${suffix}`
    const now = Date.now()

    await db.batch([
      db.prepare("INSERT INTO tenants(id,slug,name,status,created_at_ms,updated_at_ms) VALUES(?1,?2,'V25 Ledger Tenant','active',?3,?3)").bind(tenantId,`v25-${suffix}`,now),
      db.prepare("INSERT INTO clients(tenant_id,module_id,id,name,status,created_at_ms,updated_at_ms) VALUES(?1,'petshop',?2,'Tutor V25','active',?3,?3)").bind(tenantId,clientId,now),
      db.prepare("INSERT INTO pets(tenant_id,module_id,id,client_id,name,species,weight_kg,status,created_at_ms,updated_at_ms) VALUES(?1,'petshop',?2,?3,'Pet V25','dog',8,'active',?4,?4)").bind(tenantId,petId,clientId,now),
      db.prepare(`INSERT INTO services(tenant_id,module_id,id,code,name,group_type,default_price_cents,default_duration_min,commission_type,commission_basis_points,sort_order,status,created_at_ms,updated_at_ms,min_weight_kg,max_weight_kg,species_target,min_weight_grams,max_weight_grams) VALUES(?1,'petshop',?2,?3,'Banho V25','banho_tosa',5500,60,'percentage',500,1,'active',?4,?4,0,10.099,'dog',0,10099)`).bind(tenantId,serviceId,serviceCode,now),
      db.prepare(`INSERT INTO subscription_plans(tenant_id,module_id,id,name,price_cents,billing_cycle,services_json,status,created_at_ms,updated_at_ms) VALUES(?1,'petshop',?2,'Plano V25',5500,'monthly',?3,'active',?4,?4)`).bind(tenantId,planId,JSON.stringify([{service_type:serviceCode,qty_per_cycle:1}]),now),
      db.prepare(`INSERT INTO client_subscriptions(tenant_id,module_id,id,plan_id,client_id,status,started_at_ms,next_billing_date,services_used_json,cancelled_at_ms,created_at_ms,updated_at_ms,benefit_ledger_base_used_json) VALUES(?1,'petshop',?2,?3,?4,'active',?5,'2026-09-13','{}',NULL,?5,?5,'{}')`).bind(tenantId,subscriptionId,planId,clientId,now),
      db.prepare(`INSERT INTO appointments(tenant_id,module_id,id,client_id,pet_id,scheduled_at_ms,duration_min,service_group,status,source,subtotal_cents,transport_fee_cents,notes,version,created_at_ms,updated_at_ms,subscription_id,subscription_benefit_used,subscription_benefit_status,subscription_benefits_json,subscription_label,subscription_discount_cents,billing_intent_type,billing_intent_subscription_id) VALUES(?1,'petshop',?2,?3,?4,?5,60,'banho_tosa','scheduled','manual',5500,0,NULL,1,?6,?6,?7,1,'reserved',?8,'Plano V25',5500,'subscription',?7)`).bind(tenantId,firstAppointmentId,clientId,petId,now+3600000,now,subscriptionId,JSON.stringify([{kind:'service',service_code:serviceCode,status:'reserved'}])),
      db.prepare(`INSERT INTO appointment_services(tenant_id,module_id,appointment_id,position,service_id,service_code,service_name,service_group,unit_price_cents,duration_min,benefit_used,catalog_price_cents,commission_basis_points,min_weight_kg,max_weight_kg,species_target,min_weight_grams,max_weight_grams) VALUES(?1,'petshop',?2,0,?3,?4,'Banho V25','banho_tosa',5500,60,1,5500,500,0,10.099,'dog',0,10099)`).bind(tenantId,firstAppointmentId,serviceId,serviceCode),
      db.prepare(`INSERT INTO appointments(tenant_id,module_id,id,client_id,pet_id,scheduled_at_ms,duration_min,service_group,status,source,subtotal_cents,transport_fee_cents,notes,version,created_at_ms,updated_at_ms,billing_intent_type) VALUES(?1,'petshop',?2,?3,?4,?5,60,'banho_tosa','scheduled','manual',5500,0,NULL,1,?6,?6,'auto')`).bind(tenantId,secondAppointmentId,clientId,petId,now+7200000,now),
    ])

    try {
      await db.prepare(`INSERT INTO subscription_benefit_allocations(tenant_id,module_id,id,subscription_id,appointment_id,appointment_service_position,benefit_kind,benefit_key,service_code,state,operation_key,catalog_price_cents,version,reserved_at_ms,consumed_at_ms,released_at_ms,created_at_ms,updated_at_ms) VALUES(?1,'petshop',?2,?3,?4,0,'service',?5,?5,'reserved',?6,5500,1,?7,NULL,NULL,?7,?7)`).bind(tenantId,`allocation-a-${suffix}`,subscriptionId,firstAppointmentId,serviceCode,`alloc-a-${suffix}`,now).run()

      await expect(db.prepare(`INSERT INTO subscription_benefit_allocations(tenant_id,module_id,id,subscription_id,appointment_id,appointment_service_position,benefit_kind,benefit_key,service_code,state,operation_key,catalog_price_cents,version,reserved_at_ms,consumed_at_ms,released_at_ms,created_at_ms,updated_at_ms) VALUES(?1,'petshop',?2,?3,?4,0,'service',?5,?5,'reserved',?6,5500,1,?7,NULL,NULL,?7,?7)`).bind(tenantId,`allocation-b-${suffix}`,subscriptionId,secondAppointmentId,serviceCode,`alloc-b-${suffix}`,now).run()).rejects.toThrow(/PACKAGE_BENEFIT_CAPACITY_EXCEEDED/)

      const completeAt=now+1000
      await db.prepare(`UPDATE appointments SET status='completed',subscription_benefit_status='consumed',updated_at_ms=?4,version=version+1 WHERE tenant_id=?1 AND module_id='petshop' AND id=?2 AND subscription_id=?3`).bind(tenantId,firstAppointmentId,subscriptionId,completeAt).run()
      const consumed=await db.prepare(`SELECT state,consumed_at_ms FROM subscription_benefit_allocations WHERE tenant_id=?1 AND module_id='petshop' AND appointment_id=?2`).bind(tenantId,firstAppointmentId).first<{state:string;consumed_at_ms:number}>()
      expect(consumed).toMatchObject({state:'consumed',consumed_at_ms:completeAt})

      const reopenAt=now+2000
      await db.prepare(`UPDATE appointments SET status='scheduled',subscription_id=NULL,subscription_benefit_status='released',updated_at_ms=?3,version=version+1 WHERE tenant_id=?1 AND module_id='petshop' AND id=?2`).bind(tenantId,firstAppointmentId,reopenAt).run()
      const released=await db.prepare(`SELECT state,released_at_ms FROM subscription_benefit_allocations WHERE tenant_id=?1 AND module_id='petshop' AND appointment_id=?2`).bind(tenantId,firstAppointmentId).first<{state:string;released_at_ms:number}>()
      expect(released).toMatchObject({state:'released',released_at_ms:reopenAt})

      await db.prepare(`INSERT INTO subscription_benefit_allocations(tenant_id,module_id,id,subscription_id,appointment_id,appointment_service_position,benefit_kind,benefit_key,service_code,state,operation_key,catalog_price_cents,version,reserved_at_ms,consumed_at_ms,released_at_ms,created_at_ms,updated_at_ms) VALUES(?1,'petshop',?2,?3,?4,0,'service',?5,?5,'reserved',?6,5500,1,?7,NULL,NULL,?7,?7)`).bind(tenantId,`allocation-b-${suffix}`,subscriptionId,secondAppointmentId,serviceCode,`alloc-b-${suffix}`,now+3000).run()
      await db.prepare(`UPDATE appointments SET status='cancelled',updated_at_ms=?3,version=version+1 WHERE tenant_id=?1 AND module_id='petshop' AND id=?2`).bind(tenantId,secondAppointmentId,now+4000).run()
      const cancelled=await db.prepare(`SELECT state FROM subscription_benefit_allocations WHERE tenant_id=?1 AND module_id='petshop' AND appointment_id=?2`).bind(tenantId,secondAppointmentId).first<{state:string}>()
      expect(cancelled?.state).toBe('released')
    } finally {
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
  })
})