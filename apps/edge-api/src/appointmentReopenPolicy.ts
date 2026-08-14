import type { CompatRuntimeBindings } from './compatApiRuntime.js'
import { appendAppointmentOperationalAudit } from './appointmentOperationalAudit'

type JsonRecord = Record<string, unknown>

type AppointmentLifecycleRow = {
  status: string
  version: number
  subscription_id: string | null
  subscription_benefit_used: number
  subscription_benefit_status: string | null
  subscription_benefits_json: string | null
}

type SaleRow = { id: string; status: string }
type PaymentRow = { id: string; status: string }
type BenefitServiceRow = { service_code: string; benefit_used: number }

export type ReopenAppointmentResult = {
  response?: Response
  reopened?: boolean
  packageReleased?: boolean
}

export type ReopenAppointmentOptions = {
  /**
   * Statements that must commit in the same D1 batch as the reopen itself.
   * Used by the explicit financial-reopen endpoint so a sale/payment reversal
   * can never commit while the appointment remains completed.
   */
  prefixStatements?: D1PreparedStatement[]
  /**
   * The caller already validated the active sale and supplied its terminal
   * financial transition in prefixStatements. The database trigger remains the
   * final race-condition guard inside the same transaction.
   */
  financialGuardSatisfied?: boolean
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

function text(value: unknown): string {
  return String(value ?? '').trim()
}

function parseArray(value: string | null): JsonRecord[] {
  if (!value) return []
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.map(record) : []
  } catch {
    return []
  }
}

function normalizeStatus(value: unknown): string {
  const status = text(value).toLowerCase()
  return ({
    agendado: 'scheduled',
    confirmado: 'confirmed',
    em_andamento: 'in_progress',
    concluido: 'completed',
    cancelado: 'cancelled',
    bloqueado: 'blocked',
    disponivel: 'available',
  } as Record<string, string>)[status] || status
}

function jsonPath(key: string): string {
  const escaped = key.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
  return `$."${escaped}"`
}

function benefitUsageKey(benefit: JsonRecord): string {
  return text(benefit.key || benefit.benefit_key || benefit.service_code)
}

function releaseBenefitSnapshots(benefits: JsonRecord[]): {
  snapshots: JsonRecord[]
  usageCounts: Map<string, number>
} {
  const usageCounts = new Map<string, number>()
  const snapshots = benefits.map((benefit) => {
    const status = text(benefit.status || '').toLowerCase()
    const key = benefitUsageKey(benefit)
    if (status === 'consumed' && key) {
      usageCounts.set(key, (usageCounts.get(key) || 0) + 1)
    }
    if (status === 'consumed' || status === 'reserved') {
      return { ...benefit, status: 'released' }
    }
    return benefit
  })
  return { snapshots, usageCounts }
}

function requestScope(request: Request): { tenantId: string; moduleId: string } | null {
  const tenantId = text(request.headers.get('x-tenant-id'))
  const moduleId = text(request.headers.get('x-module-id')).toLowerCase()
  if (!tenantId || !moduleId) return null
  return { tenantId, moduleId }
}

export function isCompletedAppointmentStatus(value: unknown): boolean {
  return normalizeStatus(value) === 'completed'
}

export function isAppointmentReopenTarget(value: unknown): boolean {
  return ['scheduled', 'confirmed', 'in_progress'].includes(normalizeStatus(value))
}

export async function completedAppointmentReopenFinancialBlocker(
  request: Request,
  env: CompatRuntimeBindings,
  appointmentId: string,
): Promise<Response | null> {
  if (!env.DB) return json({ code: 'DATABASE_NOT_CONFIGURED' }, 503)
  const scope = requestScope(request)
  if (!scope) return json({ code: 'INVALID_SCOPE' }, 400)

  const sale = await env.DB.prepare(`
    SELECT id,status
    FROM sales
    WHERE tenant_id=?1 AND module_id=?2 AND appointment_id=?3
      AND status NOT IN ('cancelled','refunded')
    ORDER BY created_at_ms DESC
    LIMIT 1
  `).bind(scope.tenantId, scope.moduleId, appointmentId).first<SaleRow>()

  if (!sale?.id) return null

  const payment = await env.DB.prepare(`
    SELECT id,status
    FROM payments
    WHERE tenant_id=?1 AND module_id=?2 AND sale_id=?3
      AND status IN ('authorized','received')
    LIMIT 1
  `).bind(scope.tenantId, scope.moduleId, sale.id).first<PaymentRow>()

  return json({
    code: payment?.id ? 'APPOINTMENT_REOPEN_REFUND_REQUIRED' : 'APPOINTMENT_REOPEN_SALE_CANCEL_REQUIRED',
    sale_id: sale.id,
    sale_status: sale.status,
    payment_status: payment?.status || null,
  }, 409)
}

export async function reopenCompletedAppointment(
  request: Request,
  env: CompatRuntimeBindings,
  appointmentId: string,
  requestedStatus: unknown,
  options: ReopenAppointmentOptions = {},
): Promise<ReopenAppointmentResult> {
  if (!env.DB) return { response: json({ code: 'DATABASE_NOT_CONFIGURED' }, 503) }
  const scope = requestScope(request)
  if (!scope) return { response: json({ code: 'INVALID_SCOPE' }, 400) }
  const targetStatus = normalizeStatus(requestedStatus)
  if (!isAppointmentReopenTarget(targetStatus)) return { reopened: false }

  const appointment = await env.DB.prepare(`
    SELECT status,version,subscription_id,subscription_benefit_used,
           subscription_benefit_status,subscription_benefits_json
    FROM appointments
    WHERE tenant_id=?1 AND module_id=?2 AND id=?3
    LIMIT 1
  `).bind(scope.tenantId, scope.moduleId, appointmentId).first<AppointmentLifecycleRow>()
  if (!appointment) return { response: json({ code: 'APPOINTMENT_NOT_FOUND' }, 404) }
  if (appointment.status !== 'completed') return { reopened: false }

  if (!options.financialGuardSatisfied) {
    const financialBlocker = await completedAppointmentReopenFinancialBlocker(request, env, appointmentId)
    if (financialBlocker) return { response: financialBlocker }
  }

  const benefits = parseArray(appointment.subscription_benefits_json)
  const released = releaseBenefitSnapshots(benefits)
  const serviceBenefits = await env.DB.prepare(`
    SELECT service_code,benefit_used
    FROM appointment_services
    WHERE tenant_id=?1 AND module_id=?2 AND appointment_id=?3
      AND benefit_used=1
    ORDER BY position
  `).bind(scope.tenantId, scope.moduleId, appointmentId).all<BenefitServiceRow>()

  // Legacy snapshots may only carry benefit_used on the service line. Use the
  // service code as a fallback only when no consumed snapshot already accounts
  // for that service key.
  if (released.usageCounts.size === 0) {
    for (const service of serviceBenefits.results) {
      const key = text(service.service_code)
      if (key) released.usageCounts.set(key, (released.usageCounts.get(key) || 0) + 1)
    }
  }

  const hadPackageContext = Boolean(
    appointment.subscription_id
    || Number(appointment.subscription_benefit_used || 0) === 1
    || appointment.subscription_benefit_status
    || benefits.length,
  )
  const now = Date.now()
  const markerStatus = targetStatus
  const statements: D1PreparedStatement[] = [
    ...(options.prefixStatements || []),
    env.DB.prepare(`
      UPDATE appointments
      SET status=?4,
          live_status='aguardando',
          checkin_at_ms=NULL,
          ready_at_ms=NULL,
          subscription_id=NULL,
          subscription_benefit_used=0,
          subscription_benefit_status=?5,
          subscription_benefits_json=?6,
          subscription_label=NULL,
          subscription_discount_cents=0,
          updated_at_ms=?7,
          version=version+1
      WHERE tenant_id=?1 AND module_id=?2 AND id=?3 AND status='completed'
    `).bind(
      scope.tenantId,
      scope.moduleId,
      appointmentId,
      markerStatus,
      hadPackageContext ? 'released' : null,
      JSON.stringify(released.snapshots),
      now,
    ),
  ]

  if (appointment.subscription_id) {
    for (const [key, count] of released.usageCounts) {
      const path = jsonPath(key)
      statements.push(env.DB.prepare(`
        UPDATE client_subscriptions
        SET services_used_json=json_set(
              services_used_json,
              ?1,
              MAX(0, COALESCE(CAST(json_extract(services_used_json, ?1) AS INTEGER),0) - ?2)
            ),
            updated_at_ms=?3
        WHERE tenant_id=?4 AND module_id=?5 AND id=?6
          AND EXISTS (
            SELECT 1 FROM appointments a
            WHERE a.tenant_id=?4 AND a.module_id=?5 AND a.id=?7
              AND a.status=?8 AND a.updated_at_ms=?3
          )
      `).bind(
        path,
        count,
        now,
        scope.tenantId,
        scope.moduleId,
        appointment.subscription_id,
        appointmentId,
        markerStatus,
      ))
    }
  }

  statements.push(env.DB.prepare(`
    UPDATE appointment_services
    SET benefit_used=0
    WHERE tenant_id=?1 AND module_id=?2 AND appointment_id=?3
      AND EXISTS (
        SELECT 1 FROM appointments a
        WHERE a.tenant_id=?1 AND a.module_id=?2 AND a.id=?3
          AND a.status=?4 AND a.updated_at_ms=?5
      )
  `).bind(scope.tenantId, scope.moduleId, appointmentId, markerStatus, now))

  try {
    await env.DB.batch(statements)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (message.includes('APPOINTMENT_REOPEN_SALE_BLOCKED')) {
      return { response: json({ code: 'APPOINTMENT_REOPEN_SALE_CANCEL_REQUIRED' }, 409) }
    }
    console.error('appointment.reopen.failed', {
      appointment_id: appointmentId,
      error_name: error instanceof Error ? error.name : 'Error',
    })
    return { response: json({ code: 'APPOINTMENT_REOPEN_FAILED' }, 500) }
  }

  const reopened = await env.DB.prepare(`
    SELECT status,updated_at_ms
    FROM appointments
    WHERE tenant_id=?1 AND module_id=?2 AND id=?3
    LIMIT 1
  `).bind(scope.tenantId, scope.moduleId, appointmentId).first<{ status: string; updated_at_ms: number }>()

  if (!reopened || reopened.status !== markerStatus || Number(reopened.updated_at_ms) !== now) {
    return { response: json({ code: 'APPOINTMENT_REOPEN_CONCURRENT_CHANGE' }, 409) }
  }

  await appendAppointmentOperationalAudit(env, {
    tenantId: scope.tenantId,
    moduleId: scope.moduleId,
    appointmentId,
    eventType: 'appointment.reopened',
    transitionVersion: Number(appointment.version || 0),
    title: 'Atendimento reaberto',
    description: 'O atendimento concluído voltou ao fluxo operacional.',
    metadata: {
      from_status: 'completed',
      to_status: markerStatus,
    },
  })

  if (hadPackageContext) {
    await appendAppointmentOperationalAudit(env, {
      tenantId: scope.tenantId,
      moduleId: scope.moduleId,
      appointmentId,
      eventType: 'appointment.package_released',
      transitionVersion: Number(appointment.version || 0),
      title: 'Benefício de pacote devolvido',
      description: 'A reabertura devolveu ao pacote o benefício consumido pelo atendimento.',
      metadata: {
        subscription_id: appointment.subscription_id,
        released_services: Object.fromEntries(released.usageCounts),
      },
    })
  }

  return {
    reopened: true,
    packageReleased: hadPackageContext,
  }
}
