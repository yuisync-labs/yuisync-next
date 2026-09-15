import { getBetterAuthSession, type BetterAuthRuntimeBindings } from './auth/betterAuthRuntime'
import { isPlatformAdmin } from './platformAuthorization'

export type PlatformBillingBindings = BetterAuthRuntimeBindings & {
  DB?: D1Database
  STRIPE_SECRET_KEY?: string
  STRIPE_WEBHOOK_SECRET?: string
  STRIPE_PRICE_START_MONTHLY?: string
  STRIPE_PRICE_START_YEARLY?: string
  STRIPE_PRICE_PRO_MONTHLY?: string
  STRIPE_PRICE_PRO_YEARLY?: string
  STRIPE_PRICE_PRIME_MONTHLY?: string
  STRIPE_PRICE_PRIME_YEARLY?: string
}

type SessionResolver = typeof getBetterAuthSession
type StripeFetch = typeof fetch
export type PlatformBillingDependencies = {
  getSession?: SessionResolver
  stripeFetch?: StripeFetch
}

type PlanCode = 'start' | 'pro' | 'prime'
type BillingCycle = 'monthly' | 'yearly'
type JsonObject = Record<string, unknown>

const MAX_CHECKOUT_BODY_BYTES = 16_384
const MAX_WEBHOOK_BODY_BYTES = 1_048_576
const WEBHOOK_TOLERANCE_SECONDS = 300

const PLAN_CATALOG: Readonly<Record<PlanCode, { amount: Readonly<Record<BillingCycle, number>>; platformPlanId: string }>> = Object.freeze({
  start: Object.freeze({ amount: Object.freeze({ monthly: 19_700, yearly: 197_000 }), platformPlanId: 'yui_start' }),
  pro: Object.freeze({ amount: Object.freeze({ monthly: 34_700, yearly: 347_000 }), platformPlanId: 'yui_pro' }),
  prime: Object.freeze({ amount: Object.freeze({ monthly: 59_700, yearly: 597_000 }), platformPlanId: 'yui_prime_ia' }),
})

function json(body: unknown, status = 200, headers?: HeadersInit): Response {
  const merged = new Headers(headers)
  merged.set('cache-control', 'no-store')
  return Response.json(body, { status, headers: merged })
}

function object(value: unknown): JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {}
}

function safeString(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

function optionalString(value: unknown, max: number): string | null {
  const normalized = safeString(value, max)
  return normalized || null
}

function validEmail(value: unknown): string | null {
  const email = safeString(value, 180).toLowerCase()
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null
}

function validRequestKey(value: string | null): string | null {
  const key = String(value || '').trim()
  return /^[A-Za-z0-9_-]{16,100}$/.test(key) ? key : null
}

function priceId(bindings: PlatformBillingBindings, plan: PlanCode, cycle: BillingCycle): string {
  const key = `STRIPE_PRICE_${plan.toUpperCase()}_${cycle.toUpperCase()}` as keyof PlatformBillingBindings
  return safeString(bindings[key], 255)
}

function checkoutConfigured(bindings: PlatformBillingBindings): boolean {
  return Boolean(safeString(bindings.STRIPE_SECRET_KEY, 255))
}

function catalogResponse(bindings: PlatformBillingBindings): Response {
  return json({
    provider: 'stripe',
    checkoutAvailable: checkoutConfigured(bindings),
    plans: (Object.keys(PLAN_CATALOG) as PlanCode[]).map((id) => ({
      id,
      cycles: (['monthly', 'yearly'] as BillingCycle[]).filter((cycle) => Boolean(priceId(bindings, id, cycle))),
    })),
  })
}

async function readJsonBody(request: Request): Promise<JsonObject | null> {
  const length = Number(request.headers.get('content-length') || 0)
  if (Number.isFinite(length) && length > MAX_CHECKOUT_BODY_BYTES) return null
  const raw = await request.text()
  if (new TextEncoder().encode(raw).byteLength > MAX_CHECKOUT_BODY_BYTES) return null
  try { return object(JSON.parse(raw)) } catch { return null }
}

function sameOriginRequest(request: Request): boolean {
  const origin = request.headers.get('origin')
  return Boolean(origin && origin === new URL(request.url).origin)
}

async function optionalTenantScope(
  request: Request,
  bindings: PlatformBillingBindings,
  getSession: SessionResolver,
): Promise<{ tenantId: string | null; principalId: string | null } | Response> {
  const tenantId = safeString(request.headers.get('x-tenant-id'), 160)
  if (!tenantId) return { tenantId: null, principalId: null }
  if (!bindings.DB) return json({ code: 'DATABASE_NOT_CONFIGURED' }, 503)

  const session = await getSession(request, bindings)
  const subject = safeString(session?.user?.id, 255)
  if (!subject) return json({ code: 'TENANT_ADMIN_REQUIRED' }, 403)
  const principal = await bindings.DB.prepare(`
    SELECT id,status FROM identity_principals
    WHERE provider='better-auth' AND subject=?1 LIMIT 1
  `).bind(subject).first<{ id: string; status: string }>()
  if (!principal || principal.status !== 'active') return json({ code: 'TENANT_ADMIN_REQUIRED' }, 403)

  const platformAdmin = await isPlatformAdmin(bindings.DB, principal)
  if (!platformAdmin) {
    const membership = await bindings.DB.prepare(`
      SELECT m.role,m.status,t.status AS tenant_status
      FROM tenant_memberships m JOIN tenants t ON t.id=m.tenant_id
      WHERE m.tenant_id=?1 AND m.principal_id=?2 LIMIT 1
    `).bind(tenantId, principal.id).first<{ role: string; status: string; tenant_status: string }>()
    if (!membership || membership.status !== 'active' || membership.tenant_status !== 'active' || !['owner', 'admin'].includes(membership.role)) {
      return json({ code: 'TENANT_ADMIN_REQUIRED' }, 403)
    }
  }
  return { tenantId, principalId: principal.id }
}

async function stripeRequest(
  bindings: PlatformBillingBindings,
  stripeFetch: StripeFetch,
  path: string,
  parameters: URLSearchParams,
  idempotencyKey: string,
): Promise<JsonObject> {
  const response = await stripeFetch(`https://api.stripe.com/v1/${path}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${bindings.STRIPE_SECRET_KEY}`,
      'content-type': 'application/x-www-form-urlencoded',
      'idempotency-key': idempotencyKey,
    },
    body: parameters,
  })
  const raw = await response.text()
  let payload: JsonObject = {}
  try { payload = object(JSON.parse(raw)) } catch { payload = {} }
  if (!response.ok) {
    const providerError = object(payload.error)
    const code = safeString(providerError.code || providerError.type, 80) || 'STRIPE_REQUEST_FAILED'
    throw new Error(code)
  }
  return payload
}

async function createCheckout(
  request: Request,
  bindings: PlatformBillingBindings,
  dependencies: PlatformBillingDependencies,
): Promise<Response> {
  if (!sameOriginRequest(request)) return json({ code: 'ORIGIN_FORBIDDEN' }, 403)
  if (!bindings.DB) return json({ code: 'DATABASE_NOT_CONFIGURED' }, 503)
  if (!checkoutConfigured(bindings)) return json({ code: 'CHECKOUT_NOT_CONFIGURED' }, 503)
  const requestKey = validRequestKey(request.headers.get('idempotency-key'))
  if (!requestKey) return json({ code: 'IDEMPOTENCY_KEY_REQUIRED' }, 400)

  const body = await readJsonBody(request)
  if (!body) return json({ code: 'INVALID_JSON' }, 400)
  const planId = safeString(body.planId, 20) as PlanCode
  const billingCycle = safeString(body.billingCycle, 20) as BillingCycle
  const plan = PLAN_CATALOG[planId]
  if (!plan || !['monthly', 'yearly'].includes(billingCycle)) return json({ code: 'INVALID_PLAN' }, 400)
  const stripePriceId = priceId(bindings, planId, billingCycle)
  if (!stripePriceId) return json({ code: 'PLAN_PRICE_NOT_CONFIGURED' }, 503)

  const customer = object(body.customer)
  const customerName = safeString(customer.name, 120)
  const customerEmail = validEmail(customer.email)
  const customerPhone = optionalString(customer.phone, 32)
  const businessName = safeString(customer.businessName, 160)
  if (!customerName || !customerEmail || !businessName) return json({ code: 'INVALID_CUSTOMER' }, 400)
  if (body.termsAccepted !== true) return json({ code: 'TERMS_REQUIRED' }, 400)

  const existing = await bindings.DB.prepare(`
    SELECT id,status,stripe_checkout_url,expires_at_ms
    FROM platform_checkout_orders WHERE request_key=?1 LIMIT 1
  `).bind(requestKey).first<{ id: string; status: string; stripe_checkout_url: string | null; expires_at_ms: number | null }>()
  if (existing) {
    const resumable = existing.status === 'open'
      && Boolean(existing.stripe_checkout_url?.startsWith('https://checkout.stripe.com/'))
      && (!existing.expires_at_ms || existing.expires_at_ms > Date.now())
    if (resumable) return json({ checkoutUrl: existing.stripe_checkout_url, orderId: existing.id, resumed: true })
    return json({ code: 'CHECKOUT_IN_PROGRESS' }, 409)
  }

  const recent = await bindings.DB.prepare(`
    SELECT COUNT(*) AS attempts FROM platform_checkout_orders
    WHERE customer_email=?1 AND created_at_ms>=?2
  `).bind(customerEmail, Date.now() - 15 * 60_000).first<{ attempts: number }>()
  if (Number(recent?.attempts || 0) >= 5) return json({ code: 'CHECKOUT_RATE_LIMITED' }, 429, { 'retry-after': '900' })

  const scope = await optionalTenantScope(request, bindings, dependencies.getSession || getBetterAuthSession)
  if (scope instanceof Response) return scope
  const orderId = `order_${crypto.randomUUID()}`
  const now = Date.now()
  await bindings.DB.prepare(`
    INSERT INTO platform_checkout_orders(
      id,request_key,tenant_id,principal_id,plan_code,billing_cycle,amount_cents,currency,
      customer_name,customer_email,customer_phone,business_name,status,terms_accepted_at_ms,created_at_ms,updated_at_ms
    ) VALUES(?1,?2,?3,?4,?5,?6,?7,'BRL',?8,?9,?10,?11,'creating',?12,?12,?12)
  `).bind(orderId, requestKey, scope.tenantId, scope.principalId, planId, billingCycle, plan.amount[billingCycle], customerName, customerEmail, customerPhone, businessName, now).run()

  const origin = new URL(request.url).origin
  const parameters = new URLSearchParams({
    mode: 'subscription',
    'line_items[0][price]': stripePriceId,
    'line_items[0][quantity]': '1',
    customer_email: customerEmail,
    client_reference_id: orderId,
    success_url: `${origin}/vendas/contratar?plano=${planId}&ciclo=${billingCycle}&status=sucesso&sessao={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/vendas/contratar?plano=${planId}&ciclo=${billingCycle}&status=cancelado`,
    allow_promotion_codes: 'true',
    billing_address_collection: 'required',
    'metadata[order_id]': orderId,
    'metadata[plan_code]': planId,
    'metadata[billing_cycle]': billingCycle,
    'subscription_data[metadata][order_id]': orderId,
    'subscription_data[metadata][plan_code]': planId,
    'subscription_data[metadata][billing_cycle]': billingCycle,
  })
  if (scope.tenantId) {
    parameters.set('metadata[tenant_id]', scope.tenantId)
    parameters.set('subscription_data[metadata][tenant_id]', scope.tenantId)
  }

  try {
    const session = await stripeRequest(bindings, dependencies.stripeFetch || fetch, 'checkout/sessions', parameters, `yuisync-${orderId}`)
    const sessionId = safeString(session.id, 255)
    const checkoutUrl = safeString(session.url, 2048)
    if (!sessionId || !checkoutUrl || !checkoutUrl.startsWith('https://checkout.stripe.com/')) throw new Error('INVALID_STRIPE_SESSION')
    const expiresAt = Number(session.expires_at || 0) * 1000 || null
    await bindings.DB.prepare(`
      UPDATE platform_checkout_orders
      SET status='open',stripe_checkout_session_id=?1,stripe_checkout_url=?2,expires_at_ms=?3,updated_at_ms=?4
      WHERE id=?5
    `).bind(sessionId, checkoutUrl, expiresAt, Date.now(), orderId).run()
    return json({ checkoutUrl, orderId }, 201)
  } catch {
    await bindings.DB.prepare("UPDATE platform_checkout_orders SET status='failed',updated_at_ms=?1 WHERE id=?2").bind(Date.now(), orderId).run()
    return json({ code: 'CHECKOUT_PROVIDER_UNAVAILABLE' }, 502)
  }
}

function hexBytes(value: string): ArrayBuffer | null {
  if (!/^[a-f0-9]+$/i.test(value) || value.length % 2 !== 0) return null
  const buffer = new ArrayBuffer(value.length / 2)
  const bytes = new Uint8Array(buffer)
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16)
  }
  return buffer
}

async function verifyWebhookSignature(rawBody: string, signatureHeader: string, secret: string): Promise<boolean> {
  const parts = signatureHeader.split(',').map((part) => part.trim())
  const timestamp = Number(parts.find((part) => part.startsWith('t='))?.slice(2) || 0)
  const signatures = parts.filter((part) => part.startsWith('v1=')).map((part) => part.slice(3))
  if (!Number.isInteger(timestamp) || Math.abs(Math.floor(Date.now() / 1000) - timestamp) > WEBHOOK_TOLERANCE_SECONDS || signatures.length === 0) return false
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify'])
  const payload = new TextEncoder().encode(`${timestamp}.${rawBody}`)
  for (const signature of signatures) {
    const bytes = hexBytes(signature)
    if (bytes && await crypto.subtle.verify('HMAC', key, bytes, payload)) return true
  }
  return false
}

function stripeId(value: unknown): string | null {
  if (typeof value === 'string') return optionalString(value, 255)
  return optionalString(object(value).id, 255)
}

function epochMillis(value: unknown): number | null {
  const number = Number(value || 0)
  return Number.isFinite(number) && number > 0 ? Math.round(number * 1000) : null
}

function subscriptionPeriod(subscription: JsonObject, key: 'current_period_start' | 'current_period_end'): number | null {
  const direct = epochMillis(subscription[key])
  if (direct) return direct
  const items = object(subscription.items)
  const first = Array.isArray(items.data) ? object(items.data[0]) : {}
  return epochMillis(first[key])
}

async function processCheckoutEvent(database: D1Database, type: string, payload: JsonObject): Promise<void> {
  const now = Date.now()
  const metadata = object(payload.metadata)
  const orderId = optionalString(payload.client_reference_id || metadata.order_id, 255)
  const sessionId = optionalString(payload.id, 255)
  if (!orderId && !sessionId) return
  const status = type === 'checkout.session.expired' ? 'expired' : 'complete'
  const customerId = stripeId(payload.customer)
  const subscriptionId = stripeId(payload.subscription)
  await database.prepare(`
    UPDATE platform_checkout_orders SET status=?1,stripe_customer_id=COALESCE(?2,stripe_customer_id),
      stripe_subscription_id=COALESCE(?3,stripe_subscription_id),completed_at_ms=CASE WHEN ?1='complete' THEN ?4 ELSE completed_at_ms END,updated_at_ms=?4
    WHERE ${orderId ? 'id=?5' : 'stripe_checkout_session_id=?5'}
  `).bind(status, customerId, subscriptionId, now, orderId || sessionId).run()

  if (status !== 'complete' || !subscriptionId || !orderId) return
  const order = await database.prepare(`
    SELECT tenant_id,plan_code,billing_cycle FROM platform_checkout_orders WHERE id=?1 LIMIT 1
  `).bind(orderId).first<{ tenant_id: string | null; plan_code: PlanCode; billing_cycle: BillingCycle }>()
  if (!order) return
  const paymentStatus = safeString(payload.payment_status, 40)
  const billingStatus = type === 'checkout.session.async_payment_succeeded' || paymentStatus === 'paid' || paymentStatus === 'no_payment_required'
    ? 'active'
    : 'incomplete'
  await database.prepare(`
    INSERT INTO platform_billing_subscriptions(
      id,checkout_order_id,tenant_id,plan_code,billing_cycle,stripe_customer_id,stripe_subscription_id,status,created_at_ms,updated_at_ms
    ) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?9)
    ON CONFLICT(stripe_subscription_id) DO UPDATE SET
      stripe_customer_id=excluded.stripe_customer_id,status=excluded.status,updated_at_ms=excluded.updated_at_ms
  `).bind(`billing_${subscriptionId}`, orderId, order.tenant_id, order.plan_code, order.billing_cycle, customerId, subscriptionId, billingStatus, now).run()
}

async function processSubscriptionEvent(database: D1Database, type: string, payload: JsonObject): Promise<void> {
  const subscriptionId = optionalString(payload.id, 255)
  if (!subscriptionId) return
  const metadata = object(payload.metadata)
  const orderId = optionalString(metadata.order_id, 255)
  const planCode = safeString(metadata.plan_code, 20) as PlanCode
  const cycle = safeString(metadata.billing_cycle, 20) as BillingCycle
  const tenantId = optionalString(metadata.tenant_id, 160)
  const customerId = stripeId(payload.customer)
  const status = type === 'customer.subscription.deleted' ? 'canceled' : safeString(payload.status, 40) || 'active'
  const now = Date.now()

  if (orderId && PLAN_CATALOG[planCode] && ['monthly', 'yearly'].includes(cycle)) {
    await database.prepare(`
      INSERT INTO platform_billing_subscriptions(
        id,checkout_order_id,tenant_id,plan_code,billing_cycle,stripe_customer_id,stripe_subscription_id,status,
        current_period_start_ms,current_period_end_ms,cancel_at_period_end,created_at_ms,updated_at_ms
      ) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?12)
      ON CONFLICT(stripe_subscription_id) DO UPDATE SET
        tenant_id=COALESCE(excluded.tenant_id,platform_billing_subscriptions.tenant_id),
        status=excluded.status,current_period_start_ms=excluded.current_period_start_ms,
        current_period_end_ms=excluded.current_period_end_ms,cancel_at_period_end=excluded.cancel_at_period_end,
        stripe_customer_id=COALESCE(excluded.stripe_customer_id,platform_billing_subscriptions.stripe_customer_id),updated_at_ms=excluded.updated_at_ms
    `).bind(`billing_${subscriptionId}`, orderId, tenantId, planCode, cycle, customerId, subscriptionId, status,
      subscriptionPeriod(payload, 'current_period_start'), subscriptionPeriod(payload, 'current_period_end'), payload.cancel_at_period_end === true ? 1 : 0, now).run()
    return
  }

  await database.prepare(`
    UPDATE platform_billing_subscriptions SET status=?1,current_period_start_ms=?2,current_period_end_ms=?3,
      cancel_at_period_end=?4,updated_at_ms=?5 WHERE stripe_subscription_id=?6
  `).bind(status, subscriptionPeriod(payload, 'current_period_start'), subscriptionPeriod(payload, 'current_period_end'), payload.cancel_at_period_end === true ? 1 : 0, now, subscriptionId).run()
}

async function processInvoiceEvent(database: D1Database, type: string, payload: JsonObject): Promise<void> {
  const parent = object(payload.parent)
  const details = object(parent.subscription_details)
  const subscriptionId = stripeId(details.subscription) || stripeId(payload.subscription)
  if (!subscriptionId) return
  const status = type === 'invoice.payment_failed' ? 'past_due' : 'active'
  await database.prepare('UPDATE platform_billing_subscriptions SET status=?1,updated_at_ms=?2 WHERE stripe_subscription_id=?3')
    .bind(status, Date.now(), subscriptionId).run()
}

async function webhook(request: Request, bindings: PlatformBillingBindings): Promise<Response> {
  if (!bindings.DB || !safeString(bindings.STRIPE_WEBHOOK_SECRET, 255)) return json({ code: 'WEBHOOK_NOT_CONFIGURED' }, 503)
  const length = Number(request.headers.get('content-length') || 0)
  if (Number.isFinite(length) && length > MAX_WEBHOOK_BODY_BYTES) return json({ code: 'PAYLOAD_TOO_LARGE' }, 413)
  const rawBody = await request.text()
  if (new TextEncoder().encode(rawBody).byteLength > MAX_WEBHOOK_BODY_BYTES) return json({ code: 'PAYLOAD_TOO_LARGE' }, 413)
  const signature = request.headers.get('stripe-signature') || ''
  if (!await verifyWebhookSignature(rawBody, signature, String(bindings.STRIPE_WEBHOOK_SECRET))) return json({ code: 'INVALID_SIGNATURE' }, 400)

  let event: JsonObject
  try { event = object(JSON.parse(rawBody)) } catch { return json({ code: 'INVALID_EVENT' }, 400) }
  const eventId = safeString(event.id, 255)
  const eventType = safeString(event.type, 120)
  if (!eventId || !eventType) return json({ code: 'INVALID_EVENT' }, 400)
  const existing = await bindings.DB.prepare('SELECT status FROM platform_stripe_webhook_events WHERE id=?1 LIMIT 1').bind(eventId).first<{ status: string }>()
  if (existing?.status === 'processed') return json({ received: true, duplicate: true })
  const now = Date.now()
  await bindings.DB.prepare(`
    INSERT INTO platform_stripe_webhook_events(id,event_type,livemode,status,received_at_ms,updated_at_ms)
    VALUES(?1,?2,?3,'processing',?4,?4)
    ON CONFLICT(id) DO UPDATE SET status='processing',error_code=NULL,updated_at_ms=excluded.updated_at_ms
  `).bind(eventId, eventType, event.livemode === true ? 1 : 0, now).run()

  try {
    const payload = object(object(event.data).object)
    if (eventType === 'checkout.session.completed' || eventType === 'checkout.session.async_payment_succeeded' || eventType === 'checkout.session.expired') {
      await processCheckoutEvent(bindings.DB, eventType, payload)
    } else if (eventType === 'customer.subscription.created' || eventType === 'customer.subscription.updated' || eventType === 'customer.subscription.deleted') {
      await processSubscriptionEvent(bindings.DB, eventType, payload)
    } else if (eventType === 'invoice.paid' || eventType === 'invoice.payment_failed') {
      await processInvoiceEvent(bindings.DB, eventType, payload)
    }
    await bindings.DB.prepare("UPDATE platform_stripe_webhook_events SET status='processed',processed_at_ms=?1,updated_at_ms=?1 WHERE id=?2").bind(Date.now(), eventId).run()
    return json({ received: true })
  } catch {
    await bindings.DB.prepare("UPDATE platform_stripe_webhook_events SET status='failed',error_code='PROCESSING_FAILED',updated_at_ms=?1 WHERE id=?2").bind(Date.now(), eventId).run()
    return json({ code: 'WEBHOOK_PROCESSING_FAILED' }, 500)
  }
}

export async function handlePlatformBillingApiRequest(
  request: Request,
  bindings: PlatformBillingBindings,
  dependencies: PlatformBillingDependencies = {},
): Promise<Response | null> {
  const { pathname } = new URL(request.url)
  if (pathname === '/api/platform/billing/catalog' && request.method === 'GET') return catalogResponse(bindings)
  if (pathname === '/api/platform/billing/checkout' && request.method === 'POST') return createCheckout(request, bindings, dependencies)
  if (pathname === '/api/webhooks/stripe' && request.method === 'POST') return webhook(request, bindings)
  if (pathname.startsWith('/api/platform/billing/') || pathname === '/api/webhooks/stripe') return json({ code: 'METHOD_NOT_ALLOWED' }, 405)
  return null
}
