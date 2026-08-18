import { getBetterAuthSession, type BetterAuthRuntimeBindings } from './auth/betterAuthRuntime'

type Bindings = BetterAuthRuntimeBindings & { DB?: D1Database }
type Scope = { tenantId: string; moduleId: string }
type Json = Record<string, unknown>

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/
const MODULE = /^[a-z0-9][a-z0-9_-]{0,63}$/
const SUBSCRIPTION_STATUSES = new Set(['pending_payment', 'active', 'paused', 'cancelled'])

function json(body: unknown, status = 200, headers?: HeadersInit): Response {
  return Response.json(body, {
    status,
    headers: { 'cache-control': 'no-store', ...Object.fromEntries(new Headers(headers).entries()) },
  })
}

function text(value: unknown): string | null {
  const normalized = String(value ?? '').trim()
  return normalized || null
}

function object(value: unknown): Json {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Json : {}
}

function hasModuleAccess(role: string, rawPermissions: string, moduleId: string): boolean {
  if (role === 'owner' || role === 'admin') return true
  try {
    const permissions = JSON.parse(rawPermissions || '{}') as Record<string, unknown>
    return permissions['*'] === true
      || permissions[moduleId] === true
      || Boolean(permissions[moduleId] && typeof permissions[moduleId] === 'object')
  } catch {
    return false
  }
}

async function resolveScope(request: Request, bindings: Bindings): Promise<{ scope?: Scope; error?: Response }> {
  if (!bindings.DB) return { error: json({ code: 'DATABASE_NOT_CONFIGURED' }, 503) }
  const tenantId = text(request.headers.get('x-tenant-id'))
  const moduleId = text(request.headers.get('x-module-id'))?.toLowerCase() || null
  if (!tenantId || !moduleId || !ID.test(tenantId) || !MODULE.test(moduleId)) {
    return { error: json({ code: 'INVALID_SCOPE' }, 400) }
  }
  const session = await getBetterAuthSession(request, bindings)
  const userId = text(session?.user?.id)
  if (!userId) return { error: json({ code: 'UNAUTHENTICATED' }, 401) }
  const principal = await bindings.DB!
    .prepare("SELECT id FROM identity_principals WHERE provider='better-auth' AND subject=?1 AND status='active' LIMIT 1")
    .bind(userId)
    .first<{ id: string }>()
  if (!principal?.id) return { error: json({ code: 'FORBIDDEN' }, 403) }
  const membership = await bindings.DB!
    .prepare("SELECT role,module_permissions_json FROM tenant_memberships WHERE tenant_id=?1 AND principal_id=?2 AND status='active' LIMIT 1")
    .bind(tenantId, principal.id)
    .first<{ role: string; module_permissions_json: string }>()
  if (!membership || !hasModuleAccess(membership.role, membership.module_permissions_json, moduleId)) {
    return { error: json({ code: 'FORBIDDEN' }, 403) }
  }
  return { scope: { tenantId, moduleId } }
}

async function bodyObject(request: Request): Promise<Json | null> {
  try {
    const parsed = await request.json()
    return object(parsed)
  } catch {
    return null
  }
}

function validDate(value: unknown): string | null {
  const normalized = text(value)
  return normalized && /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : null
}

function planPayload(row: any) {
  let services: unknown[] = []
  try { services = JSON.parse(row.services_json || '[]') } catch { services = [] }
  return {
    id: row.id,
    name: row.name,
    price: Number(row.price_cents || 0) / 100,
    billing_cycle: row.billing_cycle,
    services,
    active: row.status === 'active',
  }
}

function subscriptionPayload(row: any) {
  let servicesUsed: Record<string, unknown> = {}
  try { servicesUsed = JSON.parse(row.services_used_json || '{}') } catch { servicesUsed = {} }
  return {
    id: row.id,
    plan_id: row.plan_id,
    client_id: row.client_id,
    status: row.status,
    started_at: row.started_at_ms ? new Date(Number(row.started_at_ms)).toISOString() : null,
    next_billing_date: row.next_billing_date,
    services_used: servicesUsed,
    cancelled_at: row.cancelled_at_ms ? new Date(Number(row.cancelled_at_ms)).toISOString() : null,
  }
}

async function savePlan(request: Request, bindings: Bindings, planId: string | null): Promise<Response> {
  const resolved = await resolveScope(request, bindings)
  if (resolved.error) return resolved.error
  const body = await bodyObject(request)
  if (!body) return json({ code: 'INVALID_JSON' }, 400)
  const { tenantId, moduleId } = resolved.scope!
  const name = text(body.name)
  const billingCycle = text(body.billing_cycle) || 'monthly'
  const price = Number(body.price)
  const services = Array.isArray(body.services) ? body.services : []
  if (!name) return json({ code: 'PLAN_NAME_REQUIRED' }, 400)
  if (!Number.isFinite(price) || price < 0) return json({ code: 'INVALID_PLAN_PRICE' }, 400)
  if (!services.length) return json({ code: 'PLAN_SERVICES_REQUIRED' }, 400)
  if (!['monthly', 'quarterly'].includes(billingCycle)) return json({ code: 'INVALID_BILLING_CYCLE' }, 400)

  const id = planId || crypto.randomUUID()
  if (!ID.test(id)) return json({ code: 'INVALID_PLAN_ID' }, 400)
  const now = Date.now()
  if (planId) {
    const result = await bindings.DB!.prepare(`
      UPDATE subscription_plans
      SET name=?4,price_cents=?5,billing_cycle=?6,services_json=?7,status=?8,updated_at_ms=?9
      WHERE tenant_id=?1 AND module_id=?2 AND id=?3
    `).bind(tenantId, moduleId, id, name, Math.round(price * 100), billingCycle, JSON.stringify(services), body.active === false ? 'inactive' : 'active', now).run()
    if (!result.meta.changes) return json({ code: 'PLAN_NOT_FOUND' }, 404)
  } else {
    await bindings.DB!.prepare(`
      INSERT INTO subscription_plans(tenant_id,module_id,id,name,price_cents,billing_cycle,services_json,status,created_at_ms,updated_at_ms)
      VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?9)
    `).bind(tenantId, moduleId, id, name, Math.round(price * 100), billingCycle, JSON.stringify(services), body.active === false ? 'inactive' : 'active', now).run()
  }
  const row = await bindings.DB!.prepare(`SELECT * FROM subscription_plans WHERE tenant_id=?1 AND module_id=?2 AND id=?3 LIMIT 1`)
    .bind(tenantId, moduleId, id).first()
  return json({ plan: planPayload(row) })
}

async function saveSubscription(request: Request, bindings: Bindings, subscriptionId: string | null): Promise<Response> {
  const resolved = await resolveScope(request, bindings)
  if (resolved.error) return resolved.error
  const body = await bodyObject(request)
  if (!body) return json({ code: 'INVALID_JSON' }, 400)
  const { tenantId, moduleId } = resolved.scope!
  const planId = text(body.plan_id)
  const clientId = text(body.client_id)
  const status = text(body.status) || 'pending_payment'
  const startedAt = validDate(body.started_at)
  const nextBillingDate = validDate(body.next_billing_date)
  if (!planId || !clientId) return json({ code: 'PLAN_AND_CLIENT_REQUIRED' }, 400)
  if (!SUBSCRIPTION_STATUSES.has(status)) return json({ code: 'INVALID_SUBSCRIPTION_STATUS' }, 400)
  if (!startedAt || !nextBillingDate) return json({ code: 'INVALID_SUBSCRIPTION_DATES' }, 400)
  const plan = await bindings.DB!.prepare(`SELECT id FROM subscription_plans WHERE tenant_id=?1 AND module_id=?2 AND id=?3 AND status='active' LIMIT 1`)
    .bind(tenantId, moduleId, planId).first<{ id: string }>()
  if (!plan) return json({ code: 'PLAN_NOT_FOUND' }, 404)
  const client = await bindings.DB!.prepare(`SELECT id FROM clients WHERE tenant_id=?1 AND module_id=?2 AND id=?3 AND status='active' LIMIT 1`)
    .bind(tenantId, moduleId, clientId).first<{ id: string }>()
  if (!client) return json({ code: 'CLIENT_NOT_FOUND' }, 404)

  const id = subscriptionId || crypto.randomUUID()
  if (!ID.test(id)) return json({ code: 'INVALID_SUBSCRIPTION_ID' }, 400)
  const now = Date.now()
  const startedAtMs = Date.parse(`${startedAt}T12:00:00Z`)
  const servicesUsed = object(body.services_used)
  const cancelledAtMs = status === 'cancelled' ? now : null
  if (subscriptionId) {
    const result = await bindings.DB!.prepare(`
      UPDATE client_subscriptions
      SET plan_id=?4,client_id=?5,status=?6,started_at_ms=?7,next_billing_date=?8,services_used_json=?9,cancelled_at_ms=?10,updated_at_ms=?11
      WHERE tenant_id=?1 AND module_id=?2 AND id=?3
    `).bind(tenantId, moduleId, id, planId, clientId, status, startedAtMs, nextBillingDate, JSON.stringify(servicesUsed), cancelledAtMs, now).run()
    if (!result.meta.changes) return json({ code: 'SUBSCRIPTION_NOT_FOUND' }, 404)
  } else {
    await bindings.DB!.prepare(`
      INSERT INTO client_subscriptions(
        tenant_id,module_id,id,plan_id,client_id,status,started_at_ms,next_billing_date,services_used_json,cancelled_at_ms,created_at_ms,updated_at_ms
      ) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?11)
    `).bind(tenantId, moduleId, id, planId, clientId, status, startedAtMs, nextBillingDate, JSON.stringify(servicesUsed), cancelledAtMs, now).run()
  }
  const row = await bindings.DB!.prepare(`SELECT * FROM client_subscriptions WHERE tenant_id=?1 AND module_id=?2 AND id=?3 LIMIT 1`)
    .bind(tenantId, moduleId, id).first()
  return json({ subscription: subscriptionPayload(row) })
}

async function updateUsage(request: Request, bindings: Bindings, subscriptionId: string): Promise<Response> {
  const resolved = await resolveScope(request, bindings)
  if (resolved.error) return resolved.error
  const body = await bodyObject(request)
  if (!body) return json({ code: 'INVALID_JSON' }, 400)
  const servicesUsed = object(body.services_used)
  const { tenantId, moduleId } = resolved.scope!
  const result = await bindings.DB!.prepare(`
    UPDATE client_subscriptions SET services_used_json=?4,updated_at_ms=?5
    WHERE tenant_id=?1 AND module_id=?2 AND id=?3 AND status IN ('active','paused')
  `).bind(tenantId, moduleId, subscriptionId, JSON.stringify(servicesUsed), Date.now()).run()
  if (!result.meta.changes) return json({ code: 'SUBSCRIPTION_NOT_EDITABLE' }, 409)
  const row = await bindings.DB!.prepare(`SELECT * FROM client_subscriptions WHERE tenant_id=?1 AND module_id=?2 AND id=?3 LIMIT 1`)
    .bind(tenantId, moduleId, subscriptionId).first()
  return json({ subscription: subscriptionPayload(row) })
}

async function cancelSubscription(request: Request, bindings: Bindings, subscriptionId: string): Promise<Response> {
  const resolved = await resolveScope(request, bindings)
  if (resolved.error) return resolved.error
  const { tenantId, moduleId } = resolved.scope!
  const now = Date.now()
  const result = await bindings.DB!.prepare(`
    UPDATE client_subscriptions SET status='cancelled',cancelled_at_ms=?4,updated_at_ms=?4
    WHERE tenant_id=?1 AND module_id=?2 AND id=?3 AND status<>'cancelled'
  `).bind(tenantId, moduleId, subscriptionId, now).run()
  if (!result.meta.changes) return json({ code: 'SUBSCRIPTION_NOT_CANCELLABLE' }, 409)
  const row = await bindings.DB!.prepare(`SELECT * FROM client_subscriptions WHERE tenant_id=?1 AND module_id=?2 AND id=?3 LIMIT 1`)
    .bind(tenantId, moduleId, subscriptionId).first()
  return json({ subscription: subscriptionPayload(row) })
}

export async function handlePetshopPlansApiRequest(request: Request, bindings: Bindings): Promise<Response | null> {
  const { pathname } = new URL(request.url)
  if (pathname === '/api/petshop/plans' && request.method === 'POST') return savePlan(request, bindings, null)
  const planMatch = /^\/api\/petshop\/plans\/([^/]+)$/.exec(pathname)
  if (planMatch) {
    const id = decodeURIComponent(planMatch[1])
    if (!ID.test(id)) return json({ code: 'INVALID_PLAN_ID' }, 400)
    if (request.method === 'PATCH') return savePlan(request, bindings, id)
    return json({ code: 'METHOD_NOT_ALLOWED' }, 405, { allow: 'PATCH' })
  }

  if (pathname === '/api/petshop/subscriptions' && request.method === 'POST') return saveSubscription(request, bindings, null)
  const usageMatch = /^\/api\/petshop\/subscriptions\/([^/]+)\/usage$/.exec(pathname)
  if (usageMatch) {
    const id = decodeURIComponent(usageMatch[1])
    if (!ID.test(id)) return json({ code: 'INVALID_SUBSCRIPTION_ID' }, 400)
    if (request.method === 'PATCH') return updateUsage(request, bindings, id)
    return json({ code: 'METHOD_NOT_ALLOWED' }, 405, { allow: 'PATCH' })
  }
  const cancelMatch = /^\/api\/petshop\/subscriptions\/([^/]+)\/cancel$/.exec(pathname)
  if (cancelMatch) {
    const id = decodeURIComponent(cancelMatch[1])
    if (!ID.test(id)) return json({ code: 'INVALID_SUBSCRIPTION_ID' }, 400)
    if (request.method === 'POST') return cancelSubscription(request, bindings, id)
    return json({ code: 'METHOD_NOT_ALLOWED' }, 405, { allow: 'POST' })
  }
  const subscriptionMatch = /^\/api\/petshop\/subscriptions\/([^/]+)$/.exec(pathname)
  if (subscriptionMatch) {
    const id = decodeURIComponent(subscriptionMatch[1])
    if (!ID.test(id)) return json({ code: 'INVALID_SUBSCRIPTION_ID' }, 400)
    if (request.method === 'PATCH') return saveSubscription(request, bindings, id)
    return json({ code: 'METHOD_NOT_ALLOWED' }, 405, { allow: 'PATCH' })
  }
  return null
}
