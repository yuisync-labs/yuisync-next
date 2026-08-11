import { env } from 'cloudflare:workers'
import { hash } from 'bcryptjs'
import { describe, expect, it } from 'vitest'

import { handleBetterAuthRequest } from '../src/auth/betterAuthRuntime'
import { handleCompatApiRequest } from '../src/compatApi'

const AUTH_SECRET = 'package-reconciliation-test-secret-12345678901234567890'

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
    headers: { 'content-type': 'application/json', origin: 'https://edge.test' },
    body: JSON.stringify({ email, password, rememberMe: false }),
  }), bindings())
  expect(response).not.toBeNull()
  expect(response?.status).toBe(200)
  const cookie = response?.headers.get('set-cookie')?.split(';')[0] || ''
  expect(cookie).toContain('better-auth')
  return cookie
}

async function completeLikeCurrentUi(cookie: string, tenantId: string, appointmentId: string): Promise<Response> {
  const response = await handleCompatApiRequest(new Request('https://edge.test/api/compat/query', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      cookie,
      'x-tenant-id': tenantId,
      'x-module-id': 'petshop',
    },
    body: JSON.stringify({
      table: 'appointments',
      action: 'update',
      payload: { status: 'concluido' },
      filters: [
        { op: 'eq', column: 'id', value: appointmentId },
        { op: 'eq', column: 'module_id', value: 'petshop' },
        { op: 'eq', column: 'tenant_id', value: tenantId },
      ],
      mode: 'many',
    }),
  }), bindings())
  expect(response).not.toBeNull()
  return response as Response
}

describe('package reconciliation for existing appointments in workerd', () => {
  it('current status-only UI path completes an originally standalone appointment with the active package exactly once', async () => {
    const authDb = (env as EdgeEnv & { AUTH_DB: D1Database }).AUTH_DB
    const db = (env as EdgeEnv & { DB: D1Database }).DB
    const suffix = crypto.randomUUID()
    const tenantId = `tenant-package-${suffix}`
    const userId = `package-user-${suffix}`
    const principalId = `package-principal-${suffix}`
    const clientId = `package-client-${suffix}`
    const petId = `package-pet-${suffix}`
    const serviceId = `package-service-${suffix}`
    const serviceCode = `bath-package-${suffix}`
    const planId = `package-plan-${suffix}`
    const subscriptionId = `package-subscription-${suffix}`
    const appointmentId = `package-appointment-${suffix}`
    const email = `package-${suffix}@test.invalid`
    const password = 'ValidPassword123!'
    const passwordHash = await hash(password, 12)
    const now = Date.now()
    const nowIso = new Date(now).toISOString()
    const scheduledAt = Date.parse('2026-08-22T13:00:00.000Z')

    await authDb.batch([
      authDb.prepare('INSERT INTO user(id,name,email,emailVerified,image,createdAt,updatedAt) VALUES(?1,?2,?3,1,NULL,?4,?4)')
        .bind(userId, 'Package Reconciliation Test', email, nowIso),
      authDb.prepare('INSERT INTO account(id,userId,accountId,providerId,password,createdAt,updatedAt) VALUES(?1,?2,?3,?4,?5,?6,?6)')
        .bind(`credential:${userId}`, userId, userId, 'credential', passwordHash, nowIso),
    ])

    await db.batch([
      db.prepare("INSERT INTO tenants(id,slug,name,status,created_at_ms,updated_at_ms) VALUES(?1,?2,'Package Tenant','active',?3,?3)")
        .bind(tenantId, `package-${suffix}`, now),
      db.prepare("INSERT INTO identity_principals(id,provider,subject,display_name,email,status,created_at_ms,updated_at_ms) VALUES(?1,'better-auth',?2,'Package Reconciliation Test',?3,'active',?4,?4)")
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
      ) VALUES(?1,'petshop',?2,?3,?4,'active',?5,'2026-09-22','{}',NULL,?5,?5)`)
        .bind(tenantId, subscriptionId, planId, clientId, now),
      db.prepare(`INSERT INTO appointments(
        tenant_id,module_id,id,client_id,pet_id,scheduled_at_ms,duration_min,service_group,status,source,
        subtotal_cents,transport_fee_cents,notes,version,created_at_ms,updated_at_ms,
        subscription_id,subscription_benefit_used,subscription_benefit_status,subscription_benefits_json,
        subscription_label,subscription_discount_cents
      ) VALUES(?1,'petshop',?2,?3,?4,?5,60,'banho_tosa','scheduled','manual',5500,0,NULL,1,?6,?6,
        NULL,0,NULL,'[]',NULL,0)`)
        .bind(tenantId, appointmentId, clientId, petId, scheduledAt, now),
      db.prepare(`INSERT INTO appointment_services(
        tenant_id,module_id,appointment_id,position,service_id,service_code,service_name,service_group,
        unit_price_cents,duration_min,benefit_used,catalog_price_cents,commission_basis_points,
        min_weight_kg,max_weight_kg,species_target
      ) VALUES(?1,'petshop',?2,0,?3,?4,'Banho pequeno','banho_tosa',5500,60,0,5500,500,0,10,'dog')`)
        .bind(tenantId, appointmentId, serviceId, serviceCode),
    ])

    try {
      const cookie = await signIn(email, password)

      const first = await completeLikeCurrentUi(cookie, tenantId, appointmentId)
      const firstBody = await first.json<{
        data: {
          appointment_id: string
          completed: boolean
          package_reconciliation: {
            changed: boolean
            subscription_id: string
            covered_by_subscription: boolean
            consumed_qty: number
            discount: number
          }
        }
      }>()
      expect(first.status).toBe(200)
      expect(firstBody.data.appointment_id).toBe(appointmentId)
      expect(firstBody.data.completed).toBe(true)
      expect(firstBody.data.package_reconciliation).toMatchObject({
        changed: true,
        subscription_id: subscriptionId,
        covered_by_subscription: true,
        consumed_qty: 1,
        discount: 55,
      })

      const appointment = await db.prepare(`
        SELECT status,subscription_id,subscription_benefit_used,subscription_benefit_status,
               subscription_benefits_json,subscription_discount_cents
        FROM appointments
        WHERE tenant_id=?1 AND module_id='petshop' AND id=?2
      `).bind(tenantId, appointmentId).first<{
        status:string
        subscription_id:string|null
        subscription_benefit_used:number
        subscription_benefit_status:string|null
        subscription_benefits_json:string
        subscription_discount_cents:number
      }>()
      expect(appointment).toMatchObject({
        status: 'completed',
        subscription_id: subscriptionId,
        subscription_benefit_used: 1,
        subscription_benefit_status: 'consumed',
        subscription_discount_cents: 5500,
      })
      const benefits = JSON.parse(appointment?.subscription_benefits_json || '[]')
      expect(benefits).toHaveLength(1)
      expect(benefits[0]).toEqual(expect.objectContaining({
        kind: 'service',
        service_code: serviceCode,
        status: 'consumed',
        catalog_price: 55,
      }))

      const subscription = await db.prepare(`SELECT services_used_json FROM client_subscriptions WHERE tenant_id=?1 AND module_id='petshop' AND id=?2`)
        .bind(tenantId, subscriptionId).first<{ services_used_json:string }>()
      expect(JSON.parse(subscription?.services_used_json || '{}')[serviceCode]).toBe(1)

      const serviceSnapshot = await db.prepare(`SELECT benefit_used,catalog_price_cents FROM appointment_services WHERE tenant_id=?1 AND module_id='petshop' AND appointment_id=?2 AND position=0`)
        .bind(tenantId, appointmentId).first<{ benefit_used:number; catalog_price_cents:number }>()
      expect(serviceSnapshot).toEqual({ benefit_used: 1, catalog_price_cents: 5500 })

      const replay = await completeLikeCurrentUi(cookie, tenantId, appointmentId)
      const replayBody = await replay.json<{
        data: {
          completed:boolean
          package_reconciliation:{ changed:boolean; consumed_qty:number; covered_by_subscription:boolean }
        }
      }>()
      expect(replay.status).toBe(200)
      expect(replayBody.data.completed).toBe(true)
      expect(replayBody.data.package_reconciliation).toMatchObject({
        changed: false,
        consumed_qty: 0,
        covered_by_subscription: true,
      })

      const afterReplay = await db.prepare(`SELECT services_used_json FROM client_subscriptions WHERE tenant_id=?1 AND module_id='petshop' AND id=?2`)
        .bind(tenantId, subscriptionId).first<{ services_used_json:string }>()
      expect(JSON.parse(afterReplay?.services_used_json || '{}')[serviceCode]).toBe(1)
    } finally {
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
