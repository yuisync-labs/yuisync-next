import type { CompatRuntimeBindings } from './compatApiRuntime.js'
import { handleCompletedAppointmentReopenCompat } from './appointmentReopenCompat'
import { isAppointmentReopenTarget } from './appointmentReopenPolicy'

type JsonRecord = Record<string, unknown>

function record(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : {}
}

function text(value: unknown): string {
  return String(value ?? '').trim()
}

export async function handleCompletedAppointmentReopenQueryCompat(
  request: Request,
  env: CompatRuntimeBindings,
): Promise<Response | null> {
  const url = new URL(request.url)
  if (url.pathname !== '/api/compat/query' || request.method !== 'POST') return null

  let body: JsonRecord
  try {
    body = record(await request.clone().json())
  } catch {
    return null
  }
  if (text(body.table) !== 'appointments' || text(body.action) !== 'update') return null
  const payload = record(body.payload)
  if (!isAppointmentReopenTarget(payload.status)) return null

  const filters = Array.isArray(body.filters) ? body.filters.map(record) : []
  const appointmentId = text(filters.find((filter) => (
    text(filter.op) === 'eq' && text(filter.column) === 'id'
  ))?.value)
  if (!appointmentId) {
    return Response.json({ code: 'APPOINTMENT_ID_REQUIRED' }, {
      status: 400,
      headers: { 'cache-control': 'no-store' },
    })
  }

  const headers = new Headers(request.headers)
  headers.set('content-type', 'application/json')
  return handleCompletedAppointmentReopenCompat(new Request(request.url.replace('/compat/query', '/compat/rpc'), {
    method: 'POST',
    headers,
    body: JSON.stringify({
      name: 'update_petshop_appointment_transaction',
      args: {
        p_appointment_id: appointmentId,
        p_payload: payload,
      },
    }),
  }), env)
}
