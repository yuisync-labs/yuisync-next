import {
  handleCompatApiRequest as handleBaseCompatApiRequest,
  type CompatRuntimeBindings,
} from './compatApiRuntime.js'
import { handleAppointmentCommandPolicy } from './appointmentBookingIdempotency'
import {
  completedAppointmentReopenFinancialBlocker,
  isAppointmentReopenTarget,
  isCompletedAppointmentStatus,
  reopenCompletedAppointment,
} from './appointmentReopenPolicy'

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

function serviceCodes(value: JsonRecord): string[] {
  const raw = Array.isArray(value.services)
    ? value.services
    : Array.isArray(value.service_items) ? value.service_items : []
  const codes = raw
    .map((entry) => {
      const item = record(entry)
      return text(item.code || item.service_code || item.service_type || item.id)
    })
    .filter(Boolean)
  if (!codes.length && text(value.service_type)) codes.push(text(value.service_type))
  return [...new Set(codes)].sort()
}

function sameCodes(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

async function readAppointment(
  request: Request,
  env: CompatRuntimeBindings,
  appointmentId: string,
): Promise<{ response?: Response; appointment?: JsonRecord }> {
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
  if (!envelope.data) return { response: json({ code: 'APPOINTMENT_NOT_FOUND' }, 404) }
  return { appointment: record(envelope.data) }
}

export async function handleCompletedAppointmentReopenCompat(
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
  if (!isAppointmentReopenTarget(payload.status)) return null
  const appointmentId = text(args.p_appointment_id)
  if (!appointmentId) return json({ code: 'APPOINTMENT_ID_REQUIRED' }, 400)

  // This compat read authenticates and authorizes tenant/module access before
  // the direct D1 reopen policy is allowed to inspect financial/package state.
  const current = await readAppointment(request, env, appointmentId)
  if (current.response) return current.response
  const appointment = current.appointment || {}
  if (!isCompletedAppointmentStatus(appointment.status)) return null

  const requestedPetId = text(payload.pet_id)
  const petChanged = Boolean(requestedPetId && requestedPetId !== text(appointment.pet_id))
  const requestedCodes = serviceCodes(payload)
  const existingCodes = serviceCodes({
    service_type: appointment.service_type,
    service_items: appointment.service_items,
  })
  const servicesChanged = requestedCodes.length > 0 && !sameCodes(requestedCodes, existingCodes)

  // Keep reopening a lifecycle operation. Commercial changes are allowed right
  // after the appointment is open again, but not inside the same atomic release.
  if (petChanged || servicesChanged) {
    return json({
      code: 'APPOINTMENT_REOPEN_EDIT_SEPARATELY',
      pet_changed: petChanged,
      services_changed: servicesChanged,
    }, 409)
  }

  const financialBlocker = await completedAppointmentReopenFinancialBlocker(request, env, appointmentId)
  if (financialBlocker) return financialBlocker

  // Apply non-lifecycle edits while the row is still completed. If this fails,
  // no package usage or completion state has been released yet.
  const preparationPayload = {
    ...payload,
    status: appointment.status,
  }
  const headers = new Headers(request.headers)
  headers.set('content-type', 'application/json')
  const preparation = await handleAppointmentCommandPolicy(new Request(request.url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      ...body,
      args: {
        ...args,
        p_payload: preparationPayload,
      },
    }),
  }), env)
  if (!preparation) return json({ code: 'APPOINTMENT_REOPEN_PREPARATION_UNAVAILABLE' }, 503)
  if (!preparation.ok) return preparation

  const reopened = await reopenCompletedAppointment(
    request,
    env,
    appointmentId,
    payload.status,
  )
  if (reopened.response) return reopened.response
  if (!reopened.reopened) return json({ code: 'APPOINTMENT_REOPEN_CONCURRENT_CHANGE' }, 409)

  const refreshed = await readAppointment(request, env, appointmentId)
  if (refreshed.response) return refreshed.response

  return json({
    data: {
      appointment_id: appointmentId,
      appointment: refreshed.appointment || null,
      reopened: true,
      package_released: reopened.packageReleased === true,
    },
  })
}
