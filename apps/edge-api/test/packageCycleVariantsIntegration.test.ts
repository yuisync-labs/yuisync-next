import { env } from 'cloudflare:workers'
import { hash } from 'bcryptjs'
import { describe, expect, it } from 'vitest'

import { handleBetterAuthRequest } from '../src/auth/betterAuthRuntime'
import { handlePackageCycleApiRequest } from '../src/packageCycleApi'

const AUTH_SECRET = 'package-cycle-variants-secret-1234567890123456789'
const DAY = 86_400_000

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

function req(cookie: string, tenantId: string, path: string, method: string, body?: unknown) {
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

function dayDate(offset: number) {
  return new Date(Date.now() + offset * DAY).toISOString().slice(0, 10)
}
function dayAt(offset: number, hour = 14) {
  const date = dayDate(offset)
  return new Date(`${date}T${String(hour).padStart(2, '0')}:00:00-03:00`).toISOString()
}

async function createCycle(input: {
  cookie: string
  tenantId: string
  planId: string
  petId: string
  firstAt: string
  payment?: Record<string, unknown>
}) {
  const create = await handlePackageCycleApiRequest(req(input.cookie, input.tenantId, '/api/petshop/subscriptions', 'POST', {
    plan_id: input.planId,
    client_id: input.petId,
    started_at: input.firstAt.slice(0, 10),
    next_billing_date: new Date(Date.parse(input.firstAt) + 30 * DAY).toISOString().slice(0, 10),
  }), bindings())
  expect(create?.status).toBe(200)
  const created = await create!.json<any>()
  const subscriptionId = created.subscription.id as string

  const schedule = await handlePackageCycleApiRequest(req(input.cookie, input.tenantId, '/api/compat/query', 'POST', {
    table: 'client_subscriptions',
    action: 'update',
    filters: [{ op: 'eq', column: 'id', value: subscriptionId }],
    payload: { first_appointment_at: input.firstAt },
    mode: 'single',
  }), bindings())
  expect(schedule?.status).toBe(200)

  const checkout = await handlePackageCycleApiRequest(req(input.cookie, input.tenantId, '/api/compat/rpc', 'POST', {
    name: 'checkout_petshop_subscription_transaction',
    args: { p_payload: {
      tenant_id: input.tenantId,
      module_id: 'petshop',
      subscription_id: subscriptionId,
      ...(input.payment || {}),
    } },
  }), bindings())
  expect(checkout?.status).toBe(200)
  return { subscriptionId, body: await checkout!.json<any>() }
}

describe('package cycle variants in workerd', () => {
  it('covers split/debit/credit/cash, all weekly services, MotoDog quantity, free package and legacy dates', async () => {
    const authDb = (env as EdgeEnv & { AUTH_DB: D1Database }).AUTH_DB
    const db = (env as EdgeEnv & { DB: D1Database }).DB
    const suffix = crypto.randomUUID()
    const tenantId = `tenant-package-variants-${suffix}`
    const userId = `package-variants-user-${suffix}`
    const principalId = `package-variants-principal-${suffix}`
    const tutorId = `package-variants-tutor-${suffix}`
    const petId = `package-variants-pet-${suffix}`
    const bathId = `package-variants-bath-${suffix}`
    const extraId = `package-variants-extra-${suffix}`
    const bathCode = `bath-${suffix}`
    const extraCode = `hydration-${suffix}`
    const paidPlanId = `package-variants-paid-${suffix}`
    const freePlanId = `package-variants-free-${suffix}`
    const email = `package-variants-${suffix}@test.invalid`
    const password = 'ValidPassword123!'
    const passwordHash = await hash(password, 12)
    const now = Date.now()
    const nowIso = new Date(now).toISOString()

    await authDb.batch([
      authDb.prepare('INSERT INTO user(id,name,email,emailVerified,image,createdAt,updatedAt) VALUES(?1,?2,?3,1,NULL,?4,?4)')
        .bind(userId, 'Package Variants Test', email, nowIso),
      authDb.prepare('INSERT INTO account(id,userId,accountId,providerId,password,createdAt,updatedAt) VALUES(?1,?2,?3,?4,?5,?6,?6)')
        .bind(`credential:${userId}`, userId, userId, 'credential', passwordHash, nowIso),
    ])

    await db.batch([
      db.prepare("INSERT INTO tenants(id,slug,name,status,created_at_ms,updated_at_ms) VALUES(?1,?2,'Package Variants Tenant','active',?3,?3)")
        .bind(tenantId, `package-variants-${suffix}`, now),
      db.prepare("INSERT INTO identity_principals(id,provider,subject,display_name,email,status,created_at_ms,updated_at_ms) VALUES(?1,'better-auth',?2,'Package Variants Test',?3,'active',?4,?4)")
        .bind(principalId, userId, email, now),
      db.prepare("INSERT INTO tenant_memberships(tenant_id,principal_id,status,created_at_ms,updated_at_ms,role,module_permissions_json) VALUES(?1,?2,'active',?3,?3,'staff',?4)")
        .bind(tenantId, principalId, now, JSON.stringify({ petshop: { role: 'admin_pet' } })),
      db.prepare("INSERT INTO clients(tenant_id,module_id,id,name,phone,address,address_number,address_reference,neighborhood,city,status,created_at_ms,updated_at_ms) VALUES(?1,'petshop',?2,'Tutor Variants','32999990000','Rua Teste','42','Portao azul','Centro','Muriae','active',?3,?3)")
        .bind(tenantId, tutorId, now),
      db.prepare("INSERT INTO pets(tenant_id,module_id,id,client_id,name,species,weight_kg,status,created_at_ms,updated_at_ms) VALUES(?1,'petshop',?2,?3,'Mel','dog',8,'active',?4,?4)")
        .bind(tenantId, petId, tutorId, now),
      db.prepare(`INSERT INTO services(
        tenant_id,module_id,id,code,name,group_type,default_price_cents,default_duration_min,
        commission_type,commission_basis_points,sort_order,status,created_at_ms,updated_at_ms,
        min_weight_kg,max_weight_kg,min_weight_grams,max_weight_grams,species_target
      ) VALUES(?1,'petshop',?2,?3,'Banho pequeno','banho_tosa',5500,60,'percentage',500,1,'active',?4,?4,0,10.099,0,10099,'dog')`)
        .bind(tenantId, bathId, bathCode, now),
      db.prepare(`INSERT INTO services(
        tenant_id,module_id,id,code,name,group_type,default_price_cents,default_duration_min,
        commission_type,commission_basis_points,sort_order,status,created_at_ms,updated_at_ms,
        min_weight_kg,max_weight_kg,min_weight_grams,max_weight_grams,species_target
      ) VALUES(?1,'petshop',?2,?3,'Hidratacao','banho_tosa',3000,20,'percentage',500,2,'active',?4,?4,0,10.099,0,10099,'dog')`)
        .bind(tenantId, extraId, extraCode, now),
      db.prepare(`INSERT INTO transport_options(
        tenant_id,module_id,id,label,fee_cents,max_weight_grams,pickup_required,dropoff_required,outside_city,status,sort_order
      ) VALUES(?1,'petshop','buscar_e_levar','MotoDog - buscar e levar',2000,NULL,1,1,0,'active',1)`)
        .bind(tenantId),
      db.prepare(`INSERT INTO subscription_plans(
        tenant_id,module_id,id,name,price_cents,billing_cycle,services_json,status,created_at_ms,updated_at_ms
      ) VALUES(?1,'petshop',?2,'Plano Completo',28000,'monthly',?3,'active',?4,?4)`)
        .bind(tenantId, paidPlanId, JSON.stringify([
          { service_type: bathCode, service_code: bathCode, qty_per_cycle: 4 },
          { service_type: extraCode, service_code: extraCode, qty_per_cycle: 4 },
          { service_type: 'motodog', service_code: 'motodog', qty_per_cycle: 2 },
        ]), now),
      db.prepare(`INSERT INTO subscription_plans(
        tenant_id,module_id,id,name,price_cents,billing_cycle,services_json,status,created_at_ms,updated_at_ms
      ) VALUES(?1,'petshop',?2,'Cortesia',0,'monthly',?3,'active',?4,?4)`)
        .bind(tenantId, freePlanId, JSON.stringify([
          { service_type: bathCode, service_code: bathCode, qty_per_cycle: 4 },
        ]), now),
    ])

    try {
      const cookie = await signIn(email, password)

      const split = await createCycle({
        cookie,
        tenantId,
        planId: paidPlanId,
        petId,
        firstAt: dayAt(10, 14),
        payment: {
          payment_method: 'pix',
          payment_splits: [
            { method: 'dinheiro', amount: 100 },
            { method: 'credito', amount: 180 },
          ],
        },
      })
      expect(split.body.data).toMatchObject({ reserved_weeks: 4, legacy_weeks_consumed: 0, total: 280 })
      const splitAppointments = await db.prepare("SELECT COUNT(*) count FROM appointments WHERE tenant_id=?1 AND module_id='petshop' AND subscription_id=?2")
        .bind(tenantId, split.subscriptionId).first<{ count:number }>()
      expect(Number(splitAppointments?.count || 0)).toBe(4)
      const splitServices = await db.prepare("SELECT COUNT(*) count FROM appointment_services s JOIN appointments a ON a.tenant_id=s.tenant_id AND a.module_id=s.module_id AND a.id=s.appointment_id WHERE a.tenant_id=?1 AND a.module_id='petshop' AND a.subscription_id=?2")
        .bind(tenantId, split.subscriptionId).first<{ count:number }>()
      expect(Number(splitServices?.count || 0)).toBe(8)
      const splitBenefits = await db.prepare("SELECT benefit_kind,benefit_key,COUNT(*) quantity FROM subscription_benefit_allocations WHERE tenant_id=?1 AND module_id='petshop' AND subscription_id=?2 AND state='reserved' GROUP BY benefit_kind,benefit_key")
        .bind(tenantId, split.subscriptionId).all<any>()
      expect(splitBenefits.results).toEqual(expect.arrayContaining([
        expect.objectContaining({ benefit_kind: 'service', benefit_key: bathCode, quantity: 4 }),
        expect.objectContaining({ benefit_kind: 'service', benefit_key: extraCode, quantity: 4 }),
        expect.objectContaining({ benefit_kind: 'transport', benefit_key: 'motodog', quantity: 2 }),
      ]))
      const splitPayments = await db.prepare("SELECT method,amount_cents FROM payments p JOIN sales s ON s.tenant_id=p.tenant_id AND s.module_id=p.module_id AND s.id=p.sale_id WHERE s.tenant_id=?1 AND s.module_id='petshop' AND s.subscription_id=?2 ORDER BY amount_cents")
        .bind(tenantId, split.subscriptionId).all<any>()
      expect(splitPayments.results).toEqual([
        expect.objectContaining({ method: 'cash', amount_cents: 10000 }),
        expect.objectContaining({ method: 'card', amount_cents: 18000 }),
      ])

      const debit = await createCycle({ cookie, tenantId, planId: paidPlanId, petId, firstAt: dayAt(40, 14), payment: { payment_method: 'debito' } })
      const debitPayment = await db.prepare("SELECT p.method FROM payments p JOIN sales s ON s.tenant_id=p.tenant_id AND s.module_id=p.module_id AND s.id=p.sale_id WHERE s.tenant_id=?1 AND s.module_id='petshop' AND s.subscription_id=?2 LIMIT 1")
        .bind(tenantId, debit.subscriptionId).first<{ method:string }>()
      expect(debitPayment?.method).toBe('card')

      const credit = await createCycle({ cookie, tenantId, planId: paidPlanId, petId, firstAt: dayAt(70, 14), payment: { payment_method: 'credito' } })
      const creditPayment = await db.prepare("SELECT p.method FROM payments p JOIN sales s ON s.tenant_id=p.tenant_id AND s.module_id=p.module_id AND s.id=p.sale_id WHERE s.tenant_id=?1 AND s.module_id='petshop' AND s.subscription_id=?2 LIMIT 1")
        .bind(tenantId, credit.subscriptionId).first<{ method:string }>()
      expect(creditPayment?.method).toBe('card')

      const free = await createCycle({ cookie, tenantId, planId: freePlanId, petId, firstAt: dayAt(100, 14) })
      expect(free.body.data).toMatchObject({ total: 0, status: 'active', reserved_weeks: 4 })
      const freePayments = await db.prepare("SELECT COUNT(*) count FROM payments p JOIN sales s ON s.tenant_id=p.tenant_id AND s.module_id=p.module_id AND s.id=p.sale_id WHERE s.tenant_id=?1 AND s.module_id='petshop' AND s.subscription_id=?2")
        .bind(tenantId, free.subscriptionId).first<{ count:number }>()
      expect(Number(freePayments?.count || 0)).toBe(0)

      const legacyFirstAt = new Date(Date.now() - 15 * DAY).toISOString()
      const legacy = await createCycle({ cookie, tenantId, planId: paidPlanId, petId, firstAt: legacyFirstAt, payment: { payment_method: 'pix' } })
      expect(legacy.body.data.legacy_weeks_consumed).toBe(3)
      expect(legacy.body.data.reserved_weeks).toBe(1)
      const legacyAppointments = await db.prepare("SELECT COUNT(*) count FROM appointments WHERE tenant_id=?1 AND module_id='petshop' AND subscription_id=?2")
        .bind(tenantId, legacy.subscriptionId).first<{ count:number }>()
      expect(Number(legacyAppointments?.count || 0)).toBe(1)
      const legacySubscription = await db.prepare("SELECT benefit_ledger_base_used_json FROM client_subscriptions WHERE tenant_id=?1 AND module_id='petshop' AND id=?2")
        .bind(tenantId, legacy.subscriptionId).first<{ benefit_ledger_base_used_json:string }>()
      const base = JSON.parse(legacySubscription?.benefit_ledger_base_used_json || '{}')
      expect(base[bathCode]).toBe(3)
      expect(base[extraCode]).toBe(3)
      expect(base.motodog).toBe(2)
      const legacyReserved = await db.prepare("SELECT benefit_kind,benefit_key,COUNT(*) quantity FROM subscription_benefit_allocations WHERE tenant_id=?1 AND module_id='petshop' AND subscription_id=?2 AND state='reserved' GROUP BY benefit_kind,benefit_key")
        .bind(tenantId, legacy.subscriptionId).all<any>()
      expect(legacyReserved.results).toEqual(expect.arrayContaining([
        expect.objectContaining({ benefit_kind: 'service', benefit_key: bathCode, quantity: 1 }),
        expect.objectContaining({ benefit_kind: 'service', benefit_key: extraCode, quantity: 1 }),
      ]))
      expect(legacyReserved.results.some((row) => row.benefit_key === 'motodog')).toBe(false)
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
