import { env } from 'cloudflare:workers'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { handleAppApiRequest } from '../src/appApi'
import { handleCustomerOnboardingApiRequest } from '../src/customerOnboardingApi'
import { handlePlatformBillingApiRequest } from '../src/platformBillingApi'
import {
  PLAN_MODULES,
  allowedModulesForPlan,
  normalizePlanSlug,
} from '../src/tenantPlanAccess'

const bindings = env as EdgeEnv & {
  DB: D1Database
  AUTH_DB: D1Database
  AUTH_EMAIL_API_KEY?: string
  AUTH_EMAIL_FROM?: string
}
const db = bindings.DB
const authDb = bindings.AUTH_DB

const START_MODULES = [
  'agenda',
  'clients_pets',
  'sales_pos',
  'cash_control',
  'inventory',
]
const PRO_MODULES = [
  ...START_MODULES,
  'service_orders_delivery',
  'whatsapp_basic',
  'team_commissions',
]
const PRIME_MODULES = [
  ...PRO_MODULES,
  'petbot_ai',
  'campaigns_reengagement',
  'ai_satisfaction',
]
const ELITE_MODULES = [
  ...PRIME_MODULES,
  'multi_instance',
  'custom_configuration',
]

type CleanupState = {
  tenantIds: string[]
  orderIds: string[]
  eventIds: string[]
  userIds: string[]
  principalIds: string[]
}

let cleanup: CleanupState = {
  tenantIds: [],
  orderIds: [],
  eventIds: [],
  userIds: [],
  principalIds: [],
}

afterEach(async () => {
  vi.restoreAllMocks()
  for (const tenantId of cleanup.tenantIds) {
    await db.prepare('DELETE FROM support_messages WHERE tenant_id=?1').bind(tenantId).run()
    await db.prepare('DELETE FROM support_threads WHERE tenant_id=?1').bind(tenantId).run()
    await db.prepare('DELETE FROM services WHERE tenant_id=?1').bind(tenantId).run()
    await db.prepare('DELETE FROM tenant_first_run WHERE tenant_id=?1').bind(tenantId).run()
    await db.prepare('DELETE FROM tenant_plan_access WHERE tenant_id=?1').bind(tenantId).run()
    await db.prepare('DELETE FROM tenant_memberships WHERE tenant_id=?1').bind(tenantId).run()
    await db.prepare('DELETE FROM module_settings_extensions WHERE tenant_id=?1').bind(tenantId).run()
    await db.prepare('DELETE FROM tenant_module_settings WHERE tenant_id=?1').bind(tenantId).run()
  }
  for (const principalId of cleanup.principalIds) {
    await db.prepare('DELETE FROM managed_user_profiles WHERE principal_id=?1').bind(principalId).run()
    await db.prepare('DELETE FROM profiles WHERE id=?1').bind(principalId).run()
    await db.prepare('DELETE FROM identity_principals WHERE id=?1').bind(principalId).run()
  }
  for (const orderId of cleanup.orderIds) {
    await db.prepare('DELETE FROM platform_billing_subscriptions WHERE checkout_order_id=?1').bind(orderId).run()
    await db.prepare('DELETE FROM platform_onboarding_invitations WHERE checkout_order_id=?1').bind(orderId).run()
    await db.prepare('DELETE FROM platform_checkout_orders WHERE id=?1').bind(orderId).run()
  }
  for (const eventId of cleanup.eventIds) {
    await db.prepare('DELETE FROM platform_stripe_webhook_events WHERE id=?1').bind(eventId).run()
  }
  for (const tenantId of cleanup.tenantIds) {
    await db.prepare('DELETE FROM tenants WHERE id=?1').bind(tenantId).run()
  }
  for (const userId of cleanup.userIds) {
    await authDb.prepare('DELETE FROM session WHERE userId=?1').bind(userId).run()
    await authDb.prepare('DELETE FROM account WHERE userId=?1').bind(userId).run()
    await authDb.prepare('DELETE FROM user WHERE id=?1').bind(userId).run()
  }
  cleanup = { tenantIds: [], orderIds: [], eventIds: [], userIds: [], principalIds: [] }
})

async function signedWebhook(payload: Record<string, unknown>, secret = 'whsec_tenant_plan_access') {
  const raw = JSON.stringify(payload)
  const timestamp = Math.floor(Date.now() / 1000)
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const digest = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${timestamp}.${raw}`))
  const signature = Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
  return new Request('https://edge.test/api/webhooks/stripe', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'stripe-signature': `t=${timestamp},v1=${signature}`,
    },
    body: raw,
  })
}

function parsedModules(raw: string): string[] {
  return JSON.parse(raw) as string[]
}

describe('tenant commercial plan access', () => {
  it('normalizes every public and persisted plan identifier into one canonical catalog', () => {
    expect(normalizePlanSlug('start')).toBe('yui-start')
    expect(normalizePlanSlug('yui_start')).toBe('yui-start')
    expect(normalizePlanSlug('yui-start')).toBe('yui-start')
    expect(normalizePlanSlug('pro')).toBe('yui-pro')
    expect(normalizePlanSlug('yui_pro')).toBe('yui-pro')
    expect(normalizePlanSlug('prime')).toBe('yui-prime-ia')
    expect(normalizePlanSlug('yui_prime_ia')).toBe('yui-prime-ia')
    expect(normalizePlanSlug('yui-prime-ia')).toBe('yui-prime-ia')
    expect(normalizePlanSlug('elite')).toBe('yui-elite')
    expect(normalizePlanSlug('yui_elite')).toBe('yui-elite')

    expect(PLAN_MODULES['yui-start']).toEqual(START_MODULES)
    expect(PLAN_MODULES['yui-pro']).toEqual(PRO_MODULES)
    expect(PLAN_MODULES['yui-prime-ia']).toEqual(PRIME_MODULES)
    expect(PLAN_MODULES['yui-elite']).toEqual(ELITE_MODULES)
    expect(allowedModulesForPlan('start')).toEqual(START_MODULES)
    expect(allowedModulesForPlan('yui_pro')).toEqual(PRO_MODULES)
    expect(allowedModulesForPlan('prime')).toEqual(PRIME_MODULES)
    expect(allowedModulesForPlan('elite')).toEqual(ELITE_MODULES)
  })

  it('updates an existing tenant from the authoritative checkout order when Stripe confirms payment', async () => {
    const suffix = crypto.randomUUID()
    const tenantId = `tenant-plan-webhook-${suffix}`
    const orderId = `order-plan-webhook-${suffix}`
    const eventId = `evt_plan_webhook_${suffix}`
    const subscriptionId = `sub_plan_webhook_${suffix}`
    const now = Date.now()
    cleanup.tenantIds.push(tenantId)
    cleanup.orderIds.push(orderId)
    cleanup.eventIds.push(eventId)

    await db.batch([
      db.prepare(`INSERT INTO tenants(id,slug,name,status,created_at_ms,updated_at_ms)
        VALUES(?1,?2,'Petshop Existente','active',?3,?3)`)
        .bind(tenantId, `petshop-existente-${suffix}`, now),
      db.prepare(`INSERT INTO tenant_plan_access(
        tenant_id,plan_slug,allowed_modules_json,onboarding_completed,status,source,created_at_ms,updated_at_ms
      ) VALUES(?1,'yui-start',?2,1,'active','manual',?3,?3)`)
        .bind(tenantId, JSON.stringify(START_MODULES), now),
      db.prepare(`INSERT INTO platform_checkout_orders(
        id,request_key,tenant_id,plan_code,billing_cycle,amount_cents,currency,customer_name,customer_email,business_name,
        status,stripe_checkout_session_id,terms_accepted_at_ms,created_at_ms,updated_at_ms
      ) VALUES(?1,?2,?3,'prime','monthly',59700,'BRL','Cliente Existente',?4,'Petshop Existente','open',?5,?6,?6,?6)`)
        .bind(orderId, `request-${suffix}`, tenantId, `existing-${suffix}@billing.test`, `cs_${suffix}`, now),
    ])

    const event = {
      id: eventId,
      type: 'checkout.session.completed',
      livemode: false,
      data: {
        object: {
          id: `cs_${suffix}`,
          client_reference_id: orderId,
          customer: `cus_${suffix}`,
          subscription: subscriptionId,
          payment_status: 'paid',
          metadata: { order_id: orderId, plan_code: 'start', billing_cycle: 'monthly' },
        },
      },
    }
    const response = await handlePlatformBillingApiRequest(
      await signedWebhook(event),
      {
        DB: db,
        STRIPE_WEBHOOK_SECRET: 'whsec_tenant_plan_access',
      },
    )
    expect(response?.status).toBe(200)

    const access = await db.prepare(`SELECT plan_slug,allowed_modules_json,onboarding_completed,status,source
      FROM tenant_plan_access WHERE tenant_id=?1`).bind(tenantId).first<{
        plan_slug: string
        allowed_modules_json: string
        onboarding_completed: number
        status: string
        source: string
      }>()
    expect(access).toMatchObject({
      plan_slug: 'yui-prime-ia',
      onboarding_completed: 1,
      status: 'active',
    })
    expect(parsedModules(access!.allowed_modules_json)).toEqual(PRIME_MODULES)
    expect(access?.source).toBe('stripe')

    const subscription = await db.prepare(`SELECT tenant_id,plan_code,status FROM platform_billing_subscriptions
      WHERE stripe_subscription_id=?1`).bind(subscriptionId).first()
    expect(subscription).toMatchObject({ tenant_id: tenantId, plan_code: 'prime', status: 'active' })
  })

  it('provisions access after invitation, exposes it in bootstrap and completes onboarding atomically', async () => {
    const suffix = crypto.randomUUID()
    const orderId = `order-plan-invite-${suffix}`
    const sessionId = `cs_plan_invite_${suffix}`
    const subscriptionId = `sub_plan_invite_${suffix}`
    const email = `owner-${suffix}@plan-access.test`
    const now = Date.now()
    cleanup.orderIds.push(orderId)

    await db.batch([
      db.prepare(`INSERT INTO platform_checkout_orders(
        id,request_key,plan_code,billing_cycle,amount_cents,currency,customer_name,customer_email,business_name,
        status,stripe_checkout_session_id,stripe_subscription_id,terms_accepted_at_ms,completed_at_ms,created_at_ms,updated_at_ms
      ) VALUES(?1,?2,'pro','monthly',34700,'BRL','Responsável Teste',?3,'Petshop Plano Pro','complete',?4,?5,?6,?6,?6,?6)`)
        .bind(orderId, `request-${suffix}`, email, sessionId, subscriptionId, now),
      db.prepare(`INSERT INTO platform_billing_subscriptions(
        id,checkout_order_id,plan_code,billing_cycle,stripe_subscription_id,status,created_at_ms,updated_at_ms
      ) VALUES(?1,?2,'pro','monthly',?3,'active',?4,?4)`)
        .bind(`billing-${suffix}`, orderId, subscriptionId, now),
    ])

    let delivery = ''
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      delivery = String(init?.body || '')
      return Response.json({ id: `email-${suffix}` })
    })
    const runtime = {
      ...bindings,
      AUTH_EMAIL_API_KEY: 're_test',
      AUTH_EMAIL_FROM: 'YuiSync <no-reply@yuisync.test>',
    }
    const inviteResponse = await handleCustomerOnboardingApiRequest(
      new Request('https://edge.test/api/platform/onboarding/invitations', {
        method: 'POST',
        headers: { origin: 'https://edge.test', 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId }),
      }),
      runtime,
    )
    expect(inviteResponse?.status).toBe(201)
    const token = /convite=([^\s]+)/.exec((JSON.parse(delivery) as { text: string }).text)?.[1]
    expect(token).toBeTruthy()

    const activation = await handleCustomerOnboardingApiRequest(
      new Request('https://edge.test/api/platform/onboarding/activate', {
        method: 'POST',
        headers: { origin: 'https://edge.test', 'content-type': 'application/json' },
        body: JSON.stringify({ token, password: 'PrimeiroAcesso123!' }),
      }),
      runtime,
    )
    expect(activation?.status).toBe(201)
    const activated = await activation!.json<{ tenantId: string }>()
    cleanup.tenantIds.push(activated.tenantId)

    const order = await db.prepare('SELECT principal_id FROM platform_checkout_orders WHERE id=?1')
      .bind(orderId).first<{ principal_id: string }>()
    expect(order?.principal_id).toBeTruthy()
    cleanup.principalIds.push(order!.principal_id)
    const principal = await db.prepare('SELECT subject FROM identity_principals WHERE id=?1')
      .bind(order!.principal_id).first<{ subject: string }>()
    expect(principal?.subject).toBeTruthy()
    cleanup.userIds.push(principal!.subject)

    const access = await db.prepare(`SELECT plan_slug,allowed_modules_json,onboarding_completed,status
      FROM tenant_plan_access WHERE tenant_id=?1`).bind(activated.tenantId).first<{
        plan_slug: string
        allowed_modules_json: string
        onboarding_completed: number
        status: string
      }>()
    expect(access).toMatchObject({
      plan_slug: 'yui-pro',
      onboarding_completed: 0,
      status: 'active',
    })
    expect(parsedModules(access!.allowed_modules_json)).toEqual(PRO_MODULES)

    const getSession = vi.fn(async () => ({
      user: {
        id: principal!.subject,
        email,
        name: 'Responsável Teste',
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      session: {
        id: `session-${suffix}`,
        userId: principal!.subject,
        token: 'test-only',
        expiresAt: new Date(now + 60_000),
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    }))

    const bootstrapResponse = await handleAppApiRequest(
      new Request('https://edge.test/api/app/bootstrap'),
      { DB: db },
      { getSession: getSession as never },
    )
    expect(bootstrapResponse?.status).toBe(200)
    const bootstrap = await bootstrapResponse!.json<{
      tenants: Array<Record<string, unknown>>
    }>()
    expect(bootstrap.tenants).toContainEqual(expect.objectContaining({
      id: activated.tenantId,
      plan_slug: 'yui-pro',
      allowed_modules: PRO_MODULES,
      onboarding_status: 'in_progress',
    }))

    const firstRunUrl = `https://edge.test/api/app/first-run?tenant_id=${encodeURIComponent(activated.tenantId)}`
    const firstRunResponse = await handleCustomerOnboardingApiRequest(
      new Request(firstRunUrl),
      runtime,
      { getSession: getSession as never },
    )
    expect(firstRunResponse?.status).toBe(200)
    await expect(firstRunResponse!.json()).resolves.toMatchObject({
      plan_slug: 'yui-pro',
      allowed_modules: PRO_MODULES,
      onboarding_status: 'in_progress',
    })

    await db.prepare(`UPDATE module_settings_extensions SET data_json=?1,updated_at_ms=?2
      WHERE tenant_id=?3 AND module_id='petshop'`)
      .bind(JSON.stringify({ store_business_hours: { monday: [{ open: '08:00', close: '18:00' }] } }), Date.now(), activated.tenantId)
      .run()
    await db.prepare(`INSERT INTO services(
      tenant_id,module_id,id,code,name,group_type,default_price_cents,default_duration_min,
      commission_type,commission_basis_points,sort_order,status,created_at_ms,updated_at_ms
    ) VALUES(?1,'petshop',?2,'banho','Banho','banho_tosa',5000,60,'percentage',0,1,'active',?3,?3)`)
      .bind(activated.tenantId, `service-${suffix}`, Date.now())
      .run()

    const completion = await handleCustomerOnboardingApiRequest(
      new Request(firstRunUrl, {
        method: 'PATCH',
        headers: { origin: 'https://edge.test', 'content-type': 'application/json' },
        body: JSON.stringify({ complete: true }),
      }),
      runtime,
      { getSession: getSession as never },
    )
    expect(completion?.status).toBe(200)
    await expect(completion!.json()).resolves.toMatchObject({
      status: 'completed',
      plan_slug: 'yui-pro',
      allowed_modules: PRO_MODULES,
      onboarding_status: 'completed',
    })
    await expect(db.prepare(`SELECT onboarding_completed FROM tenant_plan_access WHERE tenant_id=?1`)
      .bind(activated.tenantId).first()).resolves.toMatchObject({ onboarding_completed: 1 })

    const completedBootstrap = await handleAppApiRequest(
      new Request('https://edge.test/api/app/bootstrap'),
      { DB: db },
      { getSession: getSession as never },
    )
    const completedPayload = await completedBootstrap!.json<{ tenants: Array<Record<string, unknown>> }>()
    expect(completedPayload.tenants).toContainEqual(expect.objectContaining({
      id: activated.tenantId,
      plan_slug: 'yui-pro',
      allowed_modules: PRO_MODULES,
      onboarding_status: 'completed',
    }))
  })
})
