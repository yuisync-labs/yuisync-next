import { env } from 'cloudflare:workers'
import { hash } from 'bcryptjs'
import { describe, expect, it } from 'vitest'

import { handleBetterAuthRequest } from '../src/auth/betterAuthRuntime'
import { handleCompatApiRequest } from '../src/compatApi'
import { handlePetshopPlansApiRequest } from '../src/petshopPlansApi'

const AUTH_SECRET = 'package-checkout-d1-test-secret-12345678901234567890'

function bindings() {
  return {
    ...(env as EdgeEnv),
    APP_ENV: 'staging',
    EDGE_BETTER_AUTH_ENABLED: 'true',
    BETTER_AUTH_SECRET: AUTH_SECRET,
    DB: (env as EdgeEnv & { DB: D1Database }).DB,
    AUTH_DB: (env as EdgeEnv & { AUTH_DB: D1Database }).AUTH_DB,
  }
}

async function signIn(email: string, password: string): Promise<string> {
  const response = await handleBetterAuthRequest(new Request('https://edge.test/api/auth/sign-in/email', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'https://edge.test' },
    body: JSON.stringify({ email, password, rememberMe: false }),
  }), bindings())
  expect(response).not.toBeNull()
  if (!response) throw new Error('SIGN_IN_HANDLER_MISSING')
  expect(response.status, await response.clone().text()).toBe(200)
  return (response.headers.get('set-cookie') || '').split(';')[0]
}

describe('package checkout D1 integration', () => {
  it('activates a pet-bound package and reserves its four weekly appointments atomically', async () => {
    const runtime = bindings()
    const database = runtime.DB
    const authDatabase = runtime.AUTH_DB
    const suffix = crypto.randomUUID()
    const tenantId = `package-tenant-${suffix}`
    const userId = `package-user-${suffix}`
    const principalId = `package-principal-${suffix}`
    const clientId = `package-client-${suffix}`
    const petId = `package-pet-${suffix}`
    const serviceId = `package-service-${suffix}`
    const serviceCode = `package_bath_${suffix}`
    const planId = `package-plan-${suffix}`
    const subscriptionId = `package-subscription-${suffix}`
    const email = `package-${suffix}@test.invalid`
    const password = 'ValidPassword123!'
    const now = Date.now()
    const firstAppointmentAt = now + 86_400_000
    const nowIso = new Date(now).toISOString()

    await authDatabase.batch([
      authDatabase.prepare('INSERT INTO user(id,name,email,emailVerified,image,createdAt,updatedAt) VALUES(?1,?2,?3,1,NULL,?4,?4)')
        .bind(userId, 'Package Checkout Test', email, nowIso),
      authDatabase.prepare('INSERT INTO account(id,userId,accountId,providerId,password,createdAt,updatedAt) VALUES(?1,?2,?3,?4,?5,?6,?6)')
        .bind(`credential:${userId}`, userId, userId, 'credential', await hash(password, 12), nowIso),
    ])

    await database.batch([
      database.prepare("INSERT INTO tenants(id,slug,name,status,created_at_ms,updated_at_ms) VALUES(?1,?2,'Package Tenant','active',?3,?3)")
        .bind(tenantId, `package-${suffix}`, now),
      database.prepare("INSERT INTO identity_principals(id,provider,subject,display_name,email,status,created_at_ms,updated_at_ms) VALUES(?1,'better-auth',?2,'Package Test',?3,'active',?4,?4)")
        .bind(principalId, userId, email, now),
      database.prepare("INSERT INTO tenant_memberships(tenant_id,principal_id,status,created_at_ms,updated_at_ms,role,module_permissions_json) VALUES(?1,?2,'active',?3,?3,'owner','{}')")
        .bind(tenantId, principalId, now),
      database.prepare("INSERT INTO clients(tenant_id,module_id,id,name,phone,status,created_at_ms,updated_at_ms) VALUES(?1,'petshop',?2,'Tutor Pacote','11999999999','active',?3,?3)")
        .bind(tenantId, clientId, now),
      database.prepare("INSERT INTO pets(tenant_id,module_id,id,client_id,name,species,status,created_at_ms,updated_at_ms) VALUES(?1,'petshop',?2,?3,'Pet Pacote','dog','active',?4,?4)")
        .bind(tenantId, petId, clientId, now),
      database.prepare("INSERT INTO services(tenant_id,module_id,id,code,name,group_type,default_price_cents,default_duration_min,status,created_at_ms,updated_at_ms) VALUES(?1,'petshop',?2,?3,'Banho Pacote','banho_tosa',5500,60,'active',?4,?4)")
        .bind(tenantId, serviceId, serviceCode, now),
      database.prepare("INSERT INTO subscription_plans(tenant_id,module_id,id,name,price_cents,billing_cycle,services_json,status,created_at_ms,updated_at_ms) VALUES(?1,'petshop',?2,'Pacote Teste',20000,'monthly',?3,'active',?4,?4)")
        .bind(tenantId, planId, JSON.stringify([{ service_type: serviceCode, service_code: serviceCode, qty_per_cycle: 4 }]), now),
      database.prepare("INSERT INTO client_subscriptions(tenant_id,module_id,id,plan_id,client_id,pet_id,status,started_at_ms,next_billing_date,services_used_json,first_appointment_at_ms,created_at_ms,updated_at_ms,benefit_ledger_base_used_json) VALUES(?1,'petshop',?2,?3,?4,?5,'pending_payment',?6,'2026-10-04','{}',?7,?6,?6,'{}')")
        .bind(tenantId, subscriptionId, planId, clientId, petId, now, firstAppointmentAt),
    ])

    try {
      const cookie = await signIn(email, password)
      const response = await handleCompatApiRequest(new Request('https://edge.test/api/compat/rpc', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie,
          'x-tenant-id': tenantId,
          'x-module-id': 'petshop',
        },
        body: JSON.stringify({
          name: 'checkout_petshop_subscription_transaction',
          args: { p_payload: { tenant_id: tenantId, module_id: 'petshop', subscription_id: subscriptionId, payment_method: 'pix' } },
        }),
      }), runtime)

      expect(response).not.toBeNull()
      if (!response) return
      const body = await response.json<Record<string, any>>()
      expect(response.status, JSON.stringify(body)).toBe(200)
      expect(body.data).toEqual(expect.objectContaining({
        subscription_id: subscriptionId,
        total: 200,
        appointments_created: 4,
        status: 'active',
      }))

      const subscription = await database.prepare("SELECT status,pet_id,recurring_appointments_created_at_ms FROM client_subscriptions WHERE tenant_id=?1 AND module_id='petshop' AND id=?2")
        .bind(tenantId, subscriptionId).first<Record<string, unknown>>()
      expect(subscription).toEqual(expect.objectContaining({ status: 'active', pet_id: petId }))
      expect(Number(subscription?.recurring_appointments_created_at_ms || 0)).toBeGreaterThan(0)

      const appointments = await database.prepare("SELECT pet_id,status,subscription_id,subscription_benefit_status,subscription_discount_cents FROM appointments WHERE tenant_id=?1 AND module_id='petshop' AND subscription_id=?2 ORDER BY scheduled_at_ms")
        .bind(tenantId, subscriptionId).all<Record<string, unknown>>()
      expect(appointments.results).toHaveLength(4)
      expect(appointments.results).toEqual(Array.from({ length: 4 }, () => expect.objectContaining({
        pet_id: petId,
        status: 'scheduled',
        subscription_id: subscriptionId,
        subscription_benefit_status: 'reserved',
        subscription_discount_cents: 5500,
      })))

      const allocations = await database.prepare("SELECT state,benefit_key FROM subscription_benefit_allocations WHERE tenant_id=?1 AND module_id='petshop' AND subscription_id=?2")
        .bind(tenantId, subscriptionId).all<Record<string, unknown>>()
      expect(allocations.results).toHaveLength(4)
      expect(allocations.results.every((row) => row.state === 'reserved' && row.benefit_key === serviceCode)).toBe(true)

      const appointmentListResponse = await handlePetshopPlansApiRequest(new Request(
        `https://edge.test/api/petshop/subscriptions/${encodeURIComponent(subscriptionId)}/appointments`,
        { headers: { cookie, 'x-tenant-id': tenantId, 'x-module-id': 'petshop' } },
      ), runtime)
      expect(appointmentListResponse).not.toBeNull()
      const appointmentListBody = await appointmentListResponse!.json<Record<string, any>>()
      expect(appointmentListResponse!.status, JSON.stringify(appointmentListBody)).toBe(200)
      expect(appointmentListBody.appointments).toHaveLength(4)
      expect(appointmentListBody.appointments.map((row: any) => row.scheduled_at)).toEqual(
        Array.from({ length: 4 }, (_, index) => new Date(firstAppointmentAt + index * 7 * 86_400_000).toISOString()),
      )

      const appointmentIds = await database.prepare("SELECT id FROM appointments WHERE tenant_id=?1 AND module_id='petshop' AND subscription_id=?2 ORDER BY scheduled_at_ms")
        .bind(tenantId, subscriptionId).all<{ id: string }>()
      const toRemove = appointmentIds.results.slice(1).map((row) => row.id)
      for (const appointmentId of toRemove) {
        await database.prepare("DELETE FROM subscription_benefit_allocations WHERE tenant_id=?1 AND module_id='petshop' AND appointment_id=?2").bind(tenantId, appointmentId).run()
        await database.prepare("DELETE FROM appointment_services WHERE tenant_id=?1 AND module_id='petshop' AND appointment_id=?2").bind(tenantId, appointmentId).run()
        await database.prepare("DELETE FROM appointments WHERE tenant_id=?1 AND module_id='petshop' AND id=?2").bind(tenantId, appointmentId).run()
      }

      const retry = await handleCompatApiRequest(new Request('https://edge.test/api/compat/rpc', {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie, 'x-tenant-id': tenantId, 'x-module-id': 'petshop' },
        body: JSON.stringify({
          name: 'checkout_petshop_subscription_transaction',
          args: { p_payload: { tenant_id: tenantId, module_id: 'petshop', subscription_id: subscriptionId, payment_method: 'pix' } },
        }),
      }), runtime)
      expect(retry).not.toBeNull()
      const retryBody = await retry!.json<Record<string, any>>()
      expect(retry!.status, JSON.stringify(retryBody)).toBe(200)
      expect(retryBody.data).toEqual(expect.objectContaining({ duplicated: true, appointments_created: 3, appointments_total: 4 }))
      const repaired = await database.prepare("SELECT id FROM appointments WHERE tenant_id=?1 AND module_id='petshop' AND subscription_id=?2")
        .bind(tenantId, subscriptionId).all()
      expect(repaired.results).toHaveLength(4)
    } finally {
      await database.prepare("DELETE FROM payments WHERE tenant_id=?1 AND module_id='petshop'").bind(tenantId).run()
      await database.prepare("DELETE FROM subscription_benefit_allocations WHERE tenant_id=?1 AND module_id='petshop'").bind(tenantId).run()
      await database.prepare("DELETE FROM appointment_services WHERE tenant_id=?1 AND module_id='petshop'").bind(tenantId).run()
      await database.prepare("DELETE FROM appointments WHERE tenant_id=?1 AND module_id='petshop'").bind(tenantId).run()
      await database.prepare("DELETE FROM sales WHERE tenant_id=?1 AND module_id='petshop'").bind(tenantId).run()
      await database.prepare("DELETE FROM client_subscriptions WHERE tenant_id=?1 AND module_id='petshop'").bind(tenantId).run()
      await database.prepare("DELETE FROM subscription_plans WHERE tenant_id=?1 AND module_id='petshop'").bind(tenantId).run()
      await database.prepare("DELETE FROM services WHERE tenant_id=?1 AND module_id='petshop'").bind(tenantId).run()
      await database.prepare("DELETE FROM pets WHERE tenant_id=?1 AND module_id='petshop'").bind(tenantId).run()
      await database.prepare("DELETE FROM clients WHERE tenant_id=?1 AND module_id='petshop'").bind(tenantId).run()
      await database.prepare('DELETE FROM tenant_memberships WHERE tenant_id=?1').bind(tenantId).run()
      await database.prepare('DELETE FROM identity_principals WHERE id=?1').bind(principalId).run()
      await database.prepare('DELETE FROM tenants WHERE id=?1').bind(tenantId).run()
      await authDatabase.prepare('DELETE FROM session WHERE userId=?1').bind(userId).run()
      await authDatabase.prepare('DELETE FROM account WHERE userId=?1').bind(userId).run()
      await authDatabase.prepare('DELETE FROM user WHERE id=?1').bind(userId).run()
    }
  })
})
