import type { CompatRuntimeBindings } from './compatApiRuntime.js'
import { handleAppointmentCommandPolicy } from './appointmentBookingIdempotency'
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
  return json({
    data: {
      ...record(commandEnvelope.data),
      appointment_id: appointmentId,
      completed: true,
      package_reconciliation: record(reconciliationEnvelope.data),
    },
  })
}
