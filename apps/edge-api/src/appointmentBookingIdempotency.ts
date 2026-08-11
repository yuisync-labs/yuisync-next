import {
  handleCompatApiRequest as handleBaseCompatApiRequest,
  type CompatRuntimeBindings,
} from './compatApiRuntime.js'
import { handleOperationalCompatRpcRequest } from './compatOperationalRpc'

type ServiceRow = {
  id: string
  code: string
  name: string
  group_type: string
  default_price_cents: number
  default_duration_min: number
  commission_basis_points: number
  min_weight_kg: number | null
  max_weight_kg: number | null
  species_target: string | null
  status: string
}

type PetRow = {
  id: string
  client_id: string
  species: string
  weight_kg: number | null
  status: string
}

type BookingRegistryRow = {
  operation_key: string
  appointment_id: string
  operation_fingerprint: string
  status: 'reserved' | 'completed'
}

type SnapshotItem = Record<string, unknown> & {
  code?: unknown
  service_code?: unknown
  service_id?: unknown
  id?: unknown
  catalog_price?: unknown
  unit_price?: unknown
  commission_rate?: unknown
  min_weight_kg?: unknown
  max_weight_kg?: unknown
  species_target?: unknown
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function text(value: unknown): string {
  return String(value ?? '').trim()
}

function number(value: unknown, fallback = 0): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function requestedServiceCodes(payload: Record<string, unknown>): string[] {
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
  return [...new Set(codes)]
}

function snapshotServiceCodes(items: unknown): string[] {
  return (Array.isArray(items) ? items : [])
    .map((entry) => {
      const item = record(entry)
      return text(item.code || item.service_code || item.service_type || item.id)
    })
    .filter(Boolean)
}

function sameCodeSet(left: string[], right: string[]): boolean {
  const a = [...new Set(left)].sort()
  const b = [...new Set(right)].sort()
  return a.length === b.length && a.every((value, index) => value === b[index])
}

function serviceCodes(payload: Record<string, unknown>): string[] {
  return requestedServiceCodes(payload).sort()
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

function payloadScopeMismatch(request: Request, payload: Record<string, unknown>): boolean {
  const headerTenant = text(request.headers.get('x-tenant-id'))
  const headerModule = text(request.headers.get('x-module-id')).toLowerCase()
  const payloadTenant = text(payload.tenant_id)
  const payloadModule = text(payload.module_id).toLowerCase()
  return Boolean(
    (payloadTenant && headerTenant && payloadTenant !== headerTenant)
    || (payloadModule && headerModule && payloadModule !== headerModule)
  )
}

async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function deterministicAppointmentId(hash: string): string {
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`
}

async function scopedOperationIdentityHash(
  request: Request,
  callerKey: string,
): Promise<string> {
  return sha256(JSON.stringify({
    tenant_id: text(request.headers.get('x-tenant-id')),
    module_id: text(request.headers.get('x-module-id')).toLowerCase(),
    caller_key: callerKey,
  }))
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

async function reserveBookingOperation(
  request: Request,
  env: CompatRuntimeBindings,
  operationKey: string,
  appointmentId: string,
  fingerprint: string,
): Promise<{ row?: BookingRegistryRow; error?: Response }> {
  if (!env.DB) return { error: Response.json({ code: 'DATABASE_NOT_CONFIGURED' }, { status: 503 }) }
  const tenantId = text(request.headers.get('x-tenant-id'))
  const moduleId = text(request.headers.get('x-module-id')).toLowerCase()
  const now = Date.now()

  await env.DB.prepare(`
    INSERT OR IGNORE INTO appointment_command_registry(
      tenant_id,module_id,operation_key,appointment_id,operation_fingerprint,status,created_at_ms,updated_at_ms
    ) VALUES(?1,?2,?3,?4,?5,'reserved',?6,?6)
  `).bind(tenantId, moduleId, operationKey, appointmentId, fingerprint, now).run()

  const row = await env.DB.prepare(`
    SELECT operation_key,appointment_id,operation_fingerprint,status
    FROM appointment_command_registry
    WHERE tenant_id=?1 AND module_id=?2 AND operation_key=?3
    LIMIT 1
  `).bind(tenantId, moduleId, operationKey).first<BookingRegistryRow>()

  if (!row) {
    return { error: Response.json({ code: 'IDEMPOTENCY_RESERVATION_FAILED' }, { status: 500 }) }
  }
  if (row.appointment_id !== appointmentId || row.operation_fingerprint !== fingerprint) {
    return {
      error: Response.json({
        code: 'IDEMPOTENCY_KEY_REUSED',
        appointment_id: row.appointment_id,
      }, { status: 409, headers: { 'cache-control': 'no-store' } }),
    }
  }
  return { row }
}

async function completeBookingOperation(
  request: Request,
  env: CompatRuntimeBindings,
  operationKey: string,
): Promise<void> {
  if (!env.DB) return
  const tenantId = text(request.headers.get('x-tenant-id'))
  const moduleId = text(request.headers.get('x-module-id')).toLowerCase()
  await env.DB.prepare(`
    UPDATE appointment_command_registry
    SET status='completed',updated_at_ms=?4
    WHERE tenant_id=?1 AND module_id=?2 AND operation_key=?3
  `).bind(tenantId, moduleId, operationKey, Date.now()).run()
}

async function resolveServiceSnapshots(
  request: Request,
  env: CompatRuntimeBindings,
  payload: Record<string, unknown>,
): Promise<{ serviceItems?: SnapshotItem[]; error?: Response }> {
  if (!env.DB) return { error: Response.json({ code: 'DATABASE_NOT_CONFIGURED' }, { status: 503 }) }
  const tenantId = text(request.headers.get('x-tenant-id'))
  const moduleId = text(request.headers.get('x-module-id')).toLowerCase()
  const petId = text(payload.pet_id)
  const clientId = text(payload.client_id)
  const codes = requestedServiceCodes(payload)
  if (!codes.length) return { error: Response.json({ code: 'SERVICE_REQUIRED' }, { status: 400 }) }
  if (codes.length > 10) return { error: Response.json({ code: 'TOO_MANY_SERVICES' }, { status: 400 }) }

  const pet = petId
    ? await env.DB.prepare(`
        SELECT id,client_id,species,weight_kg,status
        FROM pets
        WHERE tenant_id=?1 AND module_id=?2 AND id=?3
        LIMIT 1
      `).bind(tenantId, moduleId, petId).first<PetRow>()
    : null
  if (!pet || pet.status !== 'active') {
    return { error: Response.json({ code: 'PET_NOT_FOUND' }, { status: 404 }) }
  }
  if (clientId && pet.client_id !== clientId) {
    return { error: Response.json({ code: 'PET_CLIENT_MISMATCH' }, { status: 409 }) }
  }

  const requestedItems = new Map(
    (Array.isArray(payload.service_items) ? payload.service_items : Array.isArray(payload.services) ? payload.services : [])
      .map((entry) => {
        const item = record(entry)
        const code = text(item.code || item.service_code || item.service_type || item.id)
        return [code, item] as const
      })
      .filter(([code]) => Boolean(code)),
  )

  const serviceItems: SnapshotItem[] = []
  let group: string | null = null

  for (const code of codes) {
    const service = await env.DB.prepare(`
      SELECT id,code,name,group_type,default_price_cents,default_duration_min,
             commission_basis_points,min_weight_kg,max_weight_kg,species_target,status
      FROM services
      WHERE tenant_id=?1 AND module_id=?2 AND code=?3
      LIMIT 1
    `).bind(tenantId, moduleId, code).first<ServiceRow>()

    if (!service || service.status !== 'active') {
      return { error: Response.json({ code: 'SERVICE_NOT_FOUND', service_code: code }, { status: 404 }) }
    }
    if (!group) group = service.group_type
    if (group !== service.group_type) {
      return { error: Response.json({ code: 'MIXED_SERVICE_GROUPS' }, { status: 409 }) }
    }
    if (service.species_target && service.species_target !== pet.species) {
      return { error: Response.json({
        code: 'SERVICE_SPECIES_MISMATCH',
        service_code: code,
        service_species: service.species_target,
        pet_species: pet.species,
      }, { status: 409 }) }
    }
    const weight = pet.weight_kg == null ? null : Number(pet.weight_kg)
    if (weight !== null && service.min_weight_kg !== null && weight < Number(service.min_weight_kg)) {
      return { error: Response.json({ code: 'SERVICE_WEIGHT_MISMATCH', service_code: code }, { status: 409 }) }
    }
    if (weight !== null && service.max_weight_kg !== null && weight > Number(service.max_weight_kg)) {
      return { error: Response.json({ code: 'SERVICE_WEIGHT_MISMATCH', service_code: code }, { status: 409 }) }
    }

    const requested = requestedItems.get(code) || {}
    serviceItems.push({
      ...requested,
      id: service.id,
      service_id: service.id,
      code: service.code,
      service_code: service.code,
      name: service.name,
      group_type: service.group_type,
      unit_price: Number(service.default_price_cents || 0) / 100,
      catalog_price: Number(service.default_price_cents || 0) / 100,
      duration_min: Number(service.default_duration_min || 60),
      commission_type: 'percentage',
      commission_rate: Number(service.commission_basis_points || 0) / 100,
      min_weight_kg: service.min_weight_kg,
      max_weight_kg: service.max_weight_kg,
      species_target: service.species_target,
      benefit_used: requested.benefit_used === true,
    })
  }

  return { serviceItems }
}

function snapshotPrice(items: SnapshotItem[]): number {
  return items.reduce((sum, item) => sum + Math.max(0, number(item.unit_price)), 0)
}

async function persistOperationalSnapshots(
  request: Request,
  env: CompatRuntimeBindings,
  appointmentId: string,
  operationKey: string | null,
  operationFingerprint: string | null,
  items: SnapshotItem[],
): Promise<void> {
  if (!env.DB) return
  const tenantId = text(request.headers.get('x-tenant-id'))
  const moduleId = text(request.headers.get('x-module-id')).toLowerCase()
  const statements: D1PreparedStatement[] = []

  if (operationKey || operationFingerprint) {
    statements.push(env.DB.prepare(`
      UPDATE appointments
      SET operation_key=COALESCE(?4,operation_key),
          operation_fingerprint=COALESCE(?5,operation_fingerprint)
      WHERE tenant_id=?1 AND module_id=?2 AND id=?3
    `).bind(tenantId, moduleId, appointmentId, operationKey, operationFingerprint))
  }

  items.forEach((item, position) => {
    statements.push(env.DB!.prepare(`
      UPDATE appointment_services
      SET catalog_price_cents=?5,
          commission_basis_points=?6,
          min_weight_kg=?7,
          max_weight_kg=?8,
          species_target=?9
      WHERE tenant_id=?1 AND module_id=?2 AND appointment_id=?3 AND position=?4
    `).bind(
      tenantId,
      moduleId,
      appointmentId,
      position,
      Math.max(0, Math.round(number(item.catalog_price, number(item.unit_price)) * 100)),
      item.commission_rate === null || item.commission_rate === undefined || item.commission_rate === ''
        ? null
        : Math.max(0, Math.min(10000, Math.round(number(item.commission_rate) * 100))),
      item.min_weight_kg === null || item.min_weight_kg === undefined ? null : number(item.min_weight_kg),
      item.max_weight_kg === null || item.max_weight_kg === undefined ? null : number(item.max_weight_kg),
      ['dog', 'cat'].includes(text(item.species_target)) ? text(item.species_target) : null,
    ))
  })
  if (statements.length) await env.DB.batch(statements)
}

async function delegateOperationalRpc(
  request: Request,
  env: CompatRuntimeBindings,
  body: Record<string, unknown>,
): Promise<Response> {
  const headers = new Headers(request.headers)
  headers.set('content-type', 'application/json')
  return (await handleOperationalCompatRpcRequest(new Request(request.url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  }), env)) || Response.json({ code: 'APPOINTMENT_COMMAND_UNAVAILABLE' }, { status: 503 })
}

async function handleBooking(
  request: Request,
  env: CompatRuntimeBindings,
  body: Record<string, unknown>,
  args: Record<string, unknown>,
  payload: Record<string, unknown>,
): Promise<Response> {
  if (payloadScopeMismatch(request, payload)) {
    return Response.json({ code: 'SCOPE_MISMATCH' }, { status: 400 })
  }

  const intentHash = await sha256(canonicalIntent(request, payload))
  const callerKey = text(payload.idempotency_key) || text(payload.operation_key)
  if (callerKey.length > 512) {
    return Response.json({ code: 'INVALID_IDEMPOTENCY_KEY' }, { status: 400 })
  }

  // New clients send an explicit operation identity. Legacy callers without one
  // retain the old intent-hash behavior only as a compatibility fallback.
  const operationIdentity = callerKey || `legacy-intent:${intentHash}`
  const operationIdentityHash = await scopedOperationIdentityHash(request, operationIdentity)
  const operationKey = `appointment-booking:${operationIdentityHash}`
  const explicitId = text(payload.id)
  const appointmentId = explicitId || deterministicAppointmentId(operationIdentityHash)

  // This authorized compat read happens before direct D1 command reservation,
  // so the ledger never becomes an authentication bypass.
  const existingResponse = await existingAppointment(request, env, appointmentId)
  if (!existingResponse.ok) return existingResponse
  const existingEnvelope = record(await existingResponse.json())
  const existing = record(existingEnvelope.data)

  const reservation = await reserveBookingOperation(
    request,
    env,
    operationKey,
    appointmentId,
    intentHash,
  )
  if (reservation.error) return reservation.error

  if (Object.keys(existing).length) {
    const persistedOperationKey = text(existing.operation_key)
    const persistedFingerprint = text(existing.operation_fingerprint)
    if (persistedOperationKey && persistedOperationKey !== operationKey) {
      return Response.json({ code: 'APPOINTMENT_ID_CONFLICT', appointment_id: appointmentId }, { status: 409 })
    }
    if (persistedFingerprint && persistedFingerprint !== intentHash) {
      return Response.json({ code: 'IDEMPOTENCY_KEY_REUSED', appointment_id: appointmentId }, { status: 409 })
    }
    if (reservation.row?.status === 'completed') {
      return Response.json({
        data: {
          appointment_id: appointmentId,
          appointment: existing,
          idempotent: true,
          operation_key: operationKey,
        },
      }, { headers: { 'cache-control': 'no-store' } })
    }
    // A reserved command with an appointment already present means an earlier
    // attempt stopped between the base write and snapshot completion. Replaying
    // the same command repairs the same deterministic appointment instead of
    // creating a second one.
  }

  const resolved = await resolveServiceSnapshots(request, env, payload)
  if (resolved.error) return resolved.error
  const serviceItems = resolved.serviceItems || []
  const nextPayload = {
    ...payload,
    id: appointmentId,
    operation_key: operationKey,
    operation_fingerprint: intentHash,
    service_items: serviceItems,
    service_group: text(serviceItems[0]?.group_type) || payload.service_group,
  }
  const delegated = await delegateOperationalRpc(request, env, {
    ...body,
    args: { ...args, p_payload: nextPayload },
  })
  if (!delegated.ok) return delegated

  try {
    await persistOperationalSnapshots(
      request,
      env,
      appointmentId,
      operationKey,
      intentHash,
      serviceItems,
    )
    await completeBookingOperation(request, env, operationKey)
  } catch (error) {
    console.error('appointment.booking.snapshot_failed', {
      appointment_id: appointmentId,
      error_name: error instanceof Error ? error.name : 'Error',
    })
    return Response.json({ code: 'APPOINTMENT_SNAPSHOT_FAILED' }, { status: 500 })
  }

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

async function handleUpdate(
  request: Request,
  env: CompatRuntimeBindings,
  body: Record<string, unknown>,
  args: Record<string, unknown>,
  payload: Record<string, unknown>,
): Promise<Response> {
  const appointmentId = text(args.p_appointment_id)
  if (!appointmentId) return Response.json({ code: 'APPOINTMENT_ID_REQUIRED' }, { status: 400 })

  const existingResponse = await existingAppointment(request, env, appointmentId)
  if (!existingResponse.ok) return existingResponse
  const existingEnvelope = record(await existingResponse.json())
  const existing = record(existingEnvelope.data)
  if (!Object.keys(existing).length) return Response.json({ code: 'APPOINTMENT_NOT_FOUND' }, { status: 404 })

  const existingItems = (Array.isArray(existing.service_items) ? existing.service_items : []).map((item) => record(item) as SnapshotItem)
  const requestedCodes = requestedServiceCodes(payload)
  const existingCodes = snapshotServiceCodes(existingItems)
  const requestedPetId = text(payload.pet_id) || text(existing.pet_id)
  const petChanged = Boolean(text(payload.pet_id) && text(payload.pet_id) !== text(existing.pet_id))
  const serviceChanged = requestedCodes.length > 0 && !sameCodeSet(requestedCodes, existingCodes)

  let serviceItems = existingItems
  if (serviceChanged || petChanged || !serviceItems.length) {
    const resolved = await resolveServiceSnapshots(request, env, {
      ...payload,
      client_id: text(payload.client_id) || text(existing.client_id),
      pet_id: requestedPetId,
      services: requestedCodes.length
        ? requestedCodes.map((code) => ({ code }))
        : existingCodes.map((code) => ({ code })),
    })
    if (resolved.error) return resolved.error
    serviceItems = resolved.serviceItems || []
  }

  // Agenda currently sends a full form snapshot. If services/pet did not really
  // change, do not let a later catalog price edit silently reprice an old booking.
  const preserveCommercialSnapshot = !serviceChanged && !petChanged && existingItems.length > 0
  const nextPayload: Record<string, unknown> = {
    ...payload,
    pet_id: requestedPetId,
    service_items: serviceItems,
    service_group: text(serviceItems[0]?.group_type) || payload.service_group || existing.service_group,
  }
  if (preserveCommercialSnapshot) {
    nextPayload.price = existing.price
  } else if (serviceItems.length && !('price' in payload)) {
    nextPayload.price = snapshotPrice(serviceItems)
  }

  const delegated = await delegateOperationalRpc(request, env, {
    ...body,
    args: { ...args, p_payload: nextPayload },
  })
  if (!delegated.ok) return delegated

  try {
    await persistOperationalSnapshots(request, env, appointmentId, null, null, serviceItems)
  } catch (error) {
    console.error('appointment.update.snapshot_failed', {
      appointment_id: appointmentId,
      error_name: error instanceof Error ? error.name : 'Error',
    })
    return Response.json({ code: 'APPOINTMENT_SNAPSHOT_FAILED' }, { status: 500 })
  }

  const result = record(await delegated.json())
  return Response.json({
    ...result,
    data: {
      ...record(result.data),
      appointment_id: appointmentId,
      snapshot_policy: preserveCommercialSnapshot ? 'preserved' : 'refreshed',
    },
  }, { headers: { 'cache-control': 'no-store' } })
}

export async function handleAppointmentCommandPolicy(
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
  if (name !== 'book_petshop_appointment_transaction' && name !== 'update_petshop_appointment_transaction') return null

  const args = record(body.args)
  const payload = record(args.p_payload)
  if (name === 'book_petshop_appointment_transaction') {
    return handleBooking(request, env, body, args, payload)
  }
  return handleUpdate(request, env, body, args, payload)
}
