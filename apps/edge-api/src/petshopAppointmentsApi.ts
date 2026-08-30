import { getBetterAuthSession, type BetterAuthRuntimeBindings } from './auth/betterAuthRuntime'
import { handleCompatApiRequest, type CompatRuntimeBindings } from './compatApi'

type Bindings = BetterAuthRuntimeBindings & CompatRuntimeBindings & { DB?: D1Database }
type Scope = { tenantId: string; moduleId: string }
type JsonRecord = Record<string, unknown>

type AppointmentReadRow = {
  id: string
  client_id: string
  pet_id: string
  scheduled_at_ms: number
  duration_min: number
  service_group: string | null
  status: string
  source: string
  subtotal_cents: number
  notes: string | null
  created_at_ms: number
  updated_at_ms: number
  employee_id: string | null
  groomer_id: string | null
  grooming_machine_no: number | null
  responsible_staff_key: string | null
  responsible_staff_name: string | null
  delivery_staff_key: string | null
  delivery_staff_name: string | null
  transport_mode: string | null
  transport_label: string | null
  transport_address: string | null
  transport_reference: string | null
  live_status: string | null
  checkin_at_ms: number | null
  ready_at_ms: number | null
  subscription_id: string | null
  subscription_benefit_used: number
  subscription_benefit_status: string | null
  billing_intent_type: string | null
  billing_intent_subscription_id: string | null
  service_items_json: string
  owner_name: string
  owner_document: string | null
  owner_phone: string | null
  owner_email: string | null
  owner_address: string | null
  owner_address_number: string | null
  owner_address_complement: string | null
  owner_address_reference: string | null
  owner_neighborhood: string | null
  owner_city: string | null
  owner_postal_code: string | null
  owner_notes: string | null
  pet_name: string
  pet_species: string
  pet_breed: string | null
  pet_birth_date: string | null
  pet_weight_kg: number | null
  pet_color: string | null
  pet_notes: string | null
}

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/
const json = (body: unknown, status = 200, headers?: HeadersInit) => Response.json(body, {
  status,
  headers: {
    'cache-control': 'no-store',
    ...Object.fromEntries(new Headers(headers).entries()),
  },
})
const text = (value: unknown) => String(value ?? '').trim()
const record = (value: unknown): JsonRecord => value && typeof value === 'object' && !Array.isArray(value)
  ? value as JsonRecord
  : {}

function hasModuleAccess(role: string, rawPermissions: string | null, moduleId: string): boolean {
  if (role === 'owner' || role === 'admin') return true
  try {
    const permissions = JSON.parse(rawPermissions || '{}') as Record<string, unknown>
    return permissions['*'] === true
      || permissions[moduleId] === true
      || Boolean(permissions[moduleId] && typeof permissions[moduleId] === 'object')
  } catch {
    return false
  }
}

async function resolveScope(request: Request, bindings: Bindings): Promise<{ scope?: Scope; error?: Response }> {
  if (!bindings.DB) return { error: json({ code: 'DATABASE_NOT_CONFIGURED' }, 503) }
  const tenantId = text(request.headers.get('x-tenant-id'))
  const moduleId = text(request.headers.get('x-module-id')).toLowerCase()
  if (!ID.test(tenantId) || moduleId !== 'petshop') return { error: json({ code: 'INVALID_SCOPE' }, 400) }

  const session = await getBetterAuthSession(request, bindings)
  const userId = text(session?.user?.id)
  if (!userId) return { error: json({ code: 'UNAUTHENTICATED' }, 401) }

  const membership = await bindings.DB.prepare(`
    SELECT m.role,m.module_permissions_json
    FROM identity_principals p
    JOIN tenant_memberships m ON m.principal_id=p.id
    WHERE p.provider='better-auth' AND p.subject=?1 AND p.status='active'
      AND m.tenant_id=?2 AND m.status='active'
    LIMIT 1
  `).bind(userId, tenantId).first<{ role: string; module_permissions_json: string | null }>()
  if (!membership || !hasModuleAccess(membership.role, membership.module_permissions_json, moduleId)) {
    return { error: json({ code: 'FORBIDDEN' }, 403) }
  }
  return { scope: { tenantId, moduleId } }
}

const STATUS_TO_CANONICAL: Record<string, string> = {
  agendado: 'scheduled',
  confirmado: 'confirmed',
  em_andamento: 'in_progress',
  concluido: 'completed',
  cancelado: 'cancelled',
  bloqueado: 'blocked',
  disponivel: 'available',
}
const STATUS_TO_LEGACY: Record<string, string> = Object.fromEntries(
  Object.entries(STATUS_TO_CANONICAL).map(([legacy, canonical]) => [canonical, legacy]),
)

function epochParam(value: string | null): number | null | typeof Number.NaN {
  if (!value) return null
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : Number.NaN
}

function parseItems(value: string): unknown[] {
  try {
    const parsed = JSON.parse(value || '[]')
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function appointmentPayload(row: AppointmentReadRow) {
  const serviceItems = parseItems(row.service_items_json)
  const first = record(serviceItems[0])
  return {
    id: row.id,
    pet_id: row.pet_id,
    client_id: row.client_id,
    service_type: text(first.code) || null,
    service_group: row.service_group,
    service_items: serviceItems,
    scheduled_at: new Date(row.scheduled_at_ms).toISOString(),
    duration_min: Number(row.duration_min || 60),
    price: Number(row.subtotal_cents || 0) / 100,
    status: STATUS_TO_LEGACY[row.status] || row.status,
    notes: row.notes,
    source: row.source,
    created_at: new Date(row.created_at_ms).toISOString(),
    updated_at: new Date(row.updated_at_ms).toISOString(),
    employee_id: row.employee_id,
    groomer_id: row.groomer_id,
    grooming_machine_no: row.grooming_machine_no,
    responsible_staff_key: row.responsible_staff_key,
    responsible_staff_name: row.responsible_staff_name,
    delivery_staff_key: row.delivery_staff_key,
    delivery_staff_name: row.delivery_staff_name,
    transport_mode: row.transport_mode,
    transport_label: row.transport_label,
    transport_address: row.transport_address,
    transport_neighborhood: null,
    transport_city: null,
    transport_reference: row.transport_reference,
    live_status: row.live_status,
    checkin_at: row.checkin_at_ms === null ? null : new Date(row.checkin_at_ms).toISOString(),
    ready_at: row.ready_at_ms === null ? null : new Date(row.ready_at_ms).toISOString(),
    subscription_id: row.subscription_id,
    subscription_benefit_used: row.subscription_benefit_used === 1,
    subscription_benefit_status: row.subscription_benefit_status,
    billing_intent_type: row.billing_intent_type,
    billing_intent_subscription_id: row.billing_intent_subscription_id,
    pets: {
      id: row.pet_id,
      client_id: row.client_id,
      owner_name: row.owner_name,
      owner_cpf: row.owner_document,
      phone: row.owner_phone,
      email: row.owner_email,
      owner_address: row.owner_address,
      address_number: row.owner_address_number,
      address_complement: row.owner_address_complement,
      address_reference: row.owner_address_reference,
      owner_neighborhood: row.owner_neighborhood,
      owner_city: row.owner_city,
      zip_code: row.owner_postal_code,
      pet_name: row.pet_name,
      species: row.pet_species,
      breed: row.pet_breed,
      birth_date: row.pet_birth_date,
      weight_kg: row.pet_weight_kg,
      color: row.pet_color,
      notes: row.pet_notes || row.owner_notes,
    },
  }
}

const APPOINTMENT_READ_SQL = `
  SELECT a.id,a.client_id,a.pet_id,a.scheduled_at_ms,a.duration_min,a.service_group,a.status,a.source,
    a.subtotal_cents,a.notes,a.created_at_ms,a.updated_at_ms,a.employee_id,a.groomer_id,a.grooming_machine_no,
    a.responsible_staff_key,a.responsible_staff_name,a.delivery_staff_key,a.delivery_staff_name,
    t.option_id AS transport_mode,o.label AS transport_label,t.pickup_address AS transport_address,
    t.pickup_reference AS transport_reference,a.live_status,a.checkin_at_ms,a.ready_at_ms,
    a.subscription_id,a.subscription_benefit_used,a.subscription_benefit_status,
    a.billing_intent_type,a.billing_intent_subscription_id,
    COALESCE((SELECT json_group_array(json_object(
      'code',s.service_code,'service_id',s.service_id,'name',s.service_name,'group_type',s.service_group,
      'unit_price',s.unit_price_cents/100.0,'catalog_price',COALESCE(s.catalog_price_cents,s.unit_price_cents)/100.0,
      'duration_min',s.duration_min,'commission_type','percentage',
      'commission_rate',CASE WHEN s.commission_basis_points IS NULL THEN NULL ELSE s.commission_basis_points/100.0 END,
      'min_weight_kg',s.min_weight_kg,'max_weight_kg',s.max_weight_kg,'species_target',s.species_target,
      'benefit_used',s.benefit_used=1
    )) FROM appointment_services s WHERE s.tenant_id=a.tenant_id AND s.module_id=a.module_id AND s.appointment_id=a.id),'[]') AS service_items_json,
    c.name AS owner_name,c.document AS owner_document,c.phone AS owner_phone,c.email AS owner_email,
    c.address AS owner_address,c.address_number AS owner_address_number,c.address_complement AS owner_address_complement,
    c.address_reference AS owner_address_reference,c.neighborhood AS owner_neighborhood,c.city AS owner_city,
    c.postal_code AS owner_postal_code,c.notes AS owner_notes,
    p.name AS pet_name,p.species AS pet_species,p.breed AS pet_breed,p.birth_date AS pet_birth_date,
    p.weight_kg AS pet_weight_kg,p.color AS pet_color,p.notes AS pet_notes
  FROM appointments a
  JOIN clients c ON c.tenant_id=a.tenant_id AND c.module_id=a.module_id AND c.id=a.client_id
  JOIN pets p ON p.tenant_id=a.tenant_id AND p.module_id=a.module_id AND p.id=a.pet_id
  LEFT JOIN appointment_transport t ON t.tenant_id=a.tenant_id AND t.module_id=a.module_id AND t.appointment_id=a.id
  LEFT JOIN transport_options o ON o.tenant_id=t.tenant_id AND o.module_id=t.module_id AND o.id=t.option_id
`

async function readAppointments(request: Request, bindings: Bindings, appointmentId?: string): Promise<Response> {
  const resolved = await resolveScope(request, bindings)
  if (resolved.error) return resolved.error
  const scope = resolved.scope!
  const url = new URL(request.url)
  const start = epochParam(url.searchParams.get('start'))
  const end = epochParam(url.searchParams.get('end'))
  if (Number.isNaN(start) || Number.isNaN(end)) return json({ code: 'INVALID_DATE_RANGE' }, 400)
  const requestedStatus = text(url.searchParams.get('status')).toLowerCase()
  const status = requestedStatus ? (STATUS_TO_CANONICAL[requestedStatus] || requestedStatus) : null
  const serviceType = text(url.searchParams.get('service_type')) || null
  const employeeId = text(url.searchParams.get('employee_id')) || null

  const statement = bindings.DB!.prepare(`${APPOINTMENT_READ_SQL}
    WHERE a.tenant_id=?1 AND a.module_id=?2
      AND (?3 IS NULL OR a.id=?3)
      AND (?4 IS NULL OR a.scheduled_at_ms>=?4)
      AND (?5 IS NULL OR a.scheduled_at_ms<=?5)
      AND (?6 IS NULL OR a.status=?6)
      AND (?7 IS NULL OR a.employee_id=?7 OR a.groomer_id=?7 OR a.responsible_staff_key=?7)
      AND (?8 IS NULL OR EXISTS(SELECT 1 FROM appointment_services sx
        WHERE sx.tenant_id=a.tenant_id AND sx.module_id=a.module_id AND sx.appointment_id=a.id AND sx.service_code=?8))
    ORDER BY a.scheduled_at_ms,a.id
    LIMIT ?9
  `).bind(scope.tenantId, scope.moduleId, appointmentId || null, start, end, status, employeeId, serviceType, appointmentId ? 1 : 500)
  const result = await statement.all<AppointmentReadRow>()
  const appointments = (result.results || []).map(appointmentPayload)
  if (appointmentId) return appointments[0] ? json({ appointment: appointments[0] }) : json({ code: 'APPOINTMENT_NOT_FOUND' }, 404)
  return json({ appointments })
}

async function normalizeAppointmentParty(bindings: Bindings, scope: Scope, payload: JsonRecord): Promise<JsonRecord | Response> {
  const candidatePetId = text(payload.pet_id) || text(payload.client_id)
  if (!candidatePetId) return payload
  const pet = await bindings.DB!.prepare(`
    SELECT id,client_id FROM pets
    WHERE tenant_id=?1 AND module_id=?2 AND id=?3 AND status='active'
    LIMIT 1
  `).bind(scope.tenantId, scope.moduleId, candidatePetId).first<{ id: string; client_id: string }>()
  if (!pet) return json({ code: 'PET_NOT_FOUND' }, 404)
  return { ...payload, pet_id: pet.id, client_id: pet.client_id }
}

async function mutateAppointment(request: Request, bindings: Bindings, appointmentId?: string): Promise<Response> {
  const resolved = await resolveScope(request, bindings)
  if (resolved.error) return resolved.error
  const scope = resolved.scope!
  let body: JsonRecord
  try { body = record(await request.json()) } catch { return json({ code: 'INVALID_JSON' }, 400) }
  const normalized = await normalizeAppointmentParty(bindings, scope, body)
  if (normalized instanceof Response) return normalized
  const headers = new Headers(request.headers)
  headers.set('content-type', 'application/json')
  const commandRequest = new Request(new URL('/api/compat/rpc', request.url), {
    method: 'POST',
    headers,
    body: JSON.stringify({
      name: appointmentId ? 'update_petshop_appointment_transaction' : 'book_petshop_appointment_transaction',
      args: appointmentId
        ? { p_appointment_id: appointmentId, p_payload: normalized }
        : { p_payload: normalized },
    }),
  })
  const command = await handleCompatApiRequest(commandRequest, bindings)
  if (!command) return json({ code: 'APPOINTMENT_COMMAND_UNAVAILABLE' }, 503)
  if (!command.ok) return command
  const envelope = record(await command.json())
  const commandData = record(envelope.data)
  const id = appointmentId || text(commandData.appointment_id)
  const readRequest = new Request(new URL(`/api/petshop/appointments/${encodeURIComponent(id)}`, request.url), {
    headers: request.headers,
  })
  return readAppointments(readRequest, bindings, id)
}

async function removeAppointment(request: Request, bindings: Bindings, appointmentId: string): Promise<Response> {
  const resolved = await resolveScope(request, bindings)
  if (resolved.error) return resolved.error
  const headers = new Headers(request.headers)
  headers.set('content-type', 'application/json')
  const compat = await handleCompatApiRequest(new Request(new URL('/api/compat/query', request.url), {
    method: 'POST',
    headers,
    body: JSON.stringify({
      table: 'appointments', action: 'delete', filters: [{ op: 'eq', column: 'id', value: appointmentId }], returning: false,
    }),
  }), bindings)
  if (!compat) return json({ code: 'APPOINTMENT_COMMAND_UNAVAILABLE' }, 503)
  if (!compat.ok) return compat
  return json({ deleted: true, appointment_id: appointmentId })
}

export async function handlePetshopAppointmentsApiRequest(request: Request, bindings: Bindings): Promise<Response | null> {
  const { pathname } = new URL(request.url)
  const collection = /^\/api\/petshop\/appointments\/?$/.test(pathname)
  const match = /^\/api\/petshop\/appointments\/([^/]+)\/?$/.exec(pathname)
  if (!collection && !match) return null
  const appointmentId = match ? decodeURIComponent(match[1]) : undefined
  if (appointmentId && !ID.test(appointmentId)) return json({ code: 'INVALID_APPOINTMENT' }, 400)
  if (request.method === 'GET') return readAppointments(request, bindings, appointmentId)
  if (request.method === 'POST' && collection) return mutateAppointment(request, bindings)
  if (request.method === 'PATCH' && appointmentId) return mutateAppointment(request, bindings, appointmentId)
  if (request.method === 'DELETE' && appointmentId) return removeAppointment(request, bindings, appointmentId)
  return json({ code: 'METHOD_NOT_ALLOWED' }, 405, { allow: collection ? 'GET, POST' : 'GET, PATCH, DELETE' })
}
