import { env } from 'cloudflare:workers'
import { hash } from 'bcryptjs'
import { describe, expect, it } from 'vitest'

import { handleBetterAuthRequest } from '../src/auth/betterAuthRuntime'
import { handlePackageCycleApiRequest } from '../src/packageCycleApi'
import { handleAppointmentBillingIntentCompat } from '../src/appointmentBillingIntentCompat'

const AUTH_SECRET = 'package-cycle-test-secret-123456789012345678901'

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
  expect(response?.status).toBe(200)
  return response?.headers.get('set-cookie')?.split(';')[0] || ''
}

function request(cookie: string, tenantId: string, path: string, method: string, body?: unknown) {
  return new Request(`https://edge.test${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      cookie,
      'x-tenant-id': tenantId,
      'x-module-id': 'petshop',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

function isoDate(daysFromNow: number) {
  return new Date(Date.now() + daysFromNow * 86_400_000).toISOString().slice(0, 10)
}

function isoAt(daysFromNow: number, hour = 13) {
  const day = isoDate(daysFromNow)
  return new Date(`${day}T${String(hour).padStart(2, '0')}:00:00-03:00`).toISOString()
}

describe('package cycle domain in workerd', () => {
  it('binds the package to one pet, persists the schedule and atomically creates four reserved weeks on checkout', async () => {
    const authDb = (env as EdgeEnv & { AUTH_DB: D1Database }).AUTH_DB
    const db = (env as EdgeEnv & { DB: D1Database }).DB
    const suffix = crypto.randomUUID()
    const tenantId = `tenant-package-cycle-${suffix}`
    const userId = `package-cycle-user-${suffix}`
    const principalId = `package-cycle-principal-${suffix}`
    const tutorId = `package-cycle-tutor-${suffix}`
    const petId = `package-cycle-pet-${suffix}`
    const siblingPetId = `package-cycle-sibling-${suffix}`
    const serviceId = `package-cycle-service-${suffix}`
    const serviceCode = `bath-small-${suffix}`
    const planId = `package-cycle-plan-${suffix}`
    const email = `package-cycle-${suffix}@test.invalid`
    const password = 'ValidPassword123!'
    const passwordHash = await hash(password, 12)
    const now = Date.now()
    const nowIso = new Date(now).toISOString()

    await authDb.batch([
      authDb.prepare('INSERT INTO user(id,name,email,emailVerified,image,createdAt,updatedAt) VALUES(?1,?2,?3,1,NULL,?4,?4)')
        .bind(userId, 'Package Cycle Test', email, nowIso),
      authDb.prepare('INSERT INTO account(id,userId,accountId,providerId,password,createdAt,updatedAt) VALUES(?1,?2,?3,?4,?5,?6,?6)')
        .bind(`credential:${userId}`, userId, userId, 'credential', passwordHash, nowIso),
    ])

    await db.batch([
      db.prepare("INSERT INTO tenants(id,slug,name,status,created_at_ms,updated_at_ms) VALUES(?1,?2,'Package Cycle Tenant','active',?3,?3)")
        .bind(tenantId, `package-cycle-${suffix}`, now),
      db.prepare("INSERT INTO identity_principals(id,provider,subject,display_name,email,status,created_at_ms,updated_at_ms) VALUES(?1,'better-auth',?2,'Package Cycle Test',?3,'active',?4,?4)")
        .bind(principalId, userId, email, now),
      db.prepare("INSERT INTO tenant_memberships(tenant_id,principal_id,status,created_at_ms,updated_at_ms,role,module_permissions_json) VALUES(?1,?2,'active',?3,?3,'staff',?4)")
        .bind(tenantId, principalId, now, JSON.stringify({ petshop: { role: 'admin_pet' } })),
      db.prepare("INSERT INTO clients(tenant_id,module_id,id,name,phone,address,address_number,address_reference,neighborhood,city,status,created_at_ms,updated_at_ms) VALUES(?1,'petshop',?2,'Tutor Dois Pets','32999990000','Rua Teste','42','Portao azul','Centro','Muriae','active',?3,?3)")
        .bind(tenantId, tutorId, now),
      db.prepare("INSERT INTO pets(tenant_id,module_id,id,client_id,name,species,weight_kg,status,created_at_ms,updated_at_ms) VALUES(?1,'petshop',?2,?3,'Mel','dog',8,'active',?4,?4)")
        .bind(tenantId, petId, tutorId, now),
      db.prepare("INSERT INTO pets(tenant_id,module_id,id,client_id,name,species,weight_kg,status,created_at_ms,updated_at_ms) VALUES(?1,'petshop',?2,?3,'Thor','dog',8,'active',?4,?4)")
        .bind(tenantId, siblingPetId, tutorId, now),
      db.prepare(`INSERT INTO services(
        tenant_id,module_id,id,code,name,group_type,default_price_cents,default_duration_min,
        commission_type,commission_basis_points,sort_order,status,created_at_ms,updated_at_ms,
        min_weight_kg,max_weight_kg,min_weight_grams,max_weight_grams,species_target
      ) VALUES(?1,'petshop',?2,?3,'Banho pequeno','banho_tosa',5500,60,'percentage',500,1,'active',?4,?4,0,10.099,0,10099,'dog')`)
        .bind(tenantId, serviceId, serviceCode, now),
      db.prepare(`INSERT INTO transport_options(
        tenant_id,module_id,id,label,fee_cents,max_weight_grams,pickup_required,dropoff_required,outside_city,status,sort_order
      ) VALUES(?1,'petshop','buscar_e_levar','MotoDog - buscar e levar',2000,NULL,1,1,0,'active',1)`)
        .bind(tenantId),
      db.prepare(`INSERT INTO subscription_plans(
        tenant_id,module_id,id,name,price_cents,billing_cycle,services_json,status,created_at_ms,updated_at_ms
      ) VALUES(?1,'petshop',?2,'4 Banhos + MotoDog',28000,'monthly',?3,'active',?4,?4)`)
        .bind(tenantId, planId, JSON.stringify([
          { service_type: serviceCode, service_code: serviceCode, qty_per_cycle: 4 },
          { service_type: 'motodog', service_code: 'motodog', qty_per_cycle: 4 },
        ]), now),
    ])

    let subscriptionId = ''
    try {
      const cookie = await signIn(email, password)
      const createResponse = await handlePackageCycleApiRequest(request(cookie, tenantId, '/api/petshop/subscriptions', 'POST', {
        plan_id: planId,
        client_id: petId,
        started_at: isoDate(7),
        next_billing_date: isoDate(37),
      }), bindings())
      expect(createResponse?.status).toBe(200)
      const created = await createResponse!.json<any>()
      subscriptionId = created.subscription.id
      expect(created.subscription).toMatchObject({
        status: 'pending_payment',
        client_id: petId,
        pet_id: petId,
      })
      expect(created.subscription.client.pet_name).toBe('Mel')

      const duplicatePending = await handlePackageCycleApiRequest(request(cookie, tenantId, '/api/petshop/subscriptions', 'POST', {
        plan_id: planId,
        client_id: petId,
        started_at: isoDate(7),
        next_billing_date: isoDate(37),
      }), bindings())
      expect(duplicatePending?.status).toBe(409)
      await expect(duplicatePending!.json()).resolves.toEqual(expect.objectContaining({
        code: 'PACKAGE_RENEWAL_ALREADY_PENDING',
        subscription_id: subscriptionId,
      }))

      const firstAt = isoAt(7, 13)
      const scheduleResponse = await handlePackageCycleApiRequest(request(cookie, tenantId, '/api/compat/query', 'POST', {
        table: 'client_subscriptions',
        action: 'update',
        filters: [
          { op: 'eq', column: 'id', value: subscriptionId },
          { op: 'eq', column: 'module_id', value: 'petshop' },
        ],
        payload: { first_appointment_at: firstAt, recurring_appointments_created_at: null },
        mode: 'single',
      }), bindings())
      expect(scheduleResponse?.status).toBe(200)
      await expect(scheduleResponse!.json()).resolves.toEqual(expect.objectContaining({
        data: expect.objectContaining({ id: subscriptionId, first_appointment_at: firstAt }),
      }))

      const checkout = await handlePackageCycleApiRequest(request(cookie, tenantId, '/api/compat/rpc', 'POST', {
        name: 'checkout_petshop_subscription_transaction',
        args: { p_payload: {
          tenant_id: tenantId,
          module_id: 'petshop',
          subscription_id: subscriptionId,
          payment_method: 'pix',
        } },
      }), bindings())
      expect(checkout?.status).toBe(200)
      const checkoutBody = await checkout!.json<any>()
      expect(checkoutBody.data).toMatchObject({
        subscription_id: subscriptionId,
        total: 280,
        status: 'active',
        duplicated: false,
        reserved_weeks: 4,
        legacy_weeks_consumed: 0,
      })
      expect(checkoutBody.data.appointment_ids).toHaveLength(4)

      const appointments = await db.prepare(`SELECT id,pet_id,client_id,status,source,subscription_id,subscription_benefit_status,scheduled_at_ms
        FROM appointments WHERE tenant_id=?1 AND module_id='petshop' AND subscription_id=?2 ORDER BY scheduled_at_ms,id`)
        .bind(tenantId, subscriptionId).all<any>()
      expect(appointments.results).toHaveLength(4)
      expect(appointments.results.every((row) => row.pet_id === petId && row.client_id === tutorId)).toBe(true)
      expect(appointments.results.every((row) => row.status === 'scheduled' && row.source === 'package_activation')).toBe(true)
      expect(appointments.results.every((row) => row.subscription_benefit_status === 'reserved')).toBe(true)
      expect(appointments.results.map((row) => row.scheduled_at_ms)).toEqual([
        Date.parse(firstAt),
        Date.parse(firstAt) + 7 * 86_400_000,
        Date.parse(firstAt) + 14 * 86_400_000,
        Date.parse(firstAt) + 21 * 86_400_000,
      ])

      const allocations = await db.prepare(`SELECT benefit_kind,benefit_key,state,COUNT(*) quantity
        FROM subscription_benefit_allocations WHERE tenant_id=?1 AND module_id='petshop' AND subscription_id=?2
        GROUP BY benefit_kind,benefit_key,state ORDER BY benefit_kind,benefit_key`)
        .bind(tenantId, subscriptionId).all<any>()
      expect(allocations.results).toEqual(expect.arrayContaining([
        expect.objectContaining({ benefit_kind: 'service', benefit_key: serviceCode, state: 'reserved', quantity: 4 }),
        expect.objectContaining({ benefit_kind: 'transport', benefit_key: 'motodog', state: 'reserved', quantity: 4 }),
      ]))

      const list = await handlePackageCycleApiRequest(request(cookie, tenantId, '/api/petshop/subscriptions', 'GET'), bindings())
      expect(list?.status).toBe(200)
      const listed = await list!.json<any>()
      const active = listed.subscriptions.find((item: any) => item.id === subscriptionId)
      expect(active).toMatchObject({
        status: 'active',
        client_id: petId,
        pet_id: petId,
        first_appointment_at: firstAt,
      })
      expect(active.services_reserved[serviceCode]).toBe(4)
      expect(active.services_reserved.motodog).toBe(4)

      const replay = await handlePackageCycleApiRequest(request(cookie, tenantId, '/api/compat/rpc', 'POST', {
        name: 'checkout_petshop_subscription_transaction',
        args: { p_payload: {
          tenant_id: tenantId,
          module_id: 'petshop',
          subscription_id: subscriptionId,
          payment_method: 'pix',
        } },
      }), bindings())
      expect(replay?.status).toBe(200)
      await expect(replay!.json()).resolves.toEqual(expect.objectContaining({
        data: expect.objectContaining({ subscription_id: subscriptionId, duplicated: true }),
      }))
      const afterReplay = await db.prepare("SELECT COUNT(*) count FROM appointments WHERE tenant_id=?1 AND module_id='petshop' AND subscription_id=?2")
        .bind(tenantId, subscriptionId).first<{ count:number }>()
      expect(Number(afterReplay?.count || 0)).toBe(4)

      // A sibling pet of the same tutor must not automatically consume Mel's package.
      const siblingBooking = await handleAppointmentBillingIntentCompat(request(cookie, tenantId, '/api/compat/rpc', 'POST', {
        name: 'book_petshop_appointment_transaction',
        args: { p_payload: {
          tenant_id: tenantId,
          module_id: 'petshop',
          client_id: tutorId,
          pet_id: siblingPetId,
          services: [{ code: serviceCode }],
          scheduled_at: isoAt(40, 15),
          status: 'agendado',
          source: 'manual',
          transport_mode: 'cliente_leva',
          idempotency_key: `sibling-${suffix}`,
        } },
      }), bindings())
      expect(siblingBooking?.status).toBe(201)
      const siblingBody = await siblingBooking!.json<any>()
      expect(siblingBody.data.billing_intent).toBe('standalone')
      expect(siblingBody.data.allocation_count).toBe(0)
    } finally {
      await db.prepare("DELETE FROM payments WHERE tenant_id=?1 AND module_id='petshop'").bind(tenantId).run()
      await db.prepare("DELETE FROM sale_items WHERE tenant_id=?1 AND module_id='petshop'").bind(tenantId).run()
      await db.prepare("DELETE FROM sales WHERE tenant_id=?1 AND module_id='petshop'").bind(tenantId).run()
      await db.prepare("DELETE FROM subscription_benefit_allocations WHERE tenant_id=?1 AND module_id='petshop'").bind(tenantId).run()
      await db.prepare("DELETE FROM appointment_services WHERE tenant_id=?1 AND module_id='petshop'").bind(tenantId).run()
      await db.prepare("DELETE FROM appointment_transport WHERE tenant_id=?1 AND module_id='petshop'").bind(tenantId).run()
      await db.prepare("DELETE FROM appointments WHERE tenant_id=?1 AND module_id='petshop'").bind(tenantId).run()
      await db.prepare("DELETE FROM appointment_command_registry WHERE tenant_id=?1 AND module_id='petshop'").bind(tenantId).run()
      await db.prepare("DELETE FROM operation_effects WHERE tenant_id=?1 AND module_id='petshop'").bind(tenantId).run()
      await db.prepare("DELETE FROM operation_checkpoints WHERE tenant_id=?1 AND module_id='petshop'").bind(tenantId).run()
      await db.prepare("DELETE FROM client_subscriptions WHERE tenant_id=?1 AND module_id='petshop'").bind(tenantId).run()
      await db.prepare("DELETE FROM subscription_plans WHERE tenant_id=?1 AND module_id='petshop'").bind(tenantId).run()
      await db.prepare("DELETE FROM transport_options WHERE tenant_id=?1 AND module_id='petshop'").bind(tenantId).run()
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
