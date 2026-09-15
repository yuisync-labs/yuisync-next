import { env } from 'cloudflare:workers'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { handlePlatformBillingApiRequest } from '../src/platformBillingApi'

const db = (env as EdgeEnv & { DB: D1Database }).DB

const configuredBindings = () => ({
  DB: db,
  STRIPE_SECRET_KEY: 'sk_test_local_only',
  STRIPE_WEBHOOK_SECRET: 'whsec_local_only',
  STRIPE_PRICE_START_MONTHLY: 'price_start_monthly',
  STRIPE_PRICE_START_YEARLY: 'price_start_yearly',
  STRIPE_PRICE_PRO_MONTHLY: 'price_pro_monthly',
  STRIPE_PRICE_PRO_YEARLY: 'price_pro_yearly',
  STRIPE_PRICE_PRIME_MONTHLY: 'price_prime_monthly',
  STRIPE_PRICE_PRIME_YEARLY: 'price_prime_yearly',
}) as never

afterEach(async () => {
  await db.prepare("DELETE FROM platform_billing_subscriptions WHERE checkout_order_id LIKE 'order_test_%' OR checkout_order_id IN (SELECT id FROM platform_checkout_orders WHERE customer_email LIKE '%@billing.test')").run()
  await db.prepare("DELETE FROM platform_checkout_orders WHERE id LIKE 'order_test_%' OR customer_email LIKE '%@billing.test'").run()
  await db.prepare("DELETE FROM platform_stripe_webhook_events WHERE id LIKE 'evt_test_%'").run()
  vi.restoreAllMocks()
})

function checkoutRequest(overrides: Record<string, unknown> = {}, idempotencyKey: string = crypto.randomUUID()) {
  return new Request('https://edge.test/api/platform/billing/checkout', {
    method: 'POST',
    headers: {
      origin: 'https://edge.test',
      'content-type': 'application/json',
      'idempotency-key': idempotencyKey,
    },
    body: JSON.stringify({
      planId: 'start',
      billingCycle: 'monthly',
      customer: {
        name: 'Cliente Teste',
        email: 'cliente@billing.test',
        phone: '(32) 99999-9999',
        businessName: 'Petshop Teste',
      },
      termsAccepted: true,
      ...overrides,
    }),
  })
}

async function signedWebhook(payload: Record<string, unknown>, secret = 'whsec_local_only') {
  const raw = JSON.stringify(payload)
  const timestamp = Math.floor(Date.now() / 1000)
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const digest = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${timestamp}.${raw}`))
  const signature = Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('')
  return new Request('https://edge.test/api/webhooks/stripe', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'stripe-signature': `t=${timestamp},v1=${signature}` },
    body: raw,
  })
}

describe('platform Stripe billing API', () => {
  it('publishes only server-configured checkout cycles', async () => {
    const response = await handlePlatformBillingApiRequest(
      new Request('https://edge.test/api/platform/billing/catalog'),
      { STRIPE_SECRET_KEY: 'sk_test', STRIPE_PRICE_START_MONTHLY: 'price_start' } as never,
    )
    expect(response?.status).toBe(200)
    const payload = await response!.json() as { provider: string; checkoutAvailable: boolean; plans: Array<{ id: string; cycles: string[] }> }
    expect(payload).toMatchObject({ provider: 'stripe', checkoutAvailable: true })
    expect(payload.plans.find((plan) => plan.id === 'start')?.cycles).toEqual(['monthly'])
    expect(payload.plans.find((plan) => plan.id === 'pro')?.cycles).toEqual([])
  })

  it('creates a server-priced Stripe Checkout Session without trusting an amount from the browser', async () => {
    let postedBody = ''
    const stripeFetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      postedBody = String(init?.body || '')
      return Response.json({
        id: 'cs_test_yuisync',
        url: 'https://checkout.stripe.com/c/pay/cs_test_yuisync',
        expires_at: Math.floor(Date.now() / 1000) + 1800,
      })
    })

    const response = await handlePlatformBillingApiRequest(
      checkoutRequest({ amount: 1 }),
      configuredBindings(),
      { stripeFetch: stripeFetch as never },
    )
    expect(response?.status).toBe(201)
    const payload = await response!.json() as { checkoutUrl: string; orderId: string }
    expect(payload.checkoutUrl).toContain('checkout.stripe.com')
    expect(postedBody).toContain('line_items%5B0%5D%5Bprice%5D=price_start_monthly')
    expect(postedBody).not.toContain('amount=1')

    const order = await db.prepare('SELECT amount_cents,status,stripe_checkout_session_id FROM platform_checkout_orders WHERE id=?1')
      .bind(payload.orderId).first<{ amount_cents: number; status: string; stripe_checkout_session_id: string }>()
    expect(order).toEqual({ amount_cents: 19_700, status: 'open', stripe_checkout_session_id: 'cs_test_yuisync' })
  })

  it('resumes the same unexpired Checkout Session for an idempotent browser retry', async () => {
    const requestKey = 'checkout_retry_test_1234'
    const stripeFetch = vi.fn(async () => Response.json({
      id: 'cs_test_retry',
      url: 'https://checkout.stripe.com/c/pay/cs_test_retry',
      expires_at: Math.floor(Date.now() / 1000) + 1800,
    }))
    const first = await handlePlatformBillingApiRequest(checkoutRequest({}, requestKey), configuredBindings(), { stripeFetch: stripeFetch as never })
    const second = await handlePlatformBillingApiRequest(checkoutRequest({}, requestKey), configuredBindings(), { stripeFetch: stripeFetch as never })

    expect(first?.status).toBe(201)
    expect(second?.status).toBe(200)
    await expect(second!.json()).resolves.toMatchObject({
      checkoutUrl: 'https://checkout.stripe.com/c/pay/cs_test_retry',
      resumed: true,
    })
    expect(stripeFetch).toHaveBeenCalledTimes(1)
  })

  it('rejects cross-origin checkout creation before calling Stripe', async () => {
    const request = checkoutRequest()
    const headers = new Headers(request.headers)
    headers.set('origin', 'https://attacker.test')
    const response = await handlePlatformBillingApiRequest(new Request(request, { headers }), configuredBindings())
    expect(response?.status).toBe(403)
    await expect(response!.json()).resolves.toMatchObject({ code: 'ORIGIN_FORBIDDEN' })
  })

  it('verifies the raw webhook signature and reconciles checkout idempotently', async () => {
    const now = Date.now()
    await db.prepare(`
      INSERT INTO platform_checkout_orders(
        id,request_key,plan_code,billing_cycle,amount_cents,currency,customer_name,customer_email,business_name,
        status,stripe_checkout_session_id,terms_accepted_at_ms,created_at_ms,updated_at_ms
      ) VALUES('order_test_webhook','request_test_webhook_1234','start','monthly',19700,'BRL','Cliente','webhook@billing.test','Petshop','open','cs_test_webhook',?1,?1,?1)
    `).bind(now).run()
    const event = {
      id: 'evt_test_checkout_completed',
      type: 'checkout.session.completed',
      livemode: false,
      data: { object: {
        id: 'cs_test_webhook',
        client_reference_id: 'order_test_webhook',
        customer: 'cus_test_yuisync',
        subscription: 'sub_test_yuisync',
        payment_status: 'paid',
        metadata: { order_id: 'order_test_webhook', plan_code: 'start', billing_cycle: 'monthly' },
      } },
    }

    const first = await handlePlatformBillingApiRequest(await signedWebhook(event), configuredBindings())
    expect(first?.status).toBe(200)
    const second = await handlePlatformBillingApiRequest(await signedWebhook(event), configuredBindings())
    expect(second?.status).toBe(200)
    await expect(second!.json()).resolves.toMatchObject({ duplicate: true })

    const order = await db.prepare('SELECT status,stripe_subscription_id FROM platform_checkout_orders WHERE id=?1')
      .bind('order_test_webhook').first<{ status: string; stripe_subscription_id: string }>()
    expect(order).toEqual({ status: 'complete', stripe_subscription_id: 'sub_test_yuisync' })
    const subscriptions = await db.prepare("SELECT COUNT(*) AS count FROM platform_billing_subscriptions WHERE stripe_subscription_id='sub_test_yuisync'").first<{ count: number }>()
    expect(subscriptions?.count).toBe(1)
  })

  it('rejects a webhook with an invalid signature without persisting it', async () => {
    const request = await signedWebhook({ id: 'evt_test_invalid', type: 'checkout.session.completed', data: { object: {} } }, 'wrong_secret')
    const response = await handlePlatformBillingApiRequest(request, configuredBindings())
    expect(response?.status).toBe(400)
    const row = await db.prepare("SELECT id FROM platform_stripe_webhook_events WHERE id='evt_test_invalid'").first()
    expect(row).toBeNull()
  })
})
