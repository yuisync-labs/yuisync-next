import {
  handleCompatApiRequest as handleBaseCompatApiRequest,
  type CompatRuntimeBindings,
} from './compatApiRuntime.js'
import { handleOperationalCompatRpcRequest } from './compatOperationalRpc'

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function text(value: unknown): string {
  return String(value ?? '').trim()
}

function serviceCodes(payload: Record<string, unknown>): string[] {
  const raw = Array.isArray(payload.services)
    ? payload.services
    : Array.isArray(payload.service_items) ? payload.service_items : []
  const codes = raw
    .map((entry) => {
      const item = record(entry)
      return text(item.code || item.service_code || item.service_type || item.id)
    })
    .filter(Boolean)
  if (!codes.length && text(payload.service_type)) codes.push(text(payload.service_type))
  return [...new Set(codes)].sort()
}

function canonicalIntent(request: Request, payload: Record<string, unknown>): string {
  return JSON.stringify({
    tenant_id: text(request.headers.get('x-tenant-id')),
    module_id: text(request.headers.get('x-module-id')).toLowerCase(),
    client_id: text(payload.client_id),
    pet_id: text(payload.pet_id),
    scheduled_at: text(payload.scheduled_at),
    service_group: text(payload.service_group),
    services: serviceCodes(payload),
    transport_mode: text(payload.transport_mode),
    source: text(payload.source || 'manual'),
  })
}

async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function deterministicAppointmentId(hash: string): string {
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`
}

async function existingAppointment(
  request: Request,
  env: CompatRuntimeBindings,
  appointmentId: string,
): Promise<Response> {
  const url = new URL(request.url)
  url.pathname = '/api/compat/query'
  url.search = ''
  const headers = new Headers(request.headers)
  headers.set('content-type', 'application/json')
  return (await handleBaseCompatApiRequest(new Request(url.toString(), {
    method: 'POST',
    headers,
    body: JSON.stringify({
      table: 'appointments',
      action: 'select',
      filters: [{ op: 'eq', column: 'id', value: appointmentId }],
      mode: 'maybeSingle',
      limit: 1,
    }),
  }), env)) || Response.json({ code: 'COMPAT_QUERY_UNAVAILABLE' }, { status: 503 })
}

export async function handleIdempotentAppointmentBooking(
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
  if (text(body.name) !== 'book_petshop_appointment_transaction') return null

  const args = record(body.args)
  const payload = record(args.p_payload)

  // Explicit IDs are already caller-owned idempotency keys. Preserve them.
  const explicitId = text(payload.id)
  const intentHash = await sha256(canonicalIntent(request, payload))
  const appointmentId = explicitId || deterministicAppointmentId(intentHash)
  const operationKey = text(payload.operation_key) || `appointment-booking:${intentHash}`

  const existing = await existingAppointment(request, env, appointmentId)
  if (!existing.ok) return existing
  const existingPayload = record(await existing.json())
  if (existingPayload.data) {
    return Response.json({
      data: {
        appointment_id: appointmentId,
        appointment: existingPayload.data,
        idempotent: true,
        operation_key: operationKey,
      },
    }, { headers: { 'cache-control': 'no-store' } })
  }

  const nextBody = {
    ...body,
    args: {
      ...args,
      p_payload: {
        ...payload,
        id: appointmentId,
        operation_key: operationKey,
      },
    },
  }
  const headers = new Headers(request.headers)
  headers.set('content-type', 'application/json')
  const delegated = await handleOperationalCompatRpcRequest(new Request(request.url, {
    method: 'POST',
    headers,
    body: JSON.stringify(nextBody),
  }), env)
  if (!delegated) return Response.json({ code: 'APPOINTMENT_BOOKING_UNAVAILABLE' }, { status: 503 })
  if (!delegated.ok) return delegated

  const result = record(await delegated.json())
  const data = record(result.data)
  return Response.json({
    ...result,
    data: {
      ...data,
      appointment_id: appointmentId,
      idempotent: false,
      operation_key: operationKey,
    },
  }, { headers: { 'cache-control': 'no-store' } })
}
