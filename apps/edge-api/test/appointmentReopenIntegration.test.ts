import { env } from 'cloudflare:workers'
import { hash } from 'bcryptjs'
import { describe, expect, it } from 'vitest'

import { handleBetterAuthRequest } from '../src/auth/betterAuthRuntime'
import { handleCompatApiRequest } from '../src/compatApi'

const AUTH_SECRET = 'appointment-reopen-test-secret-123456789012345678901'

function bindings() {
  return {
    ...(env as EdgeEnv),
    APP_ENV: 'staging',
    EDGE_BETTER_AUTH_ENABLED: 'true',
    BETTER_AUTH_SECRET: AUTH_SECRET,
    AUTH_DB: (env as EdgeEnv & { AUTH_DB: D1Database }).AUTH_DB,
    DB: (env as EdgeEnv & { DB: D1Database }).DB,
  }
}

async function signIn(email: string, password: string): Promise<string> {
  const response = await handleBetterAuthRequest(new Request('https://edge.test/api/auth/sign-in/email', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: 'https://edge.test',
    },
    body: JSON.stringify({ email, password, rememberMe: false }),
  }), bindings())
  expect(response).not.toBeNull()
  expect(response?.status).toBe(200)
  return response?.headers.get('set-cookie')?.split(';')[0] || ''
}

async function updateAppointment(
  cookie: string,
  tenantId: string,
  appointmentId: string,
  payload: Record<string, unknown>,
): Promise<Response> {
  const response = await handleCompatApiRequest(new Request('https://edge.test/api/compat/rpc', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      cookie,
      'x-tenant-id': tenantId,
      'x-module-id': 'petshop',
    },
    body: JSON.stringify({
      name: 'update_petshop_appointment_transaction',
      args: {
        p_appointment_id: appointmentId,
        p_payload: payload,
      },
    }),
  }), bindings())
  expect(response).not.toBeNull()
  return response as Response
}

describe('completed appointment reopen policy in workerd', () => {
  it('atomically releases package usage and blocks paid-sale reopens', async () => {
    const authDb = (env as EdgeEnv & { AUTH_DB: D1Database }).AUTH_DB
    const db = (env as EdgeEnv & { DB: D1Database }).DB
    const suffix = crypto.randomUUID()
    const tenantId = `tenant-reopen-${suffix}`
    const userId = `reopen-user-${suffix}`
    const principalId = `reopen-principal-${suffix}`
    const clientId = `reopen-client-${suffix}`
    const petId = `reopen-pet-${suffix}`
    const serviceId = `reopen-service-${suffix}`
    const serviceCode = `bath-reopen-${suffix}`
    const planId = `reopen-plan-${suffix}`
    const subscriptionId = `reopen-subscription-${suffix}`
    const packageAppointmentId = `reopen-package-${suffix}`
    const paidAppointmentId = `reopen-paid-${suffix}`
    const saleId = `reopen-sale-${suffix}`
    const paymentId = `reopen-payment-${suffix}`
    const email = `reopen-${suffix}@test.invalid`
    const password = 'ValidPassword123!'
    const passwordHash = await hash(password, 12)
    const now = Date.now()
    const nowIso = new Date(now).toISOString()
    const scheduledAt = Date.parse('2026-08-20T13:00:00.000Z')
    const benefitSnapshot = JSON.stringify([{
      kind: 'service',
      key: serviceCode,
      service_code: serviceCode,
      label: 'Banho pequeno',
      catalog_price: 55,
      status: 'consumed',
    }])

    await authDb.batch([
      authDb.prepare('INSERT INTO user(id,name,email,emailVerified,image,createdAt,updatedAt) VALUES(?1,?2,?3,1,NULL,?4,?4)')
        .bind(userId, 'Appointment Reopen Test', email, nowIso),
      authDb.prepare('INSERT INTO account(id,userId,accountId,providerId,password,createdAt,updatedAt) VALUES(?1,?2,?3,?4,?5,?6,?6)')
        .bind(`credential:${userId}`, userId, userId, 'credential', passwordHash, nowIso),
    ])

    await db.batch([
      db.prepare("INSERT INTO tenants(id,slug,name,status,created_at_ms,updated_at_ms) VALUES(?1,?2,'Reopen Tenant','active',?3,?3)")
        .bind(tenantId, `reopen-${suffix}`, now),
      db.prepare("INSERT INTO identity_principals(id,provider,subject,display_name,email,status,created_at_ms,updated_at_ms) VALUES(?1,'better-auth',?2,'Appointment Reopen Test',?3,'active',?4,?4)")
        .bind(principalId, userId, email, now),
      db.prepare("INSERT INTO tenant_memberships(tenant_id,principal_id,status,created_at_ms,updated_at_ms,role,module_permissions_json) VALUES(?1,?2,'active',?3,?3,'staff',?4)")
        .bind(tenantId, principalId, now, JSON.stringify({ petshop: { role: 'funcionario_pet' } })),
      db.prepare("INSERT INTO clients(tenant_id,module_id,id,name,status,created_at_ms,updated_at_ms) VALUES(?1,'petshop',?2,'Tutor Teste','active',?3,?3)")
        .bind(tenantId, clientId, now),
      db.prepare("INSERT INTO pets(tenant_id,module_id,id,client_id,name,species,weight_kg,status,created_at_ms,updated_at_ms) VALUES(?1,'petshop',?2,?3,'Mel','dog',8,'active',?4,?4)")
        .bind(tenantId, petId, clientId, now),
      db.prepare(`INSERT INTO services(
        tenant_id,module_id,id,code,name,group_type,default_price_cents,default_duration_min,
        commission_type,commission_basis_points,sort_order,status,created_at_ms,updated_at_ms,
        min_weight_kg,max_weight_kg,species_target
      ) VALUES(?1,'petshop',?2,?3,'Banho pequeno','banho_tosa',5500,60,'percentage',500,1,'active',?4,?4,0,10,'dog')`)
        .bind(tenantId, serviceId, serviceCode, now),
      db.prepare(`INSERT INTO subscription_plans(
        tenant_id,module_id,id,name,price_cents,billing_cycle,services_json,status,created_at_ms,updated_at_ms
      ) VALUES(?1,'petshop',?2,'Plano Banho',10000,'monthly',?3,'active',?4,?4)`)
        .bind(tenantId, planId, JSON.stringify([{ service_type: serviceCode, qty_per_cycle: 4 }]), now),
      db.prepare(`INSERT INTO client_subscriptions(
        tenant_id,module_id,id,plan_id,client_id,status,started_at_ms,next_billing_date,
        services_used_json,cancelled_at_ms,created_at_ms,updated_at_ms
      ) VALUES(?1,'petshop',?2,?3,?4,'active',?5,'2026-09-20',?6,NULL,?5,?5)`)
        .bind(tenantId, subscriptionId, planId, clientId, now, JSON.stringify({ [serviceCode]: 1 })),
      db.prepare(`INSERT INTO appointments(
        tenant_id,module_id,id,client_id,pet_id,scheduled_at_ms,duration_min,service_group,status,source,
        subtotal_cents,transport_fee_cents,notes,version,created_at_ms,updated_at_ms,
        subscription_id,subscription_benefit_used,subscription_benefit_status,subscription_benefits_json,
        subscription_label,subscription_discount_cents,live_status,checkin_at_ms,ready_at_ms
      ) VALUES(?1,'petshop',?2,?3,?4,?5,60,'banho_tosa','completed','manual',5500,0,NULL,1,?6,?6,
        ?7,1,'consumed',?8,'Plano Banho',5500,'pronto',?6,?6)`)
        .bind(tenantId, packageAppointmentId, clientId, petId, scheduledAt, now, subscriptionId, benefitSnapshot),
      db.prepare(`INSERT INTO appointment_services(
        tenant_id,module_id,appointment_id,position,service_id,service_code,service_name,service_group,
        unit_price_cents,duration_min,benefit_used,catalog_price_cents,commission_basis_points,
        min_weight_kg,max_weight_kg,species_target
      ) VALUES(?1,'petshop',?2,0,?3,?4,'Banho pequeno','banho_tosa',5500,60,1,5500,500,0,10,'dog')`)
        .bind(tenantId, packageAppointmentId, serviceId, serviceCode),
      db.prepare(`INSERT INTO appointments(
        tenant_id,module_id,id,client_id,pet_id,scheduled_at_ms,duration_min,service_group,status,source,
        subtotal_cents,transport_fee_cents,notes,version,created_at_ms,updated_at_ms
      ) VALUES(?1,'petshop',?2,?3,?4,?5,60,'banho_tosa','completed','manual',5500,0,NULL,1,?6,?6)`)
        .bind(tenantId, paidAppointmentId, clientId, petId, scheduledAt + 3600000, now),
      db.prepare(`INSERT INTO appointment_services(
        tenant_id,module_id,appointment_id,position,service_id,service_code,service_name,service_group,
        unit_price_cents,duration_min,benefit_used,catalog_price_cents,commission_basis_points,
        min_weight_kg,max_weight_kg,species_target
      ) VALUES(?1,'petshop',?2,0,?3,?4,'Banho pequeno','banho_tosa',5500,60,0,5500,500,0,10,'dog')`)
        .bind(tenantId, paidAppointmentId, serviceId, serviceCode),
      db.prepare(`INSERT INTO sales(
        tenant_id,module_id,id,operation_key,client_id,appointment_id,source,fulfillment_type,
        subtotal_cents,discount_cents,transport_fee_cents,total_cents,status,notes,created_at_ms,updated_at_ms
      ) VALUES(?1,'petshop',?2,?3,?4,?5,'pos','service',5500,0,0,5500,'completed',NULL,?6,?6)`)
        .bind(tenantId, saleId, `reopen-sale-op-${suffix}`, clientId, paidAppointmentId, now),
      db.prepare(`INSERT INTO payments(
        tenant_id,module_id,id,sale_id,operation_key,method,amount_cents,status,provider,provider_reference,
        received_at_ms,created_at_ms,updated_at_ms
      ) VALUES(?1,'petshop',?2,?3,?4,'pix',5500,'received',NULL,NULL,?5,?5,?5)`)
        .bind(tenantId, paymentId, saleId, `reopen-payment-op-${suffix}`, now),
    ])

    try {
      const cookie = await signIn(email, password)
      const payload = {
        tenant_id: tenantId,
        module_id: 'petshop',
        client_id: clientId,
        pet_id: petId,
        service_type: serviceCode,
        service_group: 'banho_tosa',
        service_items: [{
          id: serviceId,
          service_id: serviceId,
          code: serviceCode,
          name: 'Banho pequeno',
          group_type: 'banho_tosa',
          unit_price: 55,
          catalog_price: 55,
          duration_min: 60,
          commission_rate: 5,
          min_weight_kg: 0,
          max_weight_kg: 10,
          species_target: 'dog',
          benefit_used: true,
        }],
        scheduled_at: '2026-08-20T13:00:00.000Z',
        duration_min: 60,
        price: 55,
        status: 'agendado',
        source: 'manual',
      }

      const reopened = await updateAppointment(cookie, tenantId, packageAppointmentId, payload)
      const reopenedBody = await reopened.json<{ data: { reopened: boolean; package_released: boolean } }>()
      expect(reopened.status).toBe(200)
      expect(reopenedBody.data.reopened).toBe(true)
      expect(reopenedBody.data.package_released).toBe(true)

      const appointment = await db.prepare(`
        SELECT status,live_status,checkin_at_ms,ready_at_ms,subscription_id,
               subscription_benefit_used,subscription_benefit_status,subscription_benefits_json,
               subscription_label,subscription_discount_cents
        FROM appointments
        WHERE tenant_id=?1 AND module_id='petshop' AND id=?2
      `).bind(tenantId, packageAppointmentId).first<{
        status:string
        live_status:string
        checkin_at_ms:number|null
        ready_at_ms:number|null
        subscription_id:string|null
        subscription_benefit_used:number
        subscription_benefit_status:string|null
        subscription_benefits_json:string
        subscription_label:string|null
        subscription_discount_cents:number
      }>()
      expect(appointment).toMatchObject({
        status: 'scheduled',
        live_status: 'aguardando',
        checkin_at_ms: null,
        ready_at_ms: null,
        subscription_id: null,
        subscription_benefit_used: 0,
        subscription_benefit_status: 'released',
        subscription_label: null,
        subscription_discount_cents: 0,
      })
      const releasedBenefits = JSON.parse(appointment?.subscription_benefits_json || '[]')
      expect(releasedBenefits[0]).toEqual(expect.objectContaining({ status: 'released', service_code: serviceCode }))

      const subscription = await db.prepare(`SELECT services_used_json FROM client_subscriptions WHERE tenant_id=?1 AND module_id='petshop' AND id=?2`)
        .bind(tenantId, subscriptionId).first<{ services_used_json:string }>()
      expect(JSON.parse(subscription?.services_used_json || '{}')[serviceCode]).toBe(0)

      const serviceSnapshot = await db.prepare(`SELECT benefit_used FROM appointment_services WHERE tenant_id=?1 AND module_id='petshop' AND appointment_id=?2 AND position=0`)
        .bind(tenantId, packageAppointmentId).first<{ benefit_used:number }>()
      expect(serviceSnapshot?.benefit_used).toBe(0)

      const blocked = await updateAppointment(cookie, tenantId, paidAppointmentId, {
        ...payload,
        scheduled_at: '2026-08-20T14:00:00.000Z',
      })
      expect(blocked.status).toBe(409)
      await expect(blocked.json()).resolves.toEqual(expect.objectContaining({
        code: 'APPOINTMENT_REOPEN_REFUND_REQUIRED',
        sale_id: saleId,
        payment_status: 'received',
      }))

      const paidAppointment = await db.prepare(`SELECT status FROM appointments WHERE tenant_id=?1 AND module_id='petshop' AND id=?2`)
        .bind(tenantId, paidAppointmentId).first<{ status:string }>()
      expect(paidAppointment?.status).toBe('completed')

      await expect(db.prepare(`UPDATE appointments SET status='scheduled' WHERE tenant_id=?1 AND module_id='petshop' AND id=?2`)
        .bind(tenantId, paidAppointmentId).run()).rejects.toThrow(/APPOINTMENT_REOPEN_SALE_BLOCKED/)
    } finally {
      await db.prepare("DELETE FROM payments WHERE tenant_id=?1 AND module_id='petshop'").bind(tenantId).run()
      await db.prepare("DELETE FROM sale_items WHERE tenant_id=?1 AND module_id='petshop'").bind(tenantId).run()
      await db.prepare("DELETE FROM sales WHERE tenant_id=?1 AND module_id='petshop'").bind(tenantId).run()
      await db.prepare("DELETE FROM appointment_services WHERE tenant_id=?1 AND module_id='petshop'").bind(tenantId).run()
      await db.prepare("DELETE FROM appointment_transport WHERE tenant_id=?1 AND module_id='petshop'").bind(tenantId).run()
      await db.prepare("DELETE FROM appointments WHERE tenant_id=?1 AND module_id='petshop'").bind(tenantId).run()
      await db.prepare("DELETE FROM appointment_command_registry WHERE tenant_id=?1 AND module_id='petshop'").bind(tenantId).run()
      await db.prepare("DELETE FROM client_subscriptions WHERE tenant_id=?1 AND module_id='petshop'").bind(tenantId).run()
      await db.prepare("DELETE FROM subscription_plans WHERE tenant_id=?1 AND module_id='petshop'").bind(tenantId).run()
      await db.prepare("DELETE FROM services WHERE tenant_id=?1 AND module_id='petshop'").bind(tenantId).run()
      await db.prepare("DELETE FROM pets WHERE tenant_id=?1 AND module_id='petshop'").bind(tenantId).run()
      await db.prepare("DELETE FROM clients WHERE tenant_id=?1 AND module_id='petshop'").bind(tenantId).run()
      await db.prepare('DELETE FROM tenant_memberships WHERE tenant_id=?1').bind(tenantId).run()
      await db.prepare('DELETE FROM identity_principals WHERE id=?1').bind(principalId).run()
      await db.prepare('DELETE FROM tenants WHERE id=?1').bind(tenantId).run()
      await authDb.prepare('DELETE FROM session WHERE userId=?1').bind(userId).run()
      await authDb.prepare('DELETE FROM account WHERE userId=?1').bind(userId).run()
      await authDb.prepare('DELETE FROM user WHERE id=?1').bind(userId).run()
    }
  })
})
