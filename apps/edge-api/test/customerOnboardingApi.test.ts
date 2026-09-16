import { env } from 'cloudflare:workers'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { handleCustomerOnboardingApiRequest } from '../src/customerOnboardingApi'

const bindings = env as EdgeEnv & {
  DB: D1Database
  AUTH_DB: D1Database
  AUTH_EMAIL_API_KEY?: string
  AUTH_EMAIL_FROM?: string
}
const db = bindings.DB
const authDb = bindings.AUTH_DB

let cleanup: { orderId?: string; tenantId?: string; userId?: string; principalId?: string } = {}

afterEach(async () => {
  vi.restoreAllMocks()
  if (cleanup.tenantId) {
    await db.prepare('DELETE FROM support_messages WHERE tenant_id=?1').bind(cleanup.tenantId).run()
    await db.prepare('DELETE FROM support_threads WHERE tenant_id=?1').bind(cleanup.tenantId).run()
    await db.prepare('DELETE FROM tenant_first_run WHERE tenant_id=?1').bind(cleanup.tenantId).run()
    await db.prepare('DELETE FROM tenant_memberships WHERE tenant_id=?1').bind(cleanup.tenantId).run()
    await db.prepare('DELETE FROM module_settings_extensions WHERE tenant_id=?1').bind(cleanup.tenantId).run()
    await db.prepare('DELETE FROM tenant_module_settings WHERE tenant_id=?1').bind(cleanup.tenantId).run()
    await db.prepare('DELETE FROM managed_user_profiles WHERE principal_id=?1').bind(cleanup.principalId).run()
    await db.prepare('DELETE FROM profiles WHERE id=?1').bind(cleanup.principalId).run()
    await db.prepare('DELETE FROM identity_principals WHERE id=?1').bind(cleanup.principalId).run()
  }
  if (cleanup.orderId) {
    await db.prepare('DELETE FROM platform_billing_subscriptions WHERE checkout_order_id=?1').bind(cleanup.orderId).run()
    await db.prepare('DELETE FROM platform_onboarding_invitations WHERE checkout_order_id=?1').bind(cleanup.orderId).run()
    await db.prepare('DELETE FROM platform_checkout_orders WHERE id=?1').bind(cleanup.orderId).run()
  }
  if (cleanup.tenantId) await db.prepare('DELETE FROM tenants WHERE id=?1').bind(cleanup.tenantId).run()
  if (cleanup.userId) {
    await authDb.prepare('DELETE FROM session WHERE userId=?1').bind(cleanup.userId).run()
    await authDb.prepare('DELETE FROM account WHERE userId=?1').bind(cleanup.userId).run()
    await authDb.prepare('DELETE FROM user WHERE id=?1').bind(cleanup.userId).run()
  }
  cleanup = {}
})

describe('customer first-run onboarding', () => {
  it('delivers a one-time invitation and provisions an isolated owner tenant', async () => {
    const suffix = crypto.randomUUID()
    const orderId = `order_onboarding_${suffix}`
    const sessionId = `cs_onboarding_${suffix}`
    const subscriptionId = `sub_onboarding_${suffix}`
    const email = `owner-${suffix}@onboarding.test`
    const now = Date.now()
    cleanup.orderId = orderId
    await db.batch([
      db.prepare(`INSERT INTO platform_checkout_orders(
        id,request_key,plan_code,billing_cycle,amount_cents,currency,customer_name,customer_email,business_name,
        status,stripe_checkout_session_id,stripe_subscription_id,terms_accepted_at_ms,completed_at_ms,created_at_ms,updated_at_ms
      ) VALUES(?1,?2,'start','monthly',19700,'BRL','Cliente Onboarding',?3,'Petshop Onboarding','complete',?4,?5,?6,?6,?6,?6)`)
        .bind(orderId, `request_${suffix}`, email, sessionId, subscriptionId, now),
      db.prepare(`INSERT INTO platform_billing_subscriptions(
        id,checkout_order_id,plan_code,billing_cycle,stripe_subscription_id,status,created_at_ms,updated_at_ms
      ) VALUES(?1,?2,'start','monthly',?3,'active',?4,?4)`)
        .bind(`billing_${suffix}`, orderId, subscriptionId, now),
    ])

    let delivery = ''
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      delivery = String(init?.body || '')
      return Response.json({ id: 'email-test' })
    })
    const runtime = { ...bindings, AUTH_EMAIL_API_KEY: 're_test', AUTH_EMAIL_FROM: 'YuiSync <no-reply@yuisync.test>' }
    const inviteResponse = await handleCustomerOnboardingApiRequest(new Request('https://edge.test/api/platform/onboarding/invitations', {
      method: 'POST',
      headers: { origin: 'https://edge.test', 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId }),
    }), runtime)
    expect(inviteResponse?.status).toBe(201)
    const emailBody = JSON.parse(delivery) as { text: string }
    const token = /convite=([^\s]+)/.exec(emailBody.text)?.[1]
    expect(token).toBeTruthy()

    const inspection = await handleCustomerOnboardingApiRequest(
      new Request(`https://edge.test/api/platform/onboarding/invitations/${token}`),
      runtime,
    )
    expect(inspection?.status).toBe(200)
    await expect(inspection!.json()).resolves.toMatchObject({ valid: true, accountExists: false, businessName: 'Petshop Onboarding' })

    const activation = await handleCustomerOnboardingApiRequest(new Request('https://edge.test/api/platform/onboarding/activate', {
      method: 'POST',
      headers: { origin: 'https://edge.test', 'content-type': 'application/json' },
      body: JSON.stringify({ token, password: 'PrimeiroAcesso123!' }),
    }), runtime)
    expect(activation?.status).toBe(201)
    const activated = await activation!.json() as { tenantId: string }
    cleanup.tenantId = activated.tenantId

    const order = await db.prepare('SELECT tenant_id,principal_id FROM platform_checkout_orders WHERE id=?1').bind(orderId)
      .first<{ tenant_id: string; principal_id: string }>()
    cleanup.principalId = order!.principal_id
    const authUser = await authDb.prepare('SELECT id FROM user WHERE lower(email)=lower(?1)').bind(email).first<{ id: string }>()
    cleanup.userId = authUser!.id
    expect(order?.tenant_id).toBe(activated.tenantId)
    await expect(db.prepare(`SELECT role FROM tenant_memberships WHERE tenant_id=?1 AND principal_id=?2`).bind(activated.tenantId, order!.principal_id).first())
      .resolves.toMatchObject({ role: 'owner' })
    await expect(db.prepare('SELECT status,current_step FROM tenant_first_run WHERE tenant_id=?1').bind(activated.tenantId).first())
      .resolves.toMatchObject({ status: 'in_progress', current_step: 'empresa' })

    const getSession = vi.fn(async () => ({ user: { id: authUser!.id, email } }))
    const crossOriginPatch = await handleCustomerOnboardingApiRequest(new Request(
      `https://edge.test/api/app/first-run?tenant_id=${encodeURIComponent(activated.tenantId)}`,
      { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ currentStep: 'suporte' }) },
    ), runtime, { getSession: getSession as never })
    expect(crossOriginPatch?.status).toBe(403)

    const supportRequest = await handleCustomerOnboardingApiRequest(new Request(
      `https://edge.test/api/app/first-run?tenant_id=${encodeURIComponent(activated.tenantId)}`,
      {
        method: 'PATCH',
        headers: { origin: 'https://edge.test', 'content-type': 'application/json' },
        body: JSON.stringify({ supportAvailability: 'terça às 15h ou quinta às 10h', completedStep: 'suporte' }),
      },
    ), runtime, { getSession: getSession as never })
    expect(supportRequest?.status).toBe(200)
    await expect(db.prepare(`SELECT source,status,subject FROM support_threads WHERE tenant_id=?1 AND id=?2`)
      .bind(activated.tenantId, `first-run-${activated.tenantId}`).first())
      .resolves.toMatchObject({ source: 'first_run', status: 'pending', subject: 'Sessão de implantação' })

    const prematureCompletion = await handleCustomerOnboardingApiRequest(new Request(
      `https://edge.test/api/app/first-run?tenant_id=${encodeURIComponent(activated.tenantId)}`,
      {
        method: 'PATCH',
        headers: { origin: 'https://edge.test', 'content-type': 'application/json' },
        body: JSON.stringify({ complete: true }),
      },
    ), runtime, { getSession: getSession as never })
    expect(prematureCompletion?.status).toBe(409)

    const replay = await handleCustomerOnboardingApiRequest(new Request(`https://edge.test/api/platform/onboarding/invitations/${token}`), runtime)
    expect(replay?.status).toBe(404)
  })

  it('links an existing account without removing its global profile permissions', async () => {
    const suffix = crypto.randomUUID()
    const orderId = `order_existing_${suffix}`
    const sessionId = `cs_existing_${suffix}`
    const subscriptionId = `sub_existing_${suffix}`
    const userId = `auth-existing-${suffix}`
    const principalId = `principal-existing-${suffix}`
    const email = `existing-${suffix}@onboarding.test`
    const now = Date.now()
    const nowIso = new Date(now).toISOString()
    cleanup = { orderId, userId, principalId }

    await authDb.prepare(`INSERT INTO user(id,name,email,emailVerified,image,createdAt,updatedAt)
      VALUES(?1,'Administradora Existente',?2,1,NULL,?3,?3)`).bind(userId, email, nowIso).run()
    await db.batch([
      db.prepare(`INSERT INTO identity_principals(id,provider,subject,display_name,email,status,created_at_ms,updated_at_ms)
        VALUES(?1,'better-auth',?2,'Administradora Existente',?3,'active',?4,?4)`)
        .bind(principalId, userId, email, now),
      db.prepare(`INSERT INTO profiles(id,full_name,email,role,active,allowed_modules,module_permissions,created_at,updated_at)
        VALUES(?1,'Administradora Existente',?2,'admin',1,'["system"]','{}',?3,?3)`)
        .bind(principalId, email, nowIso),
      db.prepare(`INSERT INTO platform_checkout_orders(
        id,request_key,plan_code,billing_cycle,amount_cents,currency,customer_name,customer_email,business_name,
        status,stripe_checkout_session_id,stripe_subscription_id,terms_accepted_at_ms,completed_at_ms,created_at_ms,updated_at_ms
      ) VALUES(?1,?2,'pro','monthly',34700,'BRL','Administradora Existente',?3,'Petshop Conta Existente','complete',?4,?5,?6,?6,?6,?6)`)
        .bind(orderId, `request_${suffix}`, email, sessionId, subscriptionId, now),
      db.prepare(`INSERT INTO platform_billing_subscriptions(
        id,checkout_order_id,plan_code,billing_cycle,stripe_subscription_id,status,created_at_ms,updated_at_ms
      ) VALUES(?1,?2,'pro','monthly',?3,'active',?4,?4)`)
        .bind(`billing_${suffix}`, orderId, subscriptionId, now),
    ])

    let delivery = ''
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      delivery = String(init?.body || '')
      return Response.json({ id: 'email-existing' })
    })
    const runtime = { ...bindings, AUTH_EMAIL_API_KEY: 're_test', AUTH_EMAIL_FROM: 'YuiSync <no-reply@yuisync.test>' }
    const inviteResponse = await handleCustomerOnboardingApiRequest(new Request('https://edge.test/api/platform/onboarding/invitations', {
      method: 'POST',
      headers: { origin: 'https://edge.test', 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId }),
    }), runtime)
    expect(inviteResponse?.status).toBe(201)
    const token = /convite=([^\s]+)/.exec((JSON.parse(delivery) as { text: string }).text)?.[1]
    expect(token).toBeTruthy()

    const claim = await handleCustomerOnboardingApiRequest(new Request('https://edge.test/api/platform/onboarding/claim', {
      method: 'POST',
      headers: { origin: 'https://edge.test', 'content-type': 'application/json' },
      body: JSON.stringify({ token }),
    }), runtime, { getSession: (async () => ({ user: { id: userId, email } })) as never })
    expect(claim?.status).toBe(200)
    const claimed = await claim!.json() as { tenantId: string }
    cleanup.tenantId = claimed.tenantId

    await expect(db.prepare('SELECT role,allowed_modules FROM profiles WHERE id=?1').bind(principalId).first())
      .resolves.toMatchObject({ role: 'admin', allowed_modules: '["system"]' })
    await expect(db.prepare('SELECT role FROM tenant_memberships WHERE tenant_id=?1 AND principal_id=?2')
      .bind(claimed.tenantId, principalId).first()).resolves.toMatchObject({ role: 'owner' })
  })
})
