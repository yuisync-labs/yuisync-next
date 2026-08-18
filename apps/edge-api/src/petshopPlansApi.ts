import { getBetterAuthSession, type BetterAuthRuntimeBindings } from './auth/betterAuthRuntime'

type Bindings = BetterAuthRuntimeBindings & { DB?: D1Database }
type Scope = { tenantId: string; moduleId: string }
type Json = Record<string, unknown>
type UsageMap = Record<string, number>

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

function integer(value: unknown): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : 0
}

function parseObject(value: unknown): Json {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Json
  try {
    return object(JSON.parse(String(value || '{}')))
  } catch {
    return {}
  }
}

function numericObject(value: unknown): UsageMap {
  return Object.fromEntries(Object.entries(parseObject(value)).map(([key, raw]) => [key, integer(raw)]))
}

function parseArray(value: unknown): Json[] {
  if (Array.isArray(value)) return value.filter((item): item is Json => Boolean(item && typeof item === 'object' && !Array.isArray(item)))
  try {
    const parsed = JSON.parse(String(value || '[]'))
    return Array.isArray(parsed) ? parsed.filter((item): item is Json => Boolean(item && typeof item === 'object' && !Array.isArray(item))) : []
  } catch {
    return []
  }
}

function planUsageKey(service: Json): string | null {
  return text(service.service_type) || text(service.service_code) || text(service.code)
}

function planUsageLimit(service: Json): number {
  return integer(service.qty_per_cycle ?? service.quantity ?? service.qty)
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
  const services = parseArray(row?.services_json)
  return {
    id: row?.id,
    name: row?.name,
    price: Number(row?.price_cents || 0) / 100,
    billing_cycle: row?.billing_cycle,
    services,
    active: row?.status === 'active',
  }
}

function clientPayload(row: any) {
  const details = parseObject(row?.client_details_json)
  return {
    id: row?.client_id,
    owner_name: row?.client_name || '',
    name: row?.client_name || '',
    phone: row?.client_phone || '',
    email: row?.client_email || '',
    owner_address: row?.client_address || '',
    owner_neighborhood: row?.client_neighborhood || '',
    owner_city: row?.client_city || '',
    details,
    pet_name: text(details.pet_name) || row?.client_name || '',
    species: text(details.species) || 'other',
    breed: text(details.breed) || '',
  }
}

function usageProjection(base: UsageMap, consumed: UsageMap): UsageMap {
  const keys = new Set([...Object.keys(base), ...Object.keys(consumed)])
  return Object.fromEntries([...keys].map((key) => [key, integer(base[key]) + integer(consumed[key])]))
}

function subscriptionPayload(row: any, usage?: { base: UsageMap; reserved: UsageMap; consumed: UsageMap }) {
  const base = usage?.base || numericObject(row?.benefit_ledger_base_used_json)
  const consumed = usage?.consumed || {}
  const servicesUsed = usage ? usageProjection(base, consumed) : numericObject(row?.services_used_json)
  const payload: Record<string, unknown> = {
    id: row?.id,
    plan_id: row?.plan_id,
    client_id: row?.client_id,
    status: row?.status,
    started_at: row?.started_at_ms ? new Date(Number(row.started_at_ms)).toISOString() : null,
    next_billing_date: row?.next_billing_date,
    services_used: servicesUsed,
    services_reserved: usage?.reserved || {},
    services_consumed: consumed,
    cancelled_at: row?.cancelled_at_ms ? new Date(Number(row.cancelled_at_ms)).toISOString() : null,
  }
  if (row?.plan_name !== undefined) {
    payload.subscription_plans = planPayload({
      id: row.plan_id,
      name: row.plan_name,
      price_cents: row.plan_price_cents,
      billing_cycle: row.plan_billing_cycle,
      services_json: row.plan_services_json,
      status: row.plan_status,
    })
  }
  if (row?.client_name !== undefined) payload.client = clientPayload(row)
  return payload
}

async function allocationUsage(bindings: Bindings, scope: Scope, subscriptionIds: string[]): Promise<Map<string, { reserved: UsageMap; consumed: UsageMap }>> {
  const result = new Map<string, { reserved: UsageMap; consumed: UsageMap }>()
  if (!subscriptionIds.length) return result
  const placeholders = subscriptionIds.map((_, index) => `?${index + 3}`).join(',')
  const rows = await bindings.DB!.prepare(`
    SELECT subscription_id,benefit_key,state,COUNT(*) AS quantity
    FROM subscription_benefit_allocations
    WHERE tenant_id=?1 AND module_id=?2 AND subscription_id IN (${placeholders})
      AND state IN ('reserved','consumed')
    GROUP BY subscription_id,benefit_key,state
  `).bind(scope.tenantId, scope.moduleId, ...subscriptionIds).all<{ subscription_id: string; benefit_key: string; state: 'reserved' | 'consumed'; quantity: number }>()
  for (const row of rows.results) {
    const usage = result.get(row.subscription_id) || { reserved: {}, consumed: {} }
    usage[row.state][row.benefit_key] = integer(row.quantity)
    result.set(row.subscription_id, usage)
  }
  return result
}

async function listPlans(request: Request, bindings: Bindings): Promise<Response> {
  const resolved = await resolveScope(request, bindings)
  if (resolved.error) return resolved.error
  const { tenantId, moduleId } = resolved.scope!
  const rows = await bindings.DB!.prepare(`
    SELECT * FROM subscription_plans
    WHERE tenant_id=?1 AND module_id=?2
    ORDER BY price_cents ASC,name ASC,id ASC
  `).bind(tenantId, moduleId).all()
  return json({ plans: rows.results.map(planPayload) })
}

async function listSubscriptions(request: Request, bindings: Bindings): Promise<Response> {
  const resolved = await resolveScope(request, bindings)
  if (resolved.error) return resolved.error
  const scope = resolved.scope!
  const rows = await bindings.DB!.prepare(`
    SELECT
      subscription.*,
      plan.name AS plan_name,plan.price_cents AS plan_price_cents,
      plan.billing_cycle AS plan_billing_cycle,plan.services_json AS plan_services_json,plan.status AS plan_status,
      client.name AS client_name,client.phone AS client_phone,client.email AS client_email,
      client.address AS client_address,client.neighborhood AS client_neighborhood,client.city AS client_city,
      client.details_json AS client_details_json
    FROM client_subscriptions subscription
    JOIN subscription_plans plan
      ON plan.tenant_id=subscription.tenant_id AND plan.module_id=subscription.module_id AND plan.id=subscription.plan_id
    JOIN clients client
      ON client.tenant_id=subscription.tenant_id AND client.module_id=subscription.module_id AND client.id=subscription.client_id
    WHERE subscription.tenant_id=?1 AND subscription.module_id=?2
    ORDER BY subscription.started_at_ms DESC,subscription.id DESC
  `).bind(scope.tenantId, scope.moduleId).all<any>()
  const usageBySubscription = await allocationUsage(bindings, scope, rows.results.map((row) => String(row.id)))
  return json({
    subscriptions: rows.results.map((row) => {
      const allocation = usageBySubscription.get(String(row.id)) || { reserved: {}, consumed: {} }
      return subscriptionPayload(row, {
        base: numericObject(row.benefit_ledger_base_used_json),
        reserved: allocation.reserved,
        consumed: allocation.consumed,
      })
    }),
  })
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
  const servicesUsed = numericObject(body.services_used)
  const cancelledAtMs = status === 'cancelled' ? now : null
  if (subscriptionId) {
    const result = await bindings.DB!.prepare(`
      UPDATE client_subscriptions
      SET plan_id=?4,client_id=?5,status=?6,started_at_ms=?7,next_billing_date=?8,
          benefit_ledger_base_used_json=?9,cancelled_at_ms=?10,updated_at_ms=?11
      WHERE tenant_id=?1 AND module_id=?2 AND id=?3
    `).bind(tenantId, moduleId, id, planId, clientId, status, startedAtMs, nextBillingDate, JSON.stringify(servicesUsed), cancelledAtMs, now).run()
    if (!result.meta.changes) return json({ code: 'SUBSCRIPTION_NOT_FOUND' }, 404)
  } else {
    await bindings.DB!.prepare(`
      INSERT INTO client_subscriptions(
        tenant_id,module_id,id,plan_id,client_id,status,started_at_ms,next_billing_date,
        services_used_json,cancelled_at_ms,created_at_ms,updated_at_ms,benefit_ledger_base_used_json
      ) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?11,?9)
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
  const requestedTotals = numericObject(body.services_used)
  const scope = resolved.scope!

  const subscription = await bindings.DB!.prepare(`
    SELECT subscription.id,subscription.status,subscription.benefit_ledger_base_used_json,
           plan.services_json
    FROM client_subscriptions subscription
    JOIN subscription_plans plan
      ON plan.tenant_id=subscription.tenant_id AND plan.module_id=subscription.module_id AND plan.id=subscription.plan_id
    WHERE subscription.tenant_id=?1 AND subscription.module_id=?2 AND subscription.id=?3
    LIMIT 1
  `).bind(scope.tenantId, scope.moduleId, subscriptionId).first<{
    id: string; status: string; benefit_ledger_base_used_json: string; services_json: string
  }>()
  if (!subscription || !['active', 'paused'].includes(subscription.status)) {
    return json({ code: 'SUBSCRIPTION_NOT_EDITABLE' }, 409)
  }

  const planServices = parseArray(subscription.services_json)
  const limits = new Map<string, number>()
  for (const service of planServices) {
    const key = planUsageKey(service)
    if (key) limits.set(key, planUsageLimit(service))
  }
  const unknownKeys = Object.keys(requestedTotals).filter((key) => !limits.has(key))
  if (unknownKeys.length) return json({ code: 'UNKNOWN_PACKAGE_BENEFIT', keys: unknownKeys }, 400)

  const allocation = await allocationUsage(bindings, scope, [subscriptionId])
  const counts = allocation.get(subscriptionId) || { reserved: {}, consumed: {} }
  const currentBase = numericObject(subscription.benefit_ledger_base_used_json)
  const nextBase: UsageMap = { ...currentBase }

  for (const [key, limit] of limits) {
    const consumed = integer(counts.consumed[key])
    const reserved = integer(counts.reserved[key])
    const currentTotal = integer(currentBase[key]) + consumed
    const requestedTotal = Object.prototype.hasOwnProperty.call(requestedTotals, key)
      ? integer(requestedTotals[key])
      : currentTotal
    if (requestedTotal < consumed) {
      return json({
        code: 'PACKAGE_USAGE_BELOW_CONSUMED',
        message: `O consumo de ${key} não pode ficar abaixo de ${consumed}, pois existem atendimentos concluídos vinculados ao pacote.`,
        benefit_key: key,
        consumed,
        requested: requestedTotal,
      }, 409)
    }
    if (requestedTotal + reserved > limit) {
      return json({
        code: 'PACKAGE_USAGE_RESERVED_CONFLICT',
        message: `${reserved} unidade(s) de ${key} estão reservadas em agendamento aberto. O máximo utilizado agora é ${Math.max(0, limit - reserved)}.`,
        benefit_key: key,
        limit,
        reserved,
        consumed,
        requested: requestedTotal,
      }, 409)
    }
    nextBase[key] = requestedTotal - consumed
  }

  try {
    const result = await bindings.DB!.prepare(`
      UPDATE client_subscriptions
      SET benefit_ledger_base_used_json=?4,updated_at_ms=?5
      WHERE tenant_id=?1 AND module_id=?2 AND id=?3 AND status IN ('active','paused')
    `).bind(scope.tenantId, scope.moduleId, subscriptionId, JSON.stringify(nextBase), Date.now()).run()
    if (!result.meta.changes) return json({ code: 'SUBSCRIPTION_NOT_EDITABLE' }, 409)
  } catch (error) {
    if (String(error).includes('PACKAGE_USAGE_RESERVED_CONFLICT')) {
      return json({ code: 'PACKAGE_USAGE_RESERVED_CONFLICT' }, 409)
    }
    throw error
  }

  const row = await bindings.DB!.prepare(`SELECT * FROM client_subscriptions WHERE tenant_id=?1 AND module_id=?2 AND id=?3 LIMIT 1`)
    .bind(scope.tenantId, scope.moduleId, subscriptionId).first()
  const refreshed = await allocationUsage(bindings, scope, [subscriptionId])
  const refreshedCounts = refreshed.get(subscriptionId) || { reserved: {}, consumed: {} }
  return json({ subscription: subscriptionPayload(row, {
    base: numericObject((row as any)?.benefit_ledger_base_used_json),
    reserved: refreshedCounts.reserved,
    consumed: refreshedCounts.consumed,
  }) })
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
  if (pathname === '/api/petshop/plans') {
    if (request.method === 'GET') return listPlans(request, bindings)
    if (request.method === 'POST') return savePlan(request, bindings, null)
    return json({ code: 'METHOD_NOT_ALLOWED' }, 405, { allow: 'GET, POST' })
  }
  const planMatch = /^\/api\/petshop\/plans\/([^/]+)$/.exec(pathname)
  if (planMatch) {
    const id = decodeURIComponent(planMatch[1])
    if (!ID.test(id)) return json({ code: 'INVALID_PLAN_ID' }, 400)
    if (request.method === 'PATCH') return savePlan(request, bindings, id)
    return json({ code: 'METHOD_NOT_ALLOWED' }, 405, { allow: 'PATCH' })
  }

  if (pathname === '/api/petshop/subscriptions') {
    if (request.method === 'GET') return listSubscriptions(request, bindings)
    if (request.method === 'POST') return saveSubscription(request, bindings, null)
    return json({ code: 'METHOD_NOT_ALLOWED' }, 405, { allow: 'GET, POST' })
  }
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
