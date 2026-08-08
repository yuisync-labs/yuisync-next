import {
  handleCompatApiRequest as handleBaseCompatApiRequest,
  type CompatRuntimeBindings,
} from './compatApiRuntime.js'

const SUBSCRIPTION_RPC_NAMES = new Set([
  'reconcile_petshop_completed_appointment_package',
  'checkout_petshop_subscription_transaction',
])

const SCOPE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/
const MODULE_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/

type Scope = { tenantId: string; moduleId: string }
type JsonRecord = Record<string, unknown>

type AppointmentRow = {
  id: string
  client_id: string
  status: string
  subtotal_cents: number
  transport_fee_cents: number
  subscription_id: string | null
  subscription_benefit_used: number
  subscription_benefit_status: string | null
  subscription_benefits_json: string
  subscription_label: string | null
  subscription_discount_cents: number
}

type AppointmentServiceRow = {
  position: number
  service_id: string
  service_code: string
  service_name: string
  unit_price_cents: number
  benefit_used: number
}

type SubscriptionRow = {
  id: string
  client_id: string
  plan_id: string
  status: string
  services_used_json: string
  plan_name: string
  plan_price_cents: number
  plan_billing_cycle: string
  plan_services_json: string
  plan_status: string
}

type ExistingSaleRow = {
  id: string
  total_cents: number
  status: string
}

type PaymentInput = {
  method: 'pix' | 'cash' | 'card'
  amountCents: number
}

function json(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { 'cache-control': 'no-store' },
  })
}

function record(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : {}
}

function text(value: unknown): string | null {
  const normalized = String(value ?? '').trim()
  return normalized || null
}

function integer(value: unknown, fallback = 0): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback
}

function cents(value: unknown): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : 0
}

function parseArray(value: string | null | undefined): JsonRecord[] {
  if (!value) return []
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.map(record) : []
  } catch {
    return []
  }
}

function parseObject(value: string | null | undefined): JsonRecord {
  if (!value) return {}
  try {
    const parsed = JSON.parse(value)
    return record(parsed)
  } catch {
    return {}
  }
}

function normalizeKey(value: unknown): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

function requestScope(request: Request): Scope | null {
  const tenantId = text(request.headers.get('x-tenant-id'))
  const moduleId = text(request.headers.get('x-module-id'))?.toLowerCase() || null
  if (!tenantId || !moduleId || !SCOPE_ID.test(tenantId) || !MODULE_ID.test(moduleId)) return null
  return { tenantId, moduleId }
}

function scopeMismatch(request: Request, payload: JsonRecord): boolean {
  const scope = requestScope(request)
  if (!scope) return false
  const payloadTenant = text(payload.tenant_id)
  const payloadModule = text(payload.module_id)?.toLowerCase() || null
  return Boolean(
    (payloadTenant && payloadTenant !== scope.tenantId)
    || (payloadModule && payloadModule !== scope.moduleId)
  )
}

function normalizePaymentMethod(value: unknown): PaymentInput['method'] | null {
  const normalized = normalizeKey(value)
  if (normalized === 'pix') return 'pix'
  if (normalized === 'cash' || normalized === 'dinheiro') return 'cash'
  if (
    normalized === 'card'
    || normalized === 'credito'
    || normalized === 'debito'
    || normalized === 'cartao'
  ) return 'card'
  return null
}

function paymentInputs(payload: JsonRecord, totalCents: number): PaymentInput[] | Response {
  const rawSplits = Array.isArray(payload.payment_splits) ? payload.payment_splits : []
  if (rawSplits.length) {
    const payments: PaymentInput[] = []
    for (const raw of rawSplits) {
      const split = record(raw)
      const amountCents = cents(split.amount)
      if (amountCents <= 0) return json({ code: 'INVALID_PAYMENT_AMOUNT' }, 400)
      const method = normalizePaymentMethod(split.method)
      if (!method) return json({ code: 'INVALID_PAYMENT_METHOD' }, 400)
      payments.push({ method, amountCents })
    }
    const informed = payments.reduce((sum, payment) => sum + payment.amountCents, 0)
    if (informed !== totalCents) {
      return json({ code: 'PAYMENT_TOTAL_MISMATCH', expected_cents: totalCents, informed_cents: informed }, 409)
    }
    return payments
  }

  const method = normalizePaymentMethod(payload.payment_method)
  if (!method) return json({ code: 'INVALID_PAYMENT_METHOD' }, 400)
  return [{ method, amountCents: totalCents }]
}

async function runBaseQuery(
  request: Request,
  env: CompatRuntimeBindings,
  body: JsonRecord,
): Promise<Response> {
  const url = new URL(request.url)
  url.pathname = '/api/compat/query'
  url.search = ''
  const headers = new Headers(request.headers)
  headers.set('content-type', 'application/json')
  const response = await handleBaseCompatApiRequest(new Request(url.toString(), {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  }), env)
  return response || json({ code: 'COMPAT_QUERY_UNAVAILABLE' }, 503)
}

async function authorizeRecord(
  request: Request,
  env: CompatRuntimeBindings,
  table: 'appointments' | 'client_subscriptions',
  id: string,
  notFoundCode: string,
): Promise<Response | null> {
  const response = await runBaseQuery(request, env, {
    table,
    action: 'select',
    filters: [{ op: 'eq', column: 'id', value: id }],
    mode: 'maybeSingle',
    limit: 1,
  })
  if (!response.ok) return response
  const result = record(await response.json())
  return result.data ? null : json({ code: notFoundCode }, 404)
}

function benefitMatchesService(benefit: JsonRecord, service: AppointmentServiceRow): boolean {
  const kind = normalizeKey(benefit.kind)
  if (kind && kind !== 'service') return false
  const status = normalizeKey(benefit.status || 'reserved')
  if (status !== 'reserved' && status !== 'consumed') return false
  const candidates = [benefit.service_code, benefit.key, benefit.benefit_key, benefit.label]
    .map(normalizeKey)
    .filter(Boolean)
  const serviceKeys = [service.service_code, service.service_name]
    .map(normalizeKey)
    .filter(Boolean)
  return candidates.some((candidate) => serviceKeys.includes(candidate))
}

function planServiceMatch(planServices: JsonRecord[], service: AppointmentServiceRow): JsonRecord | null {
  const serviceKeys = new Set([normalizeKey(service.service_code), normalizeKey(service.service_name)].filter(Boolean))
  return planServices.find((item) => {
    const keys = [
      item.service_type,
      item.service_code,
      item.code,
      item.service_name,
      item.name,
      item.label,
    ].map(normalizeKey).filter(Boolean)
    return keys.some((key) => serviceKeys.has(key))
  }) || null
}

function planUsageKey(planService: JsonRecord, fallback: string): string {
  return text(planService.service_type)
    || text(planService.service_code)
    || text(planService.code)
    || normalizeKey(fallback)
}

function planLimit(planService: JsonRecord): number {
  return Math.max(0, integer(planService.qty_per_cycle ?? planService.quantity ?? planService.qty, 0))
}

function consumedBenefitSnapshot(
  existing: JsonRecord | null,
  service: AppointmentServiceRow,
  usageKey: string,
): JsonRecord {
  return {
    ...(existing || {}),
    kind: 'service',
    key: text(existing?.key) || text(existing?.benefit_key) || usageKey,
    service_code: service.service_code,
    label: text(existing?.label) || service.service_name,
    catalog_price: Number(service.unit_price_cents || 0) / 100,
    status: 'consumed',
  }
}

function activeTransportBenefit(benefit: JsonRecord): boolean {
  if (normalizeKey(benefit.kind) !== 'transport') return false
  const status = normalizeKey(benefit.status || 'reserved')
  return status === 'reserved' || status === 'consumed'
}

function motodogPlanService(planServices: JsonRecord[]): JsonRecord | null {
  return planServices.find((item) => {
    const keys = [item.service_type, item.service_code, item.code, item.service_kind, item.name]
      .map(normalizeKey)
    return keys.includes('motodog') || keys.includes('transport')
  }) || null
}

async function reconcileCompletedAppointment(
  request: Request,
  env: CompatRuntimeBindings,
  args: JsonRecord,
): Promise<Response> {
  const scope = requestScope(request)
  if (!scope) return json({ code: 'INVALID_SCOPE' }, 400)
  if (!env.DB) return json({ code: 'DATABASE_NOT_CONFIGURED' }, 503)

  const appointmentId = text(args.p_appointment_id)
  if (!appointmentId) return json({ code: 'APPOINTMENT_ID_REQUIRED' }, 400)

  const authorizationError = await authorizeRecord(request, env, 'appointments', appointmentId, 'APPOINTMENT_NOT_FOUND')
  if (authorizationError) return authorizationError

  const appointment = await env.DB.prepare(`
    SELECT id,client_id,status,subtotal_cents,transport_fee_cents,
           subscription_id,subscription_benefit_used,subscription_benefit_status,
           subscription_benefits_json,subscription_label,subscription_discount_cents
    FROM appointments
    WHERE tenant_id=?1 AND module_id=?2 AND id=?3
    LIMIT 1
  `).bind(scope.tenantId, scope.moduleId, appointmentId).first<AppointmentRow>()
  if (!appointment) return json({ code: 'APPOINTMENT_NOT_FOUND' }, 404)

  if (appointment.status !== 'completed') {
    return json({
      data: {
        changed: false,
        appointment_id: appointmentId,
        subscription_id: appointment.subscription_id,
        covered_by_subscription: false,
        consumed_qty: 0,
        appointment,
      },
    })
  }

  const sale = await env.DB.prepare(`
    SELECT id,total_cents,status
    FROM sales
    WHERE tenant_id=?1 AND module_id=?2 AND appointment_id=?3
    LIMIT 1
  `).bind(scope.tenantId, scope.moduleId, appointmentId).first<ExistingSaleRow>()
  if (sale?.id) {
    return json({
      data: {
        changed: false,
        appointment_id: appointmentId,
        subscription_id: appointment.subscription_id,
        covered_by_subscription: Number(appointment.subscription_benefit_used || 0) === 1,
        consumed_qty: 0,
        sale_id: sale.id,
        appointment,
      },
    })
  }

  const serviceResult = await env.DB.prepare(`
    SELECT position,service_id,service_code,service_name,unit_price_cents,benefit_used
    FROM appointment_services
    WHERE tenant_id=?1 AND module_id=?2 AND appointment_id=?3
    ORDER BY position
  `).bind(scope.tenantId, scope.moduleId, appointmentId).all<AppointmentServiceRow>()
  const services = serviceResult.results
  const benefits = parseArray(appointment.subscription_benefits_json)

  if (normalizeKey(appointment.subscription_benefit_status) === 'consumed') {
    const coveredServiceCount = services.filter((service) => Number(service.benefit_used || 0) === 1).length
    const transportCovered = benefits.some(activeTransportBenefit)
    return json({
      data: {
        changed: false,
        appointment_id: appointmentId,
        subscription_id: appointment.subscription_id,
        covered_by_subscription: coveredServiceCount > 0 || transportCovered || Number(appointment.subscription_benefit_used || 0) === 1,
        consumed_qty: 0,
        discount: Number(appointment.subscription_discount_cents || 0) / 100,
        appointment,
      },
    })
  }

  const subscription = await env.DB.prepare(`
    SELECT cs.id,cs.client_id,cs.plan_id,cs.status,cs.services_used_json,
           sp.name AS plan_name,sp.price_cents AS plan_price_cents,
           sp.billing_cycle AS plan_billing_cycle,sp.services_json AS plan_services_json,
           sp.status AS plan_status
    FROM client_subscriptions cs
    JOIN subscription_plans sp
      ON sp.tenant_id=cs.tenant_id AND sp.module_id=cs.module_id AND sp.id=cs.plan_id
    WHERE cs.tenant_id=?1 AND cs.module_id=?2 AND cs.client_id=?3
      AND cs.status='active' AND sp.status='active'
    ORDER BY CASE WHEN cs.id=?4 THEN 0 ELSE 1 END, cs.started_at_ms DESC, cs.created_at_ms DESC
    LIMIT 1
  `).bind(
    scope.tenantId,
    scope.moduleId,
    appointment.client_id,
    appointment.subscription_id || '',
  ).first<SubscriptionRow>()

  if (!subscription) {
    return json({
      data: {
        changed: false,
        appointment_id: appointmentId,
        subscription_id: null,
        covered_by_subscription: false,
        consumed_qty: 0,
        appointment,
      },
    })
  }

  const planServices = parseArray(subscription.plan_services_json)
  const usage = parseObject(subscription.services_used_json)
  const nextBenefits = [...benefits]
  const coveredPositions = new Set<number>()
  let consumedQty = 0
  let serviceDiscountCents = 0

  for (const service of services) {
    const existingIndex = nextBenefits.findIndex((benefit) => benefitMatchesService(benefit, service))
    const existingBenefit = existingIndex >= 0 ? nextBenefits[existingIndex] : null
    const matchingPlanService = planServiceMatch(planServices, service)
    const alreadyMarked = Number(service.benefit_used || 0) === 1

    if (!existingBenefit && !alreadyMarked && !matchingPlanService) continue

    const usageKey = matchingPlanService
      ? planUsageKey(matchingPlanService, service.service_code)
      : text(existingBenefit?.key) || text(existingBenefit?.benefit_key) || service.service_code
    const limit = matchingPlanService ? planLimit(matchingPlanService) : 0
    const used = Math.max(0, integer(usage[usageKey], 0))
    const existingStatus = normalizeKey(existingBenefit?.status || '')
    const mayConsume = alreadyMarked
      || existingStatus === 'consumed'
      || existingStatus === 'reserved'
      || (matchingPlanService !== null && limit > used)

    if (!mayConsume) continue

    if (!alreadyMarked && existingStatus !== 'consumed' && matchingPlanService && limit > used) {
      usage[usageKey] = used + 1
      consumedQty += 1
    }

    coveredPositions.add(Number(service.position))
    serviceDiscountCents += Math.max(0, Number(service.unit_price_cents || 0))
    const snapshot = consumedBenefitSnapshot(existingBenefit, service, usageKey)
    if (existingIndex >= 0) nextBenefits[existingIndex] = snapshot
    else nextBenefits.push(snapshot)
  }

  let transportDiscountCents = 0
  const transportFeeCents = Math.max(0, Number(appointment.transport_fee_cents || 0))
  const existingTransportIndex = nextBenefits.findIndex(activeTransportBenefit)
  const existingTransport = existingTransportIndex >= 0 ? nextBenefits[existingTransportIndex] : null
  const transportPlanService = motodogPlanService(planServices)

  if (transportFeeCents > 0 && (existingTransport || transportPlanService)) {
    const usageKey = transportPlanService
      ? planUsageKey(transportPlanService, 'motodog')
      : text(existingTransport?.key) || 'motodog'
    const limit = transportPlanService ? planLimit(transportPlanService) : 0
    const used = Math.max(0, integer(usage[usageKey], 0))
    const existingStatus = normalizeKey(existingTransport?.status || '')
    const mayConsume = existingStatus === 'consumed'
      || existingStatus === 'reserved'
      || (transportPlanService !== null && limit > used)

    if (mayConsume) {
      if (existingStatus !== 'consumed' && transportPlanService && limit > used) {
        usage[usageKey] = used + 1
        consumedQty += 1
      }
      transportDiscountCents = transportFeeCents
      const snapshot: JsonRecord = {
        ...(existingTransport || {}),
        kind: 'transport',
        key: text(existingTransport?.key) || usageKey,
        service_code: text(existingTransport?.service_code) || 'motodog',
        label: text(existingTransport?.label) || 'MotoDog',
        catalog_price: transportFeeCents / 100,
        status: 'consumed',
      }
      if (existingTransportIndex >= 0) nextBenefits[existingTransportIndex] = snapshot
      else nextBenefits.push(snapshot)
    }
  }

  const discountCents = Math.min(
    Math.max(0, Number(appointment.subtotal_cents || 0)) + transportFeeCents,
    serviceDiscountCents + transportDiscountCents,
  )
  const coveredBySubscription = discountCents > 0 || coveredPositions.size > 0

  if (!coveredBySubscription) {
    return json({
      data: {
        changed: false,
        appointment_id: appointmentId,
        subscription_id: subscription.id,
        covered_by_subscription: false,
        consumed_qty: 0,
        discount: 0,
        appointment,
      },
    })
  }

  const now = Date.now()
  const statements: D1PreparedStatement[] = [
    env.DB.prepare(`
      UPDATE client_subscriptions
      SET services_used_json=?1,updated_at_ms=?2
      WHERE tenant_id=?3 AND module_id=?4 AND id=?5 AND status='active'
    `).bind(JSON.stringify(usage), now, scope.tenantId, scope.moduleId, subscription.id),
    env.DB.prepare(`
      UPDATE appointments
      SET subscription_id=?1,subscription_benefit_used=1,subscription_benefit_status='consumed',
          subscription_benefits_json=?2,subscription_label=?3,subscription_discount_cents=?4,
          updated_at_ms=?5,version=version+1
      WHERE tenant_id=?6 AND module_id=?7 AND id=?8 AND subscription_benefit_status IS NOT 'consumed'
    `).bind(
      subscription.id,
      JSON.stringify(nextBenefits),
      appointment.subscription_label || subscription.plan_name,
      discountCents,
      now,
      scope.tenantId,
      scope.moduleId,
      appointmentId,
    ),
  ]

  for (const position of coveredPositions) {
    statements.push(env.DB.prepare(`
      UPDATE appointment_services
      SET benefit_used=1
      WHERE tenant_id=?1 AND module_id=?2 AND appointment_id=?3 AND position=?4
    `).bind(scope.tenantId, scope.moduleId, appointmentId, position))
  }

  try {
    await env.DB.batch(statements)
  } catch (error) {
    console.error('compat.subscription.reconcile.failed', {
      tenant_id: scope.tenantId,
      module_id: scope.moduleId,
      appointment_id: appointmentId,
      error_name: error instanceof Error ? error.name : 'Error',
    })
    return json({ code: 'PACKAGE_RECONCILIATION_FAILED' }, 500)
  }

  const updatedAppointment = {
    ...appointment,
    subscription_id: subscription.id,
    subscription_benefit_used: 1,
    subscription_benefit_status: 'consumed',
    subscription_benefits_json: JSON.stringify(nextBenefits),
    subscription_label: appointment.subscription_label || subscription.plan_name,
    subscription_discount_cents: discountCents,
  }

  return json({
    data: {
      changed: true,
      appointment_id: appointmentId,
      subscription_id: subscription.id,
      covered_by_subscription: true,
      consumed_qty: consumedQty,
      discount: discountCents / 100,
      appointment: updatedAppointment,
    },
  })
}

async function checkoutSubscription(
  request: Request,
  env: CompatRuntimeBindings,
  args: JsonRecord,
): Promise<Response> {
  const payload = record(args.p_payload)
  if (scopeMismatch(request, payload)) return json({ code: 'SCOPE_MISMATCH' }, 400)
  const scope = requestScope(request)
  if (!scope) return json({ code: 'INVALID_SCOPE' }, 400)
  if (scope.moduleId !== 'petshop') return json({ code: 'PETSHOP_MODULE_REQUIRED' }, 400)
  if (!env.DB) return json({ code: 'DATABASE_NOT_CONFIGURED' }, 503)

  const subscriptionId = text(payload.subscription_id)
  if (!subscriptionId) return json({ code: 'SUBSCRIPTION_ID_REQUIRED' }, 400)

  const authorizationError = await authorizeRecord(
    request,
    env,
    'client_subscriptions',
    subscriptionId,
    'SUBSCRIPTION_NOT_FOUND',
  )
  if (authorizationError) return authorizationError

  const operationKey = `subscription:${subscriptionId}`
  const existing = await env.DB.prepare(`
    SELECT id,total_cents,status
    FROM sales
    WHERE tenant_id=?1 AND module_id=?2 AND (operation_key=?3 OR subscription_id=?4)
    ORDER BY CASE WHEN operation_key=?3 THEN 0 ELSE 1 END
    LIMIT 1
  `).bind(scope.tenantId, scope.moduleId, operationKey, subscriptionId).first<ExistingSaleRow>()
  if (existing?.id) {
    return json({
      data: {
        sale_id: existing.id,
        subscription_id: subscriptionId,
        total: Number(existing.total_cents || 0) / 100,
        payment_method: text(payload.payment_method) || null,
        status: 'active',
        duplicated: true,
      },
    })
  }

  const subscription = await env.DB.prepare(`
    SELECT cs.id,cs.client_id,cs.plan_id,cs.status,cs.services_used_json,
           sp.name AS plan_name,sp.price_cents AS plan_price_cents,
           sp.billing_cycle AS plan_billing_cycle,sp.services_json AS plan_services_json,
           sp.status AS plan_status
    FROM client_subscriptions cs
    JOIN subscription_plans sp
      ON sp.tenant_id=cs.tenant_id AND sp.module_id=cs.module_id AND sp.id=cs.plan_id
    WHERE cs.tenant_id=?1 AND cs.module_id=?2 AND cs.id=?3
    LIMIT 1
  `).bind(scope.tenantId, scope.moduleId, subscriptionId).first<SubscriptionRow>()
  if (!subscription) return json({ code: 'SUBSCRIPTION_NOT_FOUND' }, 404)
  if (subscription.status !== 'pending_payment') {
    return json({ code: 'SUBSCRIPTION_NOT_PENDING_PAYMENT', status: subscription.status }, 409)
  }
  if (subscription.plan_status !== 'active') return json({ code: 'SUBSCRIPTION_PLAN_INACTIVE' }, 409)

  const totalCents = Math.max(0, Number(subscription.plan_price_cents || 0))
  let payments: PaymentInput[] = []
  let responsePaymentMethod = 'cortesia'
  if (totalCents > 0) {
    const parsedPayments = paymentInputs(payload, totalCents)
    if (parsedPayments instanceof Response) return parsedPayments
    payments = parsedPayments
    responsePaymentMethod = payments.length > 1 ? 'multiplo' : (text(payload.payment_method) || payments[0].method)
  }

  const saleId = crypto.randomUUID()
  const now = Date.now()
  const cycleDays = normalizeKey(subscription.plan_billing_cycle) === 'quarterly' ? 90 : 30
  const nextBillingDate = new Date(now + cycleDays * 86_400_000).toISOString().slice(0, 10)
  const notes = [
    `Pacote: ${subscription.plan_name || 'Plano'}`,
    `Assinatura: ${subscriptionId}`,
    text(payload.notes),
  ].filter(Boolean).join(' | ')

  const statements: D1PreparedStatement[] = [
    env.DB.prepare(`
      INSERT INTO sales(
        tenant_id,module_id,id,operation_key,client_id,appointment_id,subscription_id,
        source,fulfillment_type,subtotal_cents,discount_cents,transport_fee_cents,total_cents,
        status,notes,created_at_ms,updated_at_ms
      ) VALUES(?1,?2,?3,?4,?5,NULL,?6,'pos','service',?7,0,0,?7,'completed',?8,?9,?9)
    `).bind(
      scope.tenantId,
      scope.moduleId,
      saleId,
      operationKey,
      subscription.client_id,
      subscriptionId,
      totalCents,
      notes,
      now,
    ),
    env.DB.prepare(`
      UPDATE client_subscriptions
      SET status='active',started_at_ms=?1,next_billing_date=?2,services_used_json='{}',
          cancelled_at_ms=NULL,updated_at_ms=?1
      WHERE tenant_id=?3 AND module_id=?4 AND id=?5 AND status='pending_payment'
    `).bind(now, nextBillingDate, scope.tenantId, scope.moduleId, subscriptionId),
  ]

  payments.forEach((payment, index) => {
    statements.push(env.DB!.prepare(`
      INSERT INTO payments(
        tenant_id,module_id,id,sale_id,operation_key,method,amount_cents,status,
        provider,provider_reference,received_at_ms,created_at_ms,updated_at_ms
      ) VALUES(?1,?2,?3,?4,?5,?6,?7,'received',NULL,NULL,?8,?8,?8)
    `).bind(
      scope.tenantId,
      scope.moduleId,
      crypto.randomUUID(),
      saleId,
      `${operationKey}:payment:${index}`,
      payment.method,
      payment.amountCents,
      now,
    ))
  })

  try {
    await env.DB.batch(statements)
  } catch (error) {
    const raced = await env.DB.prepare(`
      SELECT id,total_cents,status
      FROM sales
      WHERE tenant_id=?1 AND module_id=?2 AND operation_key=?3
      LIMIT 1
    `).bind(scope.tenantId, scope.moduleId, operationKey).first<ExistingSaleRow>()
    if (raced?.id) {
      return json({
        data: {
          sale_id: raced.id,
          subscription_id: subscriptionId,
          total: Number(raced.total_cents || 0) / 100,
          payment_method: responsePaymentMethod,
          status: 'active',
          duplicated: true,
        },
      })
    }
    console.error('compat.subscription.checkout.failed', {
      tenant_id: scope.tenantId,
      module_id: scope.moduleId,
      subscription_id: subscriptionId,
      error_name: error instanceof Error ? error.name : 'Error',
    })
    return json({ code: 'SUBSCRIPTION_CHECKOUT_FAILED' }, 500)
  }

  return json({
    data: {
      sale_id: saleId,
      subscription_id: subscriptionId,
      total: totalCents / 100,
      payment_method: responsePaymentMethod,
      status: 'active',
      duplicated: false,
    },
  })
}

export async function handleSubscriptionCompatRpcRequest(
  request: Request,
  env: CompatRuntimeBindings,
): Promise<Response | null> {
  const url = new URL(request.url)
  if (url.pathname !== '/api/compat/rpc' || request.method !== 'POST') return null

  let body: JsonRecord
  try {
    body = record(await request.clone().json())
  } catch {
    return null
  }

  const name = text(body.name)
  if (!name || !SUBSCRIPTION_RPC_NAMES.has(name)) return null
  const args = record(body.args)
  if (name === 'reconcile_petshop_completed_appointment_package') {
    return reconcileCompletedAppointment(request, env, args)
  }
  return checkoutSubscription(request, env, args)
}

export const SUBSCRIPTION_COMPAT_RPC_NAMES = Object.freeze([...SUBSCRIPTION_RPC_NAMES])
