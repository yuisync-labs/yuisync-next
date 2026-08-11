import {
  COMPAT_TABLE_NAMES as BASE_COMPAT_TABLE_NAMES,
  handleCompatApiRequest as handleBaseCompatApiRequest,
  type CompatRuntimeBindings,
} from './compatApiRuntime.js'
import { handleAppointmentCommandPolicy } from './appointmentBookingIdempotency'
import { handleCompletedAppointmentReopenCompat } from './appointmentReopenCompat'
import { handleCompletedAppointmentReopenQueryCompat } from './appointmentReopenQueryCompat'
import {
  DEFERRED_COMPAT_RPC_NAMES,
  DEFERRED_COMPAT_TABLE_NAMES,
  handleDeferredCompatApiRequest,
} from './compatDeferredApi'
import {
  handleOperationalCompatRpcRequest,
  OPERATIONAL_COMPAT_RPC_NAMES,
} from './compatOperationalRpc'
import {
  handleSubscriptionCompatRpcRequest,
  SUBSCRIPTION_COMPAT_RPC_NAMES,
} from './compatSubscriptionRpc'

type CompatQueryBody = Record<string, unknown> & {
  table?: unknown
  action?: unknown
  filters?: unknown
  orders?: unknown
  conflict?: unknown
  mode?: unknown
}

const LEGACY_TIMESTAMP_COLUMNS: Readonly<Record<string, Readonly<Record<string, string>>>> = Object.freeze({
  loyalty_settings: Object.freeze({ updated_at: 'updated_at_ms' }),
  loyalty_points: Object.freeze({ created_at: 'created_at_ms' }),
  commission_rules: Object.freeze({ updated_at: 'updated_at_ms' }),
  billing_settings: Object.freeze({ updated_at: 'updated_at_ms' }),
  accounting_services: Object.freeze({ created_at: 'created_at_ms', updated_at: 'updated_at_ms' }),
  tenant_fiscal_profiles: Object.freeze({ updated_at: 'updated_at_ms' }),
  fiscal_audit_logs: Object.freeze({ created_at: 'created_at_ms' }),
  petshop_growth_booking_settings: Object.freeze({ updated_at: 'updated_at_ms' }),
  petshop_growth_leads: Object.freeze({
    created_at: 'created_at_ms',
    updated_at: 'updated_at_ms',
    next_followup_at: 'next_followup_at_ms',
    last_contact_at: 'last_contact_at_ms',
  }),
  petshop_growth_booking_requests: Object.freeze({ created_at: 'created_at_ms', updated_at: 'updated_at_ms' }),
  petshop_growth_no_show_policy: Object.freeze({ updated_at: 'updated_at_ms' }),
  petshop_growth_no_show_events: Object.freeze({ created_at: 'created_at_ms' }),
  petshop_campaign_logs: Object.freeze({ created_at: 'created_at_ms' }),
  petshop_growth_report_cards: Object.freeze({ created_at: 'created_at_ms', updated_at: 'updated_at_ms' }),
  support_threads: Object.freeze({
    created_at: 'created_at_ms',
    updated_at: 'updated_at_ms',
    last_message_at: 'last_message_at_ms',
  }),
  support_messages: Object.freeze({ created_at: 'created_at_ms' }),
  tenant_platform_subscriptions: Object.freeze({
    started_at: 'started_at_ms',
    expires_at: 'expires_at_ms',
    updated_at: 'updated_at_ms',
  }),
  tenant_ai_usage_monthly: Object.freeze({ updated_at: 'updated_at_ms' }),
})

function asObject(value: unknown): CompatQueryBody {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? { ...(value as CompatQueryBody) }
    : {}
}

function mapColumn(table: string, column: unknown): unknown {
  if (typeof column !== 'string') return column
  return LEGACY_TIMESTAMP_COLUMNS[table]?.[column] ?? column
}

function rewriteFilters(table: string, value: unknown): unknown {
  if (!Array.isArray(value)) return value
  return value.map((filter) => {
    if (!filter || typeof filter !== 'object' || Array.isArray(filter)) return filter
    const next = { ...(filter as Record<string, unknown>) }
    next.column = mapColumn(table, next.column)

    if (next.op === 'or' && typeof next.expression === 'string') {
      next.expression = next.expression
        .split(',')
        .map((part) => {
          const trimmed = part.trim()
          const match = /^([A-Za-z_][A-Za-z0-9_]*)(\..*)$/.exec(trimmed)
          if (!match) return trimmed
          return `${String(mapColumn(table, match[1]))}${match[2]}`
        })
        .join(',')
    }
    return next
  })
}

function rewriteOrders(table: string, value: unknown): unknown {
  if (!Array.isArray(value)) return value
  return value.map((order) => {
    if (!order || typeof order !== 'object' || Array.isArray(order)) return order
    const next = { ...(order as Record<string, unknown>) }
    next.column = mapColumn(table, next.column)
    return next
  })
}

export function normalizeBaseCompatQueryBody(value: unknown): CompatQueryBody {
  const body = asObject(value)
  const table = typeof body.table === 'string' ? body.table : ''
  body.filters = rewriteFilters(table, body.filters)
  body.orders = rewriteOrders(table, body.orders)

  if (typeof body.conflict === 'string') {
    body.conflict = body.conflict
      .split(',')
      .map((column) => column.trim())
      .filter((column, index, all) =>
        column && column !== 'tenant_id' && column !== 'module_id' && all.indexOf(column) === index,
      )
      .join(',')
  }

  return body
}

async function prepareBaseCompatRequest(request: Request): Promise<{ request: Request; body: CompatQueryBody | null }> {
  const path = new URL(request.url).pathname
  if (path !== '/api/compat/query' || request.method !== 'POST') {
    return { request, body: null }
  }

  let parsed: unknown
  try {
    parsed = await request.clone().json()
  } catch {
    return { request, body: null }
  }

  const body = normalizeBaseCompatQueryBody(parsed)
  const headers = new Headers(request.headers)
  headers.set('content-type', 'application/json')
  return {
    request: new Request(request.url, {
      method: request.method,
      headers,
      body: JSON.stringify(body),
    }),
    body,
  }
}

async function normalizeOptionalSingletonResponse(
  body: CompatQueryBody | null,
  response: Response | null,
): Promise<Response | null> {
  if (!body || !response || response.status !== 406) return response
  if (body.table !== 'billing_settings' || body.mode !== 'single') return response

  let payload: unknown
  try {
    payload = await response.clone().json()
  } catch {
    return response
  }
  const objectPayload = asObject(payload)
  if (objectPayload.code !== 'ROW_NOT_SINGLE' || Number(objectPayload.count) !== 0) return response

  return Response.json(
    { data: null, count: 0 },
    { status: 200, headers: { 'cache-control': 'no-store' } },
  )
}

export async function handleCompatApiRequest(
  request: Request,
  env: CompatRuntimeBindings,
): Promise<Response | null> {
  const directReopenResponse = await handleCompletedAppointmentReopenQueryCompat(request, env)
  if (directReopenResponse) return directReopenResponse
  const deferredRequest = request.clone() as Request
  const deferredResponse = await handleDeferredCompatApiRequest(deferredRequest, env)
  if (deferredResponse) return deferredResponse
  const subscriptionResponse = await handleSubscriptionCompatRpcRequest(request, env)
  if (subscriptionResponse) return subscriptionResponse
  const appointmentReopenResponse = await handleCompletedAppointmentReopenCompat(request, env)
  if (appointmentReopenResponse) return appointmentReopenResponse
  const appointmentCommandResponse = await handleAppointmentCommandPolicy(request, env)
  if (appointmentCommandResponse) return appointmentCommandResponse
  const operationalResponse = await handleOperationalCompatRpcRequest(request, env)
  if (operationalResponse) return operationalResponse

  const prepared = await prepareBaseCompatRequest(request)
  const response = await handleBaseCompatApiRequest(prepared.request, env)
  return normalizeOptionalSingletonResponse(prepared.body, response)
}

export const COMPAT_TABLE_NAMES = Object.freeze([
  ...BASE_COMPAT_TABLE_NAMES,
  ...DEFERRED_COMPAT_TABLE_NAMES,
])
export const COMPAT_RPC_NAMES = Object.freeze([
  ...OPERATIONAL_COMPAT_RPC_NAMES,
  ...SUBSCRIPTION_COMPAT_RPC_NAMES,
  ...DEFERRED_COMPAT_RPC_NAMES,
])
export type { CompatRuntimeBindings } from './compatApiRuntime.js'
