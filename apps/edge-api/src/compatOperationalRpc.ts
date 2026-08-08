import {
  handleCompatApiRequest as handleBaseCompatApiRequest,
  type CompatRuntimeBindings,
} from './compatApiRuntime.js'

const OPERATIONAL_RPC_NAMES = new Set([
  'book_petshop_appointment_transaction',
  'update_petshop_appointment_transaction',
])

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
  return appointmentRpc(request, env, name, record(body.args))
}

export const OPERATIONAL_COMPAT_RPC_NAMES = Object.freeze([...OPERATIONAL_RPC_NAMES])
