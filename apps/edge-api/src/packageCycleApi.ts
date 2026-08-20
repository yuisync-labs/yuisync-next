import { getBetterAuthSession, type BetterAuthRuntimeBindings } from './auth/betterAuthRuntime'
import { billingAppointmentStatement } from './appointmentBillingCoreStatement'
import { billingAllocationStatements } from './appointmentBillingAllocationStatements'
import { resolveBillingCatalog, type BillingService } from './appointmentBillingCatalog'
import { billingServiceStatement } from './appointmentBillingServiceStatement'
import { billingTransportStatements } from './appointmentBillingTransportStatements'
import type { BenefitAllocation } from './subscriptionBenefitResolver'

type Bindings = BetterAuthRuntimeBindings & { DB?: D1Database }
type Scope = { tenantId: string; moduleId: string }
type Json = Record<string, unknown>
type Payment = { method: 'pix' | 'cash' | 'card'; amountCents: number }
type PlanEntry = Json & { key: string; code: string; qty: number; transport: boolean }

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/
const MODULE = /^[a-z0-9][a-z0-9_-]{0,63}$/
const CYCLE_PREFIX = 'package_cycle:'
const CHECKOUT_RPC = 'checkout_petshop_subscription_transaction'

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { 'cache-control': 'no-store' } })
}
function object(value: unknown): Json {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Json : {}
}
function text(value: unknown): string | null {
  const normalized = String(value ?? '').trim()
  return normalized || null
}
function integer(value: unknown, fallback = 0): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : fallback
}
function cents(value: unknown): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : 0
}
function parseJsonObject(value: unknown): Json {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Json
  try { return object(JSON.parse(String(value || '{}'))) } catch { return {} }
}
function parseJsonArray(value: unknown): Json[] {
  if (Array.isArray(value)) return value.map(object)
  try {
    const parsed = JSON.parse(String(value || '[]'))
    return Array.isArray(parsed) ? parsed.map(object) : []
  } catch { return [] }
}
function normalize(value: unknown): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}
function cycleId(subscriptionId: string): string { return `${CYCLE_PREFIX}${subscriptionId}` }
function validDate(value: unknown): string | null {
  const raw = text(value)
  return raw && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null
}
function validIso(value: unknown): string | null {
  const raw = text(value)
  if (!raw) return null
  const parsed = Date.parse(raw)
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null
}
function planEntries(raw: unknown): PlanEntry[] {
  return parseJsonArray(raw).map((entry) => {
    const key = text(entry.service_type) || text(entry.service_code) || text(entry.code) || ''
    const code = text(entry.service_code) || text(entry.code) || text(entry.service_type) || ''
    return { ...entry, key, code, qty: integer(entry.qty_per_cycle ?? entry.quantity ?? entry.qty), transport: normalize(key) === 'motodog' }
  }).filter((entry) => entry.key && entry.code && entry.qty > 0)
}
function normalizePaymentMethod(value: unknown): Payment['method'] | null {
  const method = normalize(value)
  if (method === 'pix') return 'pix'
  if (method === 'cash' || method === 'dinheiro') return 'cash'
  if (['card', 'credito', 'debito', 'cartao'].includes(method)) return 'card'
  return null
}
function paymentInputs(payload: Json, totalCents: number): Payment[] | Response {
  if (totalCents <= 0) return []
  const splits = Array.isArray(payload.payment_splits) ? payload.payment_splits : []
  if (splits.length) {
    const payments: Payment[] = []
    for (const raw of splits) {
      const split = object(raw)
      const amountCents = cents(split.amount)
      const method = normalizePaymentMethod(split.method)
      if (amountCents <= 0) return json({ code: 'INVALID_PAYMENT_AMOUNT' }, 400)
      if (!method) return json({ code: 'INVALID_PAYMENT_METHOD' }, 400)
      payments.push({ method, amountCents })
    }
    const informed = payments.reduce((sum, payment) => sum + payment.amountCents, 0)
    if (informed !== totalCents) return json({ code: 'PAYMENT_TOTAL_MISMATCH', expected_cents: totalCents, informed_cents: informed }, 409)
    return payments
  }
  const method = normalizePaymentMethod(payload.payment_method)
  if (!method) return json({ code: 'INVALID_PAYMENT_METHOD' }, 400)
  return [{ method, amountCents: totalCents }]
}
function moduleAllowed(role: string, rawPermissions: string, moduleId: string): boolean {
  if (role === 'owner' || role === 'admin') return true
  try {
    const permissions = parseJsonObject(rawPermissions)
    return permissions['*'] === true || permissions[moduleId] === true || Boolean(permissions[moduleId] && typeof permissions[moduleId] === 'object')
  } catch { return false }
}
async function resolveScope(request: Request, env: Bindings): Promise<{ scope?: Scope; error?: Response }> {
  if (!env.DB) return { error: json({ code: 'DATABASE_NOT_CONFIGURED' }, 503) }
  const tenantId = text(request.headers.get('x-tenant-id'))
  const moduleId = text(request.headers.get('x-module-id'))?.toLowerCase() || null
  if (!tenantId || !moduleId || !ID.test(tenantId) || !MODULE.test(moduleId)) return { error: json({ code: 'INVALID_SCOPE' }, 400) }
  if (moduleId !== 'petshop') return { error: json({ code: 'PETSHOP_MODULE_REQUIRED' }, 400) }
  const session = await getBetterAuthSession(request, env)
  const userId = text(session?.user?.id)
  if (!userId) return { error: json({ code: 'UNAUTHENTICATED' }, 401) }
  const principal = await env.DB.prepare("SELECT id FROM identity_principals WHERE provider='better-auth' AND subject=?1 AND status='active' LIMIT 1")
    .bind(userId).first<{ id: string }>()
  if (!principal?.id) return { error: json({ code: 'FORBIDDEN' }, 403) }
  const membership = await env.DB.prepare("SELECT role,module_permissions_json FROM tenant_memberships WHERE tenant_id=?1 AND principal_id=?2 AND status='active' LIMIT 1")
    .bind(tenantId, principal.id).first<{ role: string; module_permissions_json: string }>()
  if (!membership || !moduleAllowed(membership.role, membership.module_permissions_json, moduleId)) return { error: json({ code: 'FORBIDDEN' }, 403) }
  return { scope: { tenantId, moduleId } }
}
async function requestBody(request: Request): Promise<Json | null> {
  try { return object(await request.clone().json()) } catch { return null }
}
async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}
function deterministicUuid(hash: string): string {
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`
}
function cycleFacts(value: unknown): Json { return parseJsonObject(value) }

async function cycleRow(db: D1Database, scope: Scope, subscriptionId: string) {
  return db.prepare(`SELECT facts_json,status,stage,updated_at_ms FROM operation_checkpoints
    WHERE tenant_id=?1 AND module_id=?2 AND id=?3 AND operation_type='package_cycle' LIMIT 1`)
    .bind(scope.tenantId, scope.moduleId, cycleId(subscriptionId)).first<{ facts_json:string; status:string; stage:string; updated_at_ms:number }>()
}
async function upsertCycle(db: D1Database, scope: Scope, subscriptionId: string, patch: Json, stage: string, status = 'running') {
  const current = await cycleRow(db, scope, subscriptionId)
  const facts = { ...cycleFacts(current?.facts_json), subscription_id: subscriptionId, ...patch }
  const now = Date.now()
  await db.prepare(`INSERT INTO operation_checkpoints(
      tenant_id,module_id,id,thread_id,operation_type,stage,facts_json,pending_effect_json,confirmations_json,status,version,updated_at_ms
    ) VALUES(?1,?2,?3,NULL,'package_cycle',?4,?5,NULL,'[]',?6,1,?7)
    ON CONFLICT(tenant_id,module_id,id) DO UPDATE SET
      stage=excluded.stage,facts_json=excluded.facts_json,status=excluded.status,
      version=operation_checkpoints.version+1,updated_at_ms=excluded.updated_at_ms`)
    .bind(scope.tenantId, scope.moduleId, cycleId(subscriptionId), stage, JSON.stringify(facts), status, now).run()
  return facts
}

async function resolveSelectedPet(db: D1Database, scope: Scope, value: unknown) {
  const petId = text(value)
  if (!petId) return null
  return db.prepare(`SELECT p.id,p.client_id,p.name,p.species,p.weight_kg,p.status,
      c.name AS owner_name,c.phone,c.email,c.address,c.address_number,c.address_complement,c.address_reference,c.neighborhood,c.city
    FROM pets p JOIN clients c ON c.tenant_id=p.tenant_id AND c.module_id=p.module_id AND c.id=p.client_id
    WHERE p.tenant_id=?1 AND p.module_id=?2 AND p.id=?3 LIMIT 1`)
    .bind(scope.tenantId, scope.moduleId, petId).first<any>()
}

async function subscriptionUsage(db: D1Database, scope: Scope, subscriptionId: string, baseRaw: unknown) {
  const base = Object.fromEntries(Object.entries(parseJsonObject(baseRaw)).map(([key, value]) => [key, integer(value)]))
  const allocations = await db.prepare(`SELECT benefit_key,state,COUNT(*) quantity FROM subscription_benefit_allocations
    WHERE tenant_id=?1 AND module_id=?2 AND subscription_id=?3 AND state IN ('reserved','consumed')
    GROUP BY benefit_key,state`).bind(scope.tenantId, scope.moduleId, subscriptionId)
    .all<{ benefit_key:string; state:'reserved'|'consumed'; quantity:number }>()
  const reserved: Record<string, number> = {}
  const consumed: Record<string, number> = {}
  for (const row of allocations.results) (row.state === 'reserved' ? reserved : consumed)[row.benefit_key] = integer(row.quantity)
  const used: Record<string, number> = { ...base }
  for (const [key, value] of Object.entries(consumed)) used[key] = integer(used[key]) + value
  return { used, reserved, consumed }
}

async function listSubscriptions(request: Request, env: Bindings, scope: Scope): Promise<Response> {
  const rows = await env.DB!.prepare(`SELECT
      cs.*,sp.name plan_name,sp.price_cents plan_price_cents,sp.billing_cycle plan_billing_cycle,sp.services_json plan_services_json,sp.status plan_status,
      tutor.name owner_name,tutor.phone owner_phone,tutor.email owner_email,tutor.address owner_address,tutor.neighborhood owner_neighborhood,tutor.city owner_city,
      json_extract(cycle.facts_json,'$.pet_id') cycle_pet_id,json_extract(cycle.facts_json,'$.first_appointment_at') cycle_first_appointment_at,
      pet.name pet_name,pet.species pet_species,pet.breed pet_breed,
      (SELECT a.pet_id FROM appointments a WHERE a.tenant_id=cs.tenant_id AND a.module_id=cs.module_id AND a.subscription_id=cs.id ORDER BY a.scheduled_at_ms,a.id LIMIT 1) historical_pet_id,
      (SELECT MIN(a.scheduled_at_ms) FROM appointments a WHERE a.tenant_id=cs.tenant_id AND a.module_id=cs.module_id AND a.subscription_id=cs.id AND a.status NOT IN ('cancelled','blocked')) first_scheduled_at_ms
    FROM client_subscriptions cs
    JOIN subscription_plans sp ON sp.tenant_id=cs.tenant_id AND sp.module_id=cs.module_id AND sp.id=cs.plan_id
    JOIN clients tutor ON tutor.tenant_id=cs.tenant_id AND tutor.module_id=cs.module_id AND tutor.id=cs.client_id
    LEFT JOIN operation_checkpoints cycle ON cycle.tenant_id=cs.tenant_id AND cycle.module_id=cs.module_id AND cycle.id=('package_cycle:'||cs.id) AND cycle.operation_type='package_cycle'
    LEFT JOIN pets pet ON pet.tenant_id=cs.tenant_id AND pet.module_id=cs.module_id AND pet.id=json_extract(cycle.facts_json,'$.pet_id')
    WHERE cs.tenant_id=?1 AND cs.module_id=?2 ORDER BY cs.started_at_ms DESC,cs.id DESC`)
    .bind(scope.tenantId, scope.moduleId).all<any>()

  const subscriptions = []
  for (const row of rows.results) {
    const petId = text(row.cycle_pet_id) || text(row.historical_pet_id)
    let pet = row.pet_name ? row : null
    if (!pet && petId) pet = await resolveSelectedPet(env.DB!, scope, petId)
    const usage = await subscriptionUsage(env.DB!, scope, String(row.id), row.benefit_ledger_base_used_json)
    const firstAt = row.first_scheduled_at_ms && row.status === 'active'
      ? new Date(Number(row.first_scheduled_at_ms)).toISOString()
      : validIso(row.cycle_first_appointment_at)
    subscriptions.push({
      id: row.id,
      plan_id: row.plan_id,
      client_id: petId || row.client_id,
      tutor_client_id: row.client_id,
      pet_id: petId,
      status: row.status,
      started_at: row.started_at_ms ? new Date(Number(row.started_at_ms)).toISOString() : null,
      next_billing_date: row.next_billing_date,
      first_appointment_at: firstAt,
      services_used: usage.used,
      services_reserved: usage.reserved,
      services_consumed: usage.consumed,
      cancelled_at: row.cancelled_at_ms ? new Date(Number(row.cancelled_at_ms)).toISOString() : null,
      subscription_plans: {
        id: row.plan_id,
        name: row.plan_name,
        price: Number(row.plan_price_cents || 0) / 100,
        billing_cycle: row.plan_billing_cycle,
        services: parseJsonArray(row.plan_services_json),
        active: row.plan_status === 'active',
      },
      client: {
        id: petId || row.client_id,
        owner_name: pet?.owner_name || row.owner_name || '',
        name: pet?.owner_name || row.owner_name || '',
        phone: pet?.phone || row.owner_phone || '',
        email: pet?.email || row.owner_email || '',
        owner_address: pet?.owner_address || row.owner_address || '',
        owner_neighborhood: pet?.owner_neighborhood || row.owner_neighborhood || '',
        owner_city: pet?.owner_city || row.owner_city || '',
        pet_name: pet?.name || pet?.pet_name || row.pet_name || row.owner_name || '',
        species: pet?.species || pet?.pet_species || row.pet_species || 'other',
        breed: pet?.breed || pet?.pet_breed || row.pet_breed || '',
      },
    })
  }
  return json({ subscriptions })
}

async function saveSubscription(request: Request, env: Bindings, scope: Scope, subscriptionId: string | null): Promise<Response> {
  const body = await requestBody(request)
  if (!body) return json({ code: 'INVALID_JSON' }, 400)
  const planId = text(body.plan_id)
  const requestedPetId = text(body.pet_id) || text(body.client_id)
  const startedAt = validDate(body.started_at)
  const nextBillingDate = validDate(body.next_billing_date)
  if (!planId || !requestedPetId) return json({ code: 'PLAN_AND_PET_REQUIRED' }, 400)
  if (!startedAt || !nextBillingDate) return json({ code: 'INVALID_SUBSCRIPTION_DATES' }, 400)
  const plan = await env.DB!.prepare("SELECT id FROM subscription_plans WHERE tenant_id=?1 AND module_id=?2 AND id=?3 AND status='active' LIMIT 1")
    .bind(scope.tenantId, scope.moduleId, planId).first<{ id:string }>()
  if (!plan) return json({ code: 'PLAN_NOT_FOUND' }, 404)
  const pet = await resolveSelectedPet(env.DB!, scope, requestedPetId)
  if (!pet || pet.status !== 'active') return json({ code: 'PACKAGE_PET_NOT_FOUND' }, 404)

  const now = Date.now()
  const startedAtMs = Date.parse(`${startedAt}T12:00:00Z`)
  if (subscriptionId) {
    const existing = await env.DB!.prepare("SELECT id,status FROM client_subscriptions WHERE tenant_id=?1 AND module_id=?2 AND id=?3 LIMIT 1")
      .bind(scope.tenantId, scope.moduleId, subscriptionId).first<{ id:string; status:string }>()
    if (!existing) return json({ code: 'SUBSCRIPTION_NOT_FOUND' }, 404)
    if (existing.status !== 'pending_payment') return json({ code: 'SUBSCRIPTION_NOT_PENDING_PAYMENT', status: existing.status }, 409)
    await env.DB!.prepare(`UPDATE client_subscriptions SET plan_id=?4,client_id=?5,status='pending_payment',started_at_ms=?6,next_billing_date=?7,cancelled_at_ms=NULL,updated_at_ms=?8
      WHERE tenant_id=?1 AND module_id=?2 AND id=?3`).bind(scope.tenantId, scope.moduleId, subscriptionId, planId, pet.client_id, startedAtMs, nextBillingDate, now).run()
    await upsertCycle(env.DB!, scope, subscriptionId, { pet_id: pet.id }, 'awaiting_schedule')
    return listOneSubscription(request, env, scope, subscriptionId)
  }

  const pending = await env.DB!.prepare(`SELECT cs.id,json_extract(cycle.facts_json,'$.pet_id') pet_id
    FROM client_subscriptions cs LEFT JOIN operation_checkpoints cycle
      ON cycle.tenant_id=cs.tenant_id AND cycle.module_id=cs.module_id AND cycle.id=('package_cycle:'||cs.id) AND cycle.operation_type='package_cycle'
    WHERE cs.tenant_id=?1 AND cs.module_id=?2 AND cs.plan_id=?3 AND cs.client_id=?4 AND cs.status='pending_payment'
      AND (cycle.id IS NULL OR json_extract(cycle.facts_json,'$.pet_id')=?5)
    ORDER BY cs.created_at_ms DESC LIMIT 1`)
    .bind(scope.tenantId, scope.moduleId, planId, pet.client_id, pet.id).first<{ id:string; pet_id:string|null }>()
  if (pending?.id) return json({ code: 'PACKAGE_RENEWAL_ALREADY_PENDING', subscription_id: pending.id }, 409)

  const id = crypto.randomUUID()
  const facts = JSON.stringify({ subscription_id: id, pet_id: pet.id })
  try {
    await env.DB!.batch([
      env.DB!.prepare(`INSERT INTO client_subscriptions(
        tenant_id,module_id,id,plan_id,client_id,status,started_at_ms,next_billing_date,services_used_json,cancelled_at_ms,created_at_ms,updated_at_ms,benefit_ledger_base_used_json
      ) VALUES(?1,?2,?3,?4,?5,'pending_payment',?6,?7,'{}',NULL,?8,?8,'{}')`)
        .bind(scope.tenantId, scope.moduleId, id, planId, pet.client_id, startedAtMs, nextBillingDate, now),
      env.DB!.prepare(`INSERT INTO operation_checkpoints(
        tenant_id,module_id,id,thread_id,operation_type,stage,facts_json,pending_effect_json,confirmations_json,status,version,updated_at_ms
      ) VALUES(?1,?2,?3,NULL,'package_cycle','awaiting_schedule',?4,NULL,'[]','running',1,?5)`)
        .bind(scope.tenantId, scope.moduleId, cycleId(id), facts, now),
    ])
  } catch (error) {
    console.error('package.cycle.create.failed', { tenant_id: scope.tenantId, subscription_id: id, error_name: error instanceof Error ? error.name : 'Error' })
    return json({ code: 'PACKAGE_SUBSCRIPTION_CREATE_FAILED' }, 500)
  }
  return listOneSubscription(request, env, scope, id)
}

async function listOneSubscription(request: Request, env: Bindings, scope: Scope, id: string): Promise<Response> {
  const all = await listSubscriptions(request, env, scope)
  const body = object(await all.json())
  const subscriptions = Array.isArray(body.subscriptions) ? body.subscriptions.map(object) : []
  const subscription = subscriptions.find((entry) => text(entry.id) === id)
  return subscription ? json({ subscription }) : json({ code: 'SUBSCRIPTION_NOT_FOUND' }, 404)
}

async function saveCycleSchedule(env: Bindings, scope: Scope, subscriptionId: string, firstAtRaw: unknown): Promise<Response> {
  const firstAt = validIso(firstAtRaw)
  if (!firstAt) return json({ code: 'PACKAGE_FIRST_APPOINTMENT_REQUIRED' }, 400)
  const subscription = await env.DB!.prepare("SELECT id,status FROM client_subscriptions WHERE tenant_id=?1 AND module_id=?2 AND id=?3 LIMIT 1")
    .bind(scope.tenantId, scope.moduleId, subscriptionId).first<{ id:string; status:string }>()
  if (!subscription) return json({ code: 'SUBSCRIPTION_NOT_FOUND' }, 404)
  if (subscription.status !== 'pending_payment') return json({ code: 'SUBSCRIPTION_NOT_PENDING_PAYMENT', status: subscription.status }, 409)
  const current = await cycleRow(env.DB!, scope, subscriptionId)
  const facts = cycleFacts(current?.facts_json)
  if (!text(facts.pet_id)) return json({ code: 'PACKAGE_PET_BINDING_REQUIRED' }, 409)
  await upsertCycle(env.DB!, scope, subscriptionId, { first_appointment_at: firstAt, recurring_appointments_created_at: null }, 'scheduled')
  return json({ data: { id: subscriptionId, first_appointment_at: firstAt }, count: 1 })
}

async function handleScheduleCompat(request: Request, env: Bindings): Promise<Response | null> {
  if (new URL(request.url).pathname !== '/api/compat/query' || request.method !== 'POST') return null
  const body = await requestBody(request)
  if (!body || body.table !== 'client_subscriptions' || body.action !== 'update') return null
  const payload = object(body.payload)
  if (!Object.prototype.hasOwnProperty.call(payload, 'first_appointment_at')) return null
  const idFilter = (Array.isArray(body.filters) ? body.filters : []).map(object)
    .find((filter) => filter.op === 'eq' && filter.column === 'id')
  const subscriptionId = text(idFilter?.value)
  if (!subscriptionId) return json({ code: 'WRITE_REQUIRES_ID' }, 400)
  const resolved = await resolveScope(request, env)
  if (resolved.error) return resolved.error
  return saveCycleSchedule(env, resolved.scope!, subscriptionId, payload.first_appointment_at)
}

async function addTransportBenefit(
  db: D1Database,
  scope: Scope,
  subscriptionId: string,
  appointmentId: string,
  now: number,
): Promise<D1PreparedStatement[]> {
  const option = await db.prepare("SELECT fee_cents FROM transport_options WHERE tenant_id=?1 AND module_id=?2 AND id='buscar_e_levar' AND status='active' LIMIT 1")
    .bind(scope.tenantId, scope.moduleId).first<{ fee_cents:number }>()
  if (!option) throw new Error('PACKAGE_TRANSPORT_NOT_CONFIGURED')
  const fee = Math.max(0, Number(option.fee_cents || 0))
  return [
    db.prepare(`INSERT INTO subscription_benefit_allocations(
      tenant_id,module_id,id,subscription_id,appointment_id,appointment_service_position,benefit_kind,benefit_key,service_code,state,operation_key,catalog_price_cents,version,reserved_at_ms,consumed_at_ms,released_at_ms,created_at_ms,updated_at_ms
    ) VALUES(?1,?2,?3,?4,?5,-1,'transport','motodog','motodog','reserved',?6,?7,1,?8,NULL,NULL,?8,?8)`)
      .bind(scope.tenantId, scope.moduleId, crypto.randomUUID(), subscriptionId, appointmentId, `appointment-benefit:${appointmentId}:-1:${subscriptionId}:motodog`, fee, now),
    db.prepare(`UPDATE appointments SET
      subscription_discount_cents=subscription_discount_cents+?4,
      subscription_benefits_json=json_insert(subscription_benefits_json,'$[#]',json_object(
        'kind','transport','key','motodog','service_code','motodog','catalog_price',?4/100.0,'status','reserved','subscription_id',?5
      ))
      WHERE tenant_id=?1 AND module_id=?2 AND id=?3`)
      .bind(scope.tenantId, scope.moduleId, appointmentId, fee, subscriptionId),
  ]
}

async function checkoutCycle(request: Request, env: Bindings, scope: Scope, payload: Json): Promise<Response> {
  const subscriptionId = text(payload.subscription_id)
  if (!subscriptionId) return json({ code: 'SUBSCRIPTION_ID_REQUIRED' }, 400)
  const operationKey = `subscription:${subscriptionId}`
  const existingSale = await env.DB!.prepare(`SELECT id,total_cents FROM sales WHERE tenant_id=?1 AND module_id=?2 AND (operation_key=?3 OR subscription_id=?4) LIMIT 1`)
    .bind(scope.tenantId, scope.moduleId, operationKey, subscriptionId).first<{ id:string; total_cents:number }>()
  if (existingSale?.id) return json({ data: { sale_id: existingSale.id, subscription_id: subscriptionId, total: Number(existingSale.total_cents || 0) / 100, status: 'active', duplicated: true } })

  const subscription = await env.DB!.prepare(`SELECT cs.id,cs.client_id,cs.status,cs.benefit_ledger_base_used_json,
      sp.name plan_name,sp.price_cents plan_price_cents,sp.billing_cycle plan_billing_cycle,sp.services_json plan_services_json,sp.status plan_status,
      cycle.facts_json cycle_facts,
      pet.id pet_id,pet.species pet_species,pet.weight_kg pet_weight_kg,
      tutor.phone tutor_phone,tutor.address tutor_address,tutor.address_number tutor_address_number,tutor.address_complement tutor_address_complement,
      tutor.address_reference tutor_address_reference,tutor.neighborhood tutor_neighborhood,tutor.city tutor_city
    FROM client_subscriptions cs
    JOIN subscription_plans sp ON sp.tenant_id=cs.tenant_id AND sp.module_id=cs.module_id AND sp.id=cs.plan_id
    JOIN operation_checkpoints cycle ON cycle.tenant_id=cs.tenant_id AND cycle.module_id=cs.module_id AND cycle.id=('package_cycle:'||cs.id) AND cycle.operation_type='package_cycle'
    JOIN pets pet ON pet.tenant_id=cs.tenant_id AND pet.module_id=cs.module_id AND pet.id=json_extract(cycle.facts_json,'$.pet_id') AND pet.client_id=cs.client_id
    JOIN clients tutor ON tutor.tenant_id=cs.tenant_id AND tutor.module_id=cs.module_id AND tutor.id=cs.client_id
    WHERE cs.tenant_id=?1 AND cs.module_id=?2 AND cs.id=?3 LIMIT 1`)
    .bind(scope.tenantId, scope.moduleId, subscriptionId).first<any>()
  if (!subscription) return json({ code: 'PACKAGE_CYCLE_NOT_PREPARED' }, 409)
  if (subscription.status !== 'pending_payment') return json({ code: 'SUBSCRIPTION_NOT_PENDING_PAYMENT', status: subscription.status }, 409)
  if (subscription.plan_status !== 'active') return json({ code: 'SUBSCRIPTION_PLAN_INACTIVE' }, 409)

  const facts = cycleFacts(subscription.cycle_facts)
  const firstAt = validIso(facts.first_appointment_at)
  if (!firstAt) return json({ code: 'PACKAGE_FIRST_APPOINTMENT_REQUIRED' }, 409)
  const entries = planEntries(subscription.plan_services_json)
  const services = entries.filter((entry) => !entry.transport)
  const motodog = entries.find((entry) => entry.transport) || null
  if (!services.some((entry) => entry.qty >= 4)) return json({ code: 'PACKAGE_FOUR_WEEK_SERVICE_REQUIRED' }, 409)

  const totalCents = Math.max(0, Number(subscription.plan_price_cents || 0))
  const payments = paymentInputs(payload, totalCents)
  if (payments instanceof Response) return payments
  const now = Date.now()
  const firstMs = Date.parse(firstAt)
  const legacyBase = Object.fromEntries(Object.entries(parseJsonObject(subscription.benefit_ledger_base_used_json)).map(([key, value]) => [key, integer(value)])) as Record<string, number>
  const preparedWeeks: Array<{ index:number; scheduledAt:string; items:BillingService[]; allocations:BenefitAllocation[]; motodog:boolean; appointmentId:string; operationKey:string; fingerprint:string }> = []
  let legacyWeeks = 0

  for (let index = 0; index < 4; index += 1) {
    const scheduledMs = firstMs + index * 7 * 86_400_000
    const weekEntries = services.filter((entry) => entry.qty > index)
    const usesMotodog = Boolean(motodog && motodog.qty > index)
    if (scheduledMs < now) {
      legacyWeeks += 1
      for (const entry of weekEntries) legacyBase[entry.key] = integer(legacyBase[entry.key]) + 1
      if (usesMotodog) legacyBase.motodog = integer(legacyBase.motodog) + 1
      continue
    }

    const catalog = await resolveBillingCatalog({
      db: env.DB!, tenantId: scope.tenantId, moduleId: scope.moduleId,
      species: String(subscription.pet_species || 'other'),
      weightGrams: subscription.pet_weight_kg == null ? null : Math.round(Number(subscription.pet_weight_kg) * 1000),
      payload: { services: weekEntries.map((entry) => ({ code: entry.code })) },
    })
    if (catalog.code) return json({ code: catalog.code, week: index + 1 }, 409)
    const items = catalog.items || []
    const allocations: BenefitAllocation[] = items.map((item, position) => {
      const source = weekEntries[position]
      return {
        subscriptionId,
        serviceCode: String(item.service_code || item.code),
        benefitKey: source.key,
        position,
        catalogPriceCents: Math.max(0, Math.round(Number(item.catalog_price ?? item.unit_price ?? 0) * 100)),
        planName: String(subscription.plan_name || 'Pacote'),
      }
    })
    const weekOperationKey = `subscription:${subscriptionId}:weekly:${index + 1}`
    const fingerprint = await sha256(JSON.stringify({ tenant_id: scope.tenantId, module_id: scope.moduleId, subscription_id: subscriptionId, pet_id: subscription.pet_id, week: index + 1, scheduled_at: new Date(scheduledMs).toISOString(), services: weekEntries.map((entry) => entry.code), motodog: usesMotodog }))
    preparedWeeks.push({
      index,
      scheduledAt: new Date(scheduledMs).toISOString(),
      items,
      allocations,
      motodog: usesMotodog,
      appointmentId: deterministicUuid(await sha256(`${scope.tenantId}:${scope.moduleId}:${weekOperationKey}`)),
      operationKey: weekOperationKey,
      fingerprint,
    })
  }

  for (const entry of entries) {
    if (integer(legacyBase[entry.key]) > entry.qty) return json({ code: 'PACKAGE_BENEFIT_CAPACITY_EXCEEDED', benefit_key: entry.key }, 409)
  }

  const saleId = crypto.randomUUID()
  const nextBillingDate = new Date(firstMs + (normalize(subscription.plan_billing_cycle) === 'quarterly' ? 90 : 30) * 86_400_000).toISOString().slice(0, 10)
  const notes = [`Pacote: ${subscription.plan_name || 'Plano'}`, `Assinatura: ${subscriptionId}`, text(payload.notes)].filter(Boolean).join(' | ')
  const statements: D1PreparedStatement[] = [
    env.DB!.prepare(`INSERT INTO sales(
      tenant_id,module_id,id,operation_key,client_id,appointment_id,subscription_id,source,fulfillment_type,
      subtotal_cents,discount_cents,transport_fee_cents,total_cents,status,notes,created_at_ms,updated_at_ms,origin_type,origin_id
    ) VALUES(?1,?2,?3,?4,?5,NULL,?6,'pos','service',?7,0,0,?7,'completed',?8,?9,?9,'subscription',?6)`)
      .bind(scope.tenantId, scope.moduleId, saleId, operationKey, subscription.client_id, subscriptionId, totalCents, notes, now),
    env.DB!.prepare(`UPDATE client_subscriptions SET status='active',started_at_ms=?1,next_billing_date=?2,
      benefit_ledger_base_used_json=?3,cancelled_at_ms=NULL,updated_at_ms=?1
      WHERE tenant_id=?4 AND module_id=?5 AND id=?6 AND status='pending_payment'`)
      .bind(now, nextBillingDate, JSON.stringify(legacyBase), scope.tenantId, scope.moduleId, subscriptionId),
  ]

  payments.forEach((payment, index) => {
    statements.push(env.DB!.prepare(`INSERT INTO payments(
      tenant_id,module_id,id,sale_id,operation_key,method,amount_cents,status,provider,provider_reference,received_at_ms,created_at_ms,updated_at_ms
    ) VALUES(?1,?2,?3,?4,?5,?6,?7,'received',NULL,NULL,?8,?8,?8)`)
      .bind(scope.tenantId, scope.moduleId, crypto.randomUUID(), saleId, `${operationKey}:payment:${index}`, payment.method, payment.amountCents, now))
  })

  for (const week of preparedWeeks) {
    const payloadForWeek: Json = {
      scheduled_at: week.scheduledAt,
      status: 'scheduled',
      source: 'package_activation',
      notes: `Reserva automatica do pacote - semana ${week.index + 1} de 4`,
      transport_mode: week.motodog ? 'buscar_e_levar' : 'cliente_leva',
      transport_address: week.motodog ? [subscription.tutor_address, subscription.tutor_address_number, subscription.tutor_address_complement].filter(Boolean).join(', ') : null,
      transport_reference: week.motodog ? subscription.tutor_address_reference : null,
      transport_contact_phone: week.motodog ? subscription.tutor_phone : null,
    }
    statements.push(env.DB!.prepare(`INSERT INTO appointment_command_registry(
      tenant_id,module_id,operation_key,appointment_id,operation_fingerprint,status,created_at_ms,updated_at_ms
    ) VALUES(?1,?2,?3,?4,?5,'completed',?6,?6)`)
      .bind(scope.tenantId, scope.moduleId, week.operationKey, week.appointmentId, week.fingerprint, now))
    statements.push(billingAppointmentStatement(env.DB!, {
      tenantId: scope.tenantId, moduleId: scope.moduleId, clientId: subscription.client_id, petId: subscription.pet_id,
      appointmentId: week.appointmentId, operationKey: week.operationKey, fingerprint: week.fingerprint,
      payload: payloadForWeek, items: week.items, allocations: week.allocations, billingType: 'subscription', now,
    }))
    week.items.forEach((item, position) => statements.push(billingServiceStatement(env.DB!, { tenantId: scope.tenantId, moduleId: scope.moduleId, appointmentId: week.appointmentId }, item, position, true)))
    statements.push(...billingTransportStatements(env.DB!, { tenantId: scope.tenantId, moduleId: scope.moduleId, appointmentId: week.appointmentId, payload: payloadForWeek, now }))
    statements.push(...billingAllocationStatements(env.DB!, { tenantId: scope.tenantId, moduleId: scope.moduleId, appointmentId: week.appointmentId, allocations: week.allocations, now }))
    if (week.motodog) statements.push(...await addTransportBenefit(env.DB!, scope, subscriptionId, week.appointmentId, now))
  }

  const completedFacts = {
    ...facts,
    recurring_appointments_created_at: new Date(now).toISOString(),
    appointment_ids: preparedWeeks.map((week) => week.appointmentId),
    legacy_weeks_consumed: legacyWeeks,
  }
  statements.push(env.DB!.prepare(`UPDATE operation_checkpoints SET stage='activated',facts_json=?4,status='completed',version=version+1,updated_at_ms=?5
    WHERE tenant_id=?1 AND module_id=?2 AND id=?3 AND operation_type='package_cycle'`)
    .bind(scope.tenantId, scope.moduleId, cycleId(subscriptionId), JSON.stringify(completedFacts), now))

  try {
    await env.DB!.batch(statements)
  } catch (error) {
    const raced = await env.DB!.prepare("SELECT id,total_cents FROM sales WHERE tenant_id=?1 AND module_id=?2 AND operation_key=?3 LIMIT 1")
      .bind(scope.tenantId, scope.moduleId, operationKey).first<{ id:string; total_cents:number }>()
    if (raced?.id) return json({ data: { sale_id: raced.id, subscription_id: subscriptionId, total: Number(raced.total_cents || 0) / 100, status: 'active', duplicated: true } })
    const message = error instanceof Error ? error.message : String(error)
    if (message.includes('PACKAGE_BENEFIT_CAPACITY_EXCEEDED')) return json({ code: 'PACKAGE_BENEFIT_CAPACITY_EXCEEDED' }, 409)
    if (message.includes('PACKAGE_TRANSPORT_NOT_CONFIGURED')) return json({ code: 'PACKAGE_TRANSPORT_NOT_CONFIGURED' }, 409)
    console.error('package.cycle.checkout.failed', { tenant_id: scope.tenantId, subscription_id: subscriptionId, error_name: error instanceof Error ? error.name : 'Error' })
    return json({ code: 'SUBSCRIPTION_CHECKOUT_FAILED' }, 500)
  }

  return json({ data: {
    sale_id: saleId,
    subscription_id: subscriptionId,
    total: totalCents / 100,
    status: 'active',
    duplicated: false,
    appointment_ids: preparedWeeks.map((week) => week.appointmentId),
    reserved_weeks: preparedWeeks.length,
    legacy_weeks_consumed: legacyWeeks,
  } })
}

async function handleCheckoutRpc(request: Request, env: Bindings): Promise<Response | null> {
  if (new URL(request.url).pathname !== '/api/compat/rpc' || request.method !== 'POST') return null
  const body = await requestBody(request)
  if (!body || text(body.name) !== CHECKOUT_RPC) return null
  const resolved = await resolveScope(request, env)
  if (resolved.error) return resolved.error
  const args = object(body.args)
  const payload = object(args.p_payload)
  const payloadTenant = text(payload.tenant_id)
  const payloadModule = text(payload.module_id)?.toLowerCase() || null
  if ((payloadTenant && payloadTenant !== resolved.scope!.tenantId) || (payloadModule && payloadModule !== resolved.scope!.moduleId)) return json({ code: 'SCOPE_MISMATCH' }, 400)
  return checkoutCycle(request, env, resolved.scope!, payload)
}

export async function handlePackageCycleApiRequest(request: Request, env: Bindings): Promise<Response | null> {
  const checkout = await handleCheckoutRpc(request, env)
  if (checkout) return checkout
  const compatSchedule = await handleScheduleCompat(request, env)
  if (compatSchedule) return compatSchedule

  const { pathname } = new URL(request.url)
  if (pathname === '/api/petshop/subscriptions' && ['GET', 'POST'].includes(request.method)) {
    const resolved = await resolveScope(request, env)
    if (resolved.error) return resolved.error
    return request.method === 'GET'
      ? listSubscriptions(request, env, resolved.scope!)
      : saveSubscription(request, env, resolved.scope!, null)
  }
  const match = /^\/api\/petshop\/subscriptions\/([^/]+)$/.exec(pathname)
  if (match && request.method === 'PATCH') {
    const id = decodeURIComponent(match[1])
    if (!ID.test(id)) return json({ code: 'INVALID_SUBSCRIPTION_ID' }, 400)
    const resolved = await resolveScope(request, env)
    if (resolved.error) return resolved.error
    return saveSubscription(request, env, resolved.scope!, id)
  }
  return null
}
