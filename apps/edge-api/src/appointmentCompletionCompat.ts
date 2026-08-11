import {
  handleCompatApiRequest as handleBaseCompatApiRequest,
  type CompatRuntimeBindings,
} from './compatApiRuntime.js'
import { handleAppointmentCommandPolicy } from './appointmentBookingIdempotency'
import { appendAppointmentOperationalAudit } from './appointmentOperationalAudit'
import { handleSubscriptionCompatRpcRequest } from './compatSubscriptionRpc'

type JsonRecord = Record<string, unknown>

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

function normalizedAppointmentStatus(value: unknown): string {
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

function requestScope(request: Request): { tenantId: string; moduleId: string } | null {
  const tenantId = text(request.headers.get('x-tenant-id'))
  const moduleId = text(request.headers.get('x-module-id')).toLowerCase()
  if (!tenantId || !moduleId) return null
  return { tenantId, moduleId }
}

async function authorizedAppointmentState(
  request: Request,
  env: CompatRuntimeBindings,
  appointmentId: string,
): Promise<{ response?: Response; status?: string; version?: number }> {
  const url = new URL(request.url)
  url.pathname = '/api/compat/query'
  url.search = ''
  const headers = new Headers(request.headers)
  headers.set('content-type', 'application/json')
  const response = await handleBaseCompatApiRequest(new Request(url.toString(), {
    method: 'POST',
    headers,
    body: JSON.stringify({
      table: 'appointments',
      action: 'select',
      filters: [{ op: 'eq', column: 'id', value: appointmentId }],
      mode: 'maybeSingle',
      limit: 1,
    }),
  }), env)
  if (!response) return { response: json({ code: 'COMPAT_QUERY_UNAVAILABLE' }, 503) }
  if (!response.ok) return { response }
  const envelope = record(await response.json())
  const appointment = record(envelope.data)
  if (!Object.keys(appointment).length) return { response: json({ code: 'APPOINTMENT_NOT_FOUND' }, 404) }

  const scope = requestScope(request)
  if (!scope || !env.DB) return { response: json({ code: 'DATABASE_NOT_CONFIGURED' }, 503) }
  const raw = await env.DB.prepare(`
    SELECT version
    FROM appointments
    WHERE tenant_id=?1 AND module_id=?2 AND id=?3
    LIMIT 1
  `).bind(scope.tenantId, scope.moduleId, appointmentId).first<{ version: number }>()
  return {
    status: normalizedAppointmentStatus(appointment.status),
    version: Math.max(0, Number(raw?.version || 0)),
  }
}

export function isAppointmentCompletionTarget(value: unknown): boolean {
  return normalizedAppointmentStatus(value) === 'completed'
}

export async function handleCompletedAppointmentCompletionCompat(
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
  if (text(body.name) !== 'update_petshop_appointment_transaction') return null

  const args = record(body.args)
  const payload = record(args.p_payload)
  if (!isAppointmentCompletionTarget(payload.status)) return null
  const appointmentId = text(args.p_appointment_id)
  if (!appointmentId) return json({ code: 'APPOINTMENT_ID_REQUIRED' }, 400)

  // Authenticate/authorize first and retain the pre-transition version. That
  // version becomes the idempotent audit identity for concurrent/replayed calls.
  const before = await authorizedAppointmentState(request, env, appointmentId)
  if (before.response) return before.response

  // The normal appointment command remains the single writer for the lifecycle
  // transition and commercial snapshots. Completion only coordinates the
  // package reconciliation that must follow that successful write.
  const command = await handleAppointmentCommandPolicy(request, env)
  if (!command) return json({ code: 'APPOINTMENT_COMPLETION_COMMAND_UNAVAILABLE' }, 503)
  if (!command.ok) return command

  const headers = new Headers(request.headers)
  headers.set('content-type', 'application/json')
  const reconciliation = await handleSubscriptionCompatRpcRequest(new Request(request.url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      name: 'reconcile_petshop_completed_appointment_package',
      args: { p_appointment_id: appointmentId },
    }),
  }), env)

  if (!reconciliation) {
    return json({
      code: 'APPOINTMENT_COMPLETION_PACKAGE_RECONCILIATION_UNAVAILABLE',
      appointment_id: appointmentId,
      appointment_completed: true,
      retry_safe: true,
    }, 503)
  }

  if (!reconciliation.ok) {
    let cause: JsonRecord = {}
    try { cause = record(await reconciliation.clone().json()) } catch { /* sanitized below */ }
    return json({
      code: 'APPOINTMENT_COMPLETION_PACKAGE_RECONCILIATION_FAILED',
      appointment_id: appointmentId,
      appointment_completed: true,
      retry_safe: true,
      cause_code: text(cause.code) || null,
    }, reconciliation.status >= 400 ? reconciliation.status : 500)
  }

  const commandEnvelope = record(await command.json())
  const reconciliationEnvelope = record(await reconciliation.json())
  const reconciliationData = record(reconciliationEnvelope.data)
  const scope = requestScope(request)

  if (scope && before.status !== 'completed') {
    await appendAppointmentOperationalAudit(env, {
      tenantId: scope.tenantId,
      moduleId: scope.moduleId,
      appointmentId,
      eventType: 'appointment.completed',
      transitionVersion: Number(before.version || 0),
      title: 'Atendimento concluído',
      description: 'O atendimento foi movido para concluído pelo fluxo operacional.',
      metadata: {
        from_status: before.status || null,
        to_status: 'completed',
      },
    })
  }

  if (scope && reconciliationData.covered_by_subscription === true && reconciliationData.changed === true) {
    await appendAppointmentOperationalAudit(env, {
      tenantId: scope.tenantId,
      moduleId: scope.moduleId,
      appointmentId,
      eventType: 'appointment.package_consumed',
      transitionVersion: Number(before.version || 0),
      title: 'Benefício de pacote consumido',
      description: 'A conclusão do atendimento consumiu o benefício de uma assinatura ativa.',
      metadata: {
        subscription_id: text(reconciliationData.subscription_id) || null,
        consumed_qty: Number(reconciliationData.consumed_qty || 0),
        discount: Number(reconciliationData.discount || 0),
      },
    })
  }

  return json({
    data: {
      ...record(commandEnvelope.data),
      appointment_id: appointmentId,
      completed: true,
      package_reconciliation: reconciliationData,
    },
  })
}
