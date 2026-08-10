import {
  handleCompatApiRequest as handleBaseCompatApiRequest,
  type CompatRuntimeBindings,
} from './compatApiRuntime.js'

const OPERATIONAL_RPC_NAMES = new Set([
  'book_petshop_appointment_transaction',
  'update_petshop_appointment_transaction',
  'checkout_petshop_appointment_transaction',
])

const SCOPE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/
const MODULE_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/

type AppointmentRow = {
  id: string
  client_id: string
  status: string
  subtotal_cents: number
  transport_fee_cents: number
  subscription_id: string | null
  subscription_discount_cents: number | null
  subscription_benefit_status: string | null
  subscription_benefits_json: string | null
}

type AppointmentServiceRow = {
  position: number
  service_id: string
  service_code: string
  service_name: string
  unit_price_cents: number
  benefit_used: number
}

type ExistingSaleRow = {
  id: string
  total_cents: number
  status: string
}

type PaymentInput = {
  method: string
  amountCents: number
}

function json(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { 'cache-control': 'no-store' },
  })
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function text(value: unknown): string | null {
  const normalized = String(value ?? '').trim()
  return normalized || null
}

function number(value: unknown, fallback = 0): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function cents(value: unknown): number {
  return Math.round(number(value) * 100)
}

function scopeMismatch(request: Request, payload: Record<string, unknown>): boolean {
  const headerTenant = text(request.headers.get('x-tenant-id'))
  const headerModule = text(request.headers.get('x-module-id'))?.toLowerCase() || null
  const payloadTenant = text(payload.tenant_id)
  const payloadModule = text(payload.module_id)?.toLowerCase() || null
  return Boolean(
    (payloadTenant && headerTenant && payloadTenant !== headerTenant)
    || (payloadModule && headerModule && payloadModule !== headerModule)
  )
}

function requestScope(request: Request): { tenantId: string; moduleId: string } | null {
  const tenantId = text(request.headers.get('x-tenant-id'))
  const moduleId = text(request.headers.get('x-module-id'))?.toLowerCase() || null
  if (!tenantId || !moduleId || !SCOPE_ID.test(tenantId) || !MODULE_ID.test(moduleId)) return null
  return { tenantId, moduleId }
}

function normalizePaymentMethod(value: unknown): string | null {
  const normalized = String(value ?? '').trim().toLowerCase()
  if (!normalized) return null
  if (normalized.includes('pix')) return 'pix'
  if (normalized === 'cash' || normalized.includes('dinheiro')) return 'cash'
  if (
    normalized === 'card'
    || normalized.includes('credito')
    || normalized.includes('crédito')
    || normalized.includes('debito')
    || normalized.includes('débito')
    || normalized.includes('cartao')
    || normalized.includes('cartão')
  ) return 'card'
  return null
}

function parseBenefits(value: string | null): Record<string, unknown>[] {
  if (!value) return []
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.map(record) : []
  } catch {
    return []
  }
}

function serviceCoveredByBenefit(
  service: AppointmentServiceRow,
  services: AppointmentServiceRow[],
  benefits: Record<string, unknown>[],
  fallbackStatus: string | null,
): boolean {
  if (Number(service.benefit_used) === 1) return true
  const activeBenefits = benefits.filter((benefit) => {
    const status = String(benefit.status ?? fallbackStatus ?? 'reserved')
    return status === 'reserved' || status === 'consumed'
  })
  const serviceBenefits = activeBenefits.filter((benefit) => String(benefit.kind ?? '') === 'service')
  return serviceBenefits.some((benefit) => {
    const benefitCode = text(benefit.service_code)
    const benefitKey = text(benefit.key ?? benefit.benefit_key)
    return Boolean(
      (benefitCode && benefitCode === service.service_code)
      || (benefitKey && benefitKey === service.service_code)
      || (services.length === 1 && !benefitCode)
    )
  })
}

function paymentInputs(payload: Record<string, unknown>, totalCents: number): PaymentInput[] | Response {
  const rawSplits = Array.isArray(payload.payment_splits) ? payload.payment_splits : []
  if (rawSplits.length) {
    const payments: PaymentInput[] = []
    for (const entry of rawSplits) {
      const split = record(entry)
      const amountCents = cents(split.amount)
      if (amountCents <= 0) continue
      const method = normalizePaymentMethod(split.method)
      if (!method) return json({ code: 'INVALID_PAYMENT_METHOD' }, 400)
      payments.push({ method, amountCents })
    }
    if (!payments.length) return json({ code: 'PAYMENT_REQUIRED' }, 400)
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
  body: Record<string, unknown>,
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

async function authorizeAppointment(
  request: Request,
  env: CompatRuntimeBindings,
  appointmentId: string,
): Promise<Response | null> {
  const response = await runBaseQuery(request, env, {
    table: 'appointments',
    action: 'select',
    filters: [{ op: 'eq', column: 'id', value: appointmentId }],
    mode: 'maybeSingle',
    limit: 1,
  })
  if (!response.ok) return response
  const result = record(await response.json())
  if (!result.data) return json({ code: 'APPOINTMENT_NOT_FOUND' }, 404)
  return null
}

async function appointmentRpc(
  request: Request,
  env: CompatRuntimeBindings,
  name: string,
  args: Record<string, unknown>,
): Promise<Response> {
  const payload = record(args.p_payload)
  if (scopeMismatch(request, payload)) return json({ code: 'SCOPE_MISMATCH' }, 400)

  if (name === 'book_petshop_appointment_transaction') {
    const appointmentId = text(payload.id) || crypto.randomUUID()
    const response = await runBaseQuery(request, env, {
      table: 'appointments',
      action: 'insert',
      payload: { ...payload, id: appointmentId },
      filters: [{ op: 'eq', column: 'id', value: appointmentId }],
      mode: 'single',
      returning: true,
    })
    if (!response.ok) return response
    const result = record(await response.json())
    return json({
      data: {
        appointment_id: appointmentId,
        appointment: result.data ?? null,
      },
    })
  }

  const appointmentId = text(args.p_appointment_id)
  if (!appointmentId) return json({ code: 'APPOINTMENT_ID_REQUIRED' }, 400)
  const response = await runBaseQuery(request, env, {
    table: 'appointments',
    action: 'update',
    payload,
    filters: [{ op: 'eq', column: 'id', value: appointmentId }],
    mode: 'single',
    returning: true,
  })
  if (!response.ok) return response
  const result = record(await response.json())
  return json({
    data: {
      appointment_id: appointmentId,
      appointment: result.data ?? null,
    },
  })
}

async function checkoutAppointmentRpc(
  request: Request,
  env: CompatRuntimeBindings,
  args: Record<string, unknown>,
): Promise<Response> {
  const payload = record(args.p_payload)
  if (scopeMismatch(request, payload)) return json({ code: 'SCOPE_MISMATCH' }, 400)
  const scope = requestScope(request)
  if (!scope) return json({ code: 'INVALID_SCOPE' }, 400)
  if (!env.DB) return json({ code: 'DATABASE_NOT_CONFIGURED' }, 503)

  const appointmentId = text(payload.appointment_id)
  if (!appointmentId) return json({ code: 'APPOINTMENT_ID_REQUIRED' }, 400)

  const authorizationError = await authorizeAppointment(request, env, appointmentId)
  if (authorizationError) return authorizationError

  const operationKey = `appointment-checkout:${appointmentId}`
  const existing = await env.DB.prepare(`
    SELECT id,total_cents,status
    FROM sales
    WHERE tenant_id=?1 AND module_id=?2 AND operation_key=?3
    LIMIT 1
  `).bind(scope.tenantId, scope.moduleId, operationKey).first<ExistingSaleRow>()
  if (existing?.id) {
    return json({
      data: {
        sale_id: existing.id,
        appointment_id: appointmentId,
        total: Number(existing.total_cents || 0) / 100,
        status: existing.status,
        idempotent: true,
      },
    })
  }

  const appointment = await env.DB.prepare(`
    SELECT id,client_id,status,subtotal_cents,transport_fee_cents,
           subscription_id,subscription_discount_cents,subscription_benefit_status,subscription_benefits_json
    FROM appointments
    WHERE tenant_id=?1 AND module_id=?2 AND id=?3
    LIMIT 1
  `).bind(scope.tenantId, scope.moduleId, appointmentId).first<AppointmentRow>()
  if (!appointment) return json({ code: 'APPOINTMENT_NOT_FOUND' }, 404)
  if (appointment.status !== 'completed') {
    return json({ code: 'APPOINTMENT_NOT_COMPLETED', status: appointment.status }, 409)
  }

  const serviceResult = await env.DB.prepare(`
    SELECT position,service_id,service_code,service_name,unit_price_cents,benefit_used
    FROM appointment_services
    WHERE tenant_id=?1 AND module_id=?2 AND appointment_id=?3
    ORDER BY position
  `).bind(scope.tenantId, scope.moduleId, appointmentId).all<AppointmentServiceRow>()
  const services = serviceResult.results

  const catalogServiceCents = services.length
    ? services.reduce((sum, service) => sum + Math.max(0, Number(service.unit_price_cents || 0)), 0)
    : Math.max(0, Number(appointment.subtotal_cents || 0))
  const benefits = parseBenefits(appointment.subscription_benefits_json)
  const benefitDiscountCents = services.reduce((sum, service) => (
    sum + (serviceCoveredByBenefit(
      service,
      services,
      benefits,
      appointment.subscription_benefit_status,
    ) ? Math.max(0, Number(service.unit_price_cents || 0)) : 0)
  ), 0)
  const storedDiscountCents = Math.max(0, Number(appointment.subscription_discount_cents || 0))
  const discountCents = Math.min(catalogServiceCents, Math.max(storedDiscountCents, benefitDiscountCents))

  const requestedTransportCents = Math.max(0, cents(payload.transport_fee))
  const catalogTransportCents = Math.max(
    0,
    cents(payload.transport_catalog_fee),
    Number(appointment.transport_fee_cents || 0),
  )
  if (catalogTransportCents > 0 && requestedTransportCents > catalogTransportCents) {
    return json({
      code: 'TRANSPORT_FEE_EXCEEDS_CATALOG',
      catalog_cents: catalogTransportCents,
      requested_cents: requestedTransportCents,
    }, 409)
  }

  const totalCents = Math.max(0, catalogServiceCents - discountCents + requestedTransportCents)
  if (totalCents <= 0) {
    return json({ code: 'PAYMENT_NOT_REQUIRED', appointment_id: appointmentId }, 409)
  }

  const payments = paymentInputs(payload, totalCents)
  if (payments instanceof Response) return payments

  const saleId = crypto.randomUUID()
  const now = Date.now()
  const statements: D1PreparedStatement[] = [
    env.DB.prepare(`
      INSERT INTO sales(
        tenant_id,module_id,id,operation_key,client_id,appointment_id,subscription_id,
        source,fulfillment_type,subtotal_cents,discount_cents,transport_fee_cents,total_cents,
        status,notes,created_at_ms,updated_at_ms
      ) VALUES(?1,?2,?3,?4,?5,?6,?7,'pos','service',?8,?9,?10,?11,'completed',?12,?13,?13)
    `).bind(
      scope.tenantId,
      scope.moduleId,
      saleId,
      operationKey,
      appointment.client_id,
      appointmentId,
      appointment.subscription_id,
      catalogServiceCents,
      discountCents,
      requestedTransportCents,
      totalCents,
      text(payload.notes),
      now,
    ),
  ]

  for (const service of services) {
    statements.push(env.DB.prepare(`
      INSERT INTO sale_items(
        tenant_id,module_id,sale_id,position,item_type,product_id,service_id,
        item_name,quantity_milliunits,unit_price_cents,subtotal_cents,upsell
      ) VALUES(?1,?2,?3,?4,'service',NULL,?5,?6,1000,?7,?7,0)
    `).bind(
      scope.tenantId,
      scope.moduleId,
      saleId,
      Number(service.position || 0),
      service.service_id,
      service.service_name,
      Math.max(0, Number(service.unit_price_cents || 0)),
    ))
  }

  payments.forEach((payment, index) => {
    const paymentId = crypto.randomUUID()
    statements.push(env.DB!.prepare(`
      INSERT INTO payments(
        tenant_id,module_id,id,sale_id,operation_key,method,amount_cents,status,
        provider,provider_reference,received_at_ms,created_at_ms,updated_at_ms
      ) VALUES(?1,?2,?3,?4,?5,?6,?7,'received',NULL,NULL,?8,?8,?8)
    `).bind(
      scope.tenantId,
      scope.moduleId,
      paymentId,
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
    const message = error instanceof Error ? error.message : String(error)
    if (/unique|constraint/i.test(message)) {
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
            appointment_id: appointmentId,
            total: Number(raced.total_cents || 0) / 100,
            status: raced.status,
            idempotent: true,
          },
        })
      }
    }
    console.error('compat.checkout.failed', {
      appointment_id: appointmentId,
      tenant_id: scope.tenantId,
      module_id: scope.moduleId,
      error_name: error instanceof Error ? error.name : 'Error',
    })
    return json({ code: 'CHECKOUT_FAILED' }, 500)
  }

  return json({
    data: {
      sale_id: saleId,
      appointment_id: appointmentId,
      subtotal: catalogServiceCents / 100,
      discount: discountCents / 100,
      delivery_fee: requestedTransportCents / 100,
      total: totalCents / 100,
      status: 'concluido',
      payment_method: payments.length > 1 ? 'multiplo' : payments[0].method,
      idempotent: false,
    },
  })
}

export async function handleOperationalCompatRpcRequest(
  request: Request,
  env: CompatRuntimeBindings,
): Promise<Response | null> {
  const url = new URL(request.url)
  if (url.pathname !== '/api/compat/rpc' || request.method !== 'POST') return null

  let body: Record<string, unknown>
  try {
    body = record(await request.clone().json())
  } catch {
    return null
  }

  const name = text(body.name)
  if (!name || !OPERATIONAL_RPC_NAMES.has(name)) return null
  const args = record(body.args)
  if (name === 'checkout_petshop_appointment_transaction') {
    return checkoutAppointmentRpc(request, env, args)
  }
  return appointmentRpc(request, env, name, args)
}

export const OPERATIONAL_COMPAT_RPC_NAMES = Object.freeze([...OPERATIONAL_RPC_NAMES])
