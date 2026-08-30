import { getBetterAuthSession, type BetterAuthRuntimeBindings } from './auth/betterAuthRuntime'

type Bindings = BetterAuthRuntimeBindings & { DB?: D1Database }
type Scope = { tenantId: string; moduleId: string }
type JsonRecord = Record<string, unknown>
type ClientPetRow = {
  id: string
  client_id: string
  pet_name: string
  species: string
  breed: string | null
  pet_birth_date: string | null
  weight_kg: number | null
  color: string | null
  pet_notes: string | null
  pet_created_at_ms: number
  owner_name: string
  document: string | null
  phone: string | null
  email: string | null
  tutor_birth_date: string | null
  address: string | null
  address_number: string | null
  address_complement: string | null
  address_reference: string | null
  neighborhood: string | null
  city: string | null
  postal_code: string | null
  client_notes: string | null
}

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/
const json = (body: unknown, status = 200, headers?: HeadersInit) => Response.json(body, {
  status,
  headers: { 'cache-control': 'no-store', ...Object.fromEntries(new Headers(headers).entries()) },
})
const text = (value: unknown) => String(value ?? '').trim()
const nullable = (value: unknown) => text(value) || null
const record = (value: unknown): JsonRecord => value && typeof value === 'object' && !Array.isArray(value)
  ? value as JsonRecord
  : {}

function hasModuleAccess(role: string, rawPermissions: string | null): boolean {
  if (role === 'owner' || role === 'admin') return true
  try {
    const permissions = JSON.parse(rawPermissions || '{}') as Record<string, unknown>
    return permissions['*'] === true || permissions.petshop === true || Boolean(permissions.petshop && typeof permissions.petshop === 'object')
  } catch { return false }
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
    SELECT m.role,m.module_permissions_json FROM identity_principals p
    JOIN tenant_memberships m ON m.principal_id=p.id
    WHERE p.provider='better-auth' AND p.subject=?1 AND p.status='active'
      AND m.tenant_id=?2 AND m.status='active' LIMIT 1
  `).bind(userId, tenantId).first<{ role: string; module_permissions_json: string | null }>()
  if (!membership || !hasModuleAccess(membership.role, membership.module_permissions_json)) return { error: json({ code: 'FORBIDDEN' }, 403) }
  return { scope: { tenantId, moduleId } }
}

function registrationStatus(row: ClientPetRow): string {
  if (!text(row.document)) return 'sem_cpf'
  if (!text(row.address) || !text(row.neighborhood)) return 'sem_endereco'
  return [row.owner_name, row.phone, row.city, row.pet_name, row.species].every((value) => text(value)) ? 'completo' : 'pendente'
}

function clientPetPayload(row: ClientPetRow) {
  return {
    id: row.id,
    tutor_group_id: row.client_id,
    owner_name: row.owner_name,
    owner_cpf: row.document || '',
    phone: row.phone || '',
    email: row.email || '',
    tutor_birth_date: row.tutor_birth_date || '',
    owner_address: row.address || '',
    address_number: row.address_number || '',
    address_complement: row.address_complement || '',
    address_reference: row.address_reference || '',
    owner_neighborhood: row.neighborhood || '',
    owner_city: row.city || '',
    zip_code: row.postal_code || '',
    client_notes: row.client_notes || '',
    pet_name: row.pet_name,
    species: row.species,
    breed: row.breed || '',
    birth_date: row.pet_birth_date,
    weight_kg: row.weight_kg,
    color: row.color || '',
    notes: row.pet_notes || '',
    created_at: new Date(row.pet_created_at_ms).toISOString(),
    registration_status: registrationStatus(row),
  }
}

const CLIENT_PET_SELECT = `
  SELECT p.id,p.client_id,p.name AS pet_name,p.species,p.breed,p.birth_date AS pet_birth_date,
    p.weight_kg,p.color,p.notes AS pet_notes,p.created_at_ms AS pet_created_at_ms,
    c.name AS owner_name,c.document,c.phone,c.email,c.birth_date AS tutor_birth_date,c.address,
    c.address_number,c.address_complement,c.address_reference,c.neighborhood,c.city,c.postal_code,c.notes AS client_notes
  FROM pets p JOIN clients c ON c.tenant_id=p.tenant_id AND c.module_id=p.module_id AND c.id=p.client_id
`

async function listClients(request: Request, bindings: Bindings, petId?: string): Promise<Response> {
  const resolved = await resolveScope(request, bindings)
  if (resolved.error) return resolved.error
  const scope = resolved.scope!
  const url = new URL(request.url)
  const search = text(url.searchParams.get('search')).toLowerCase()
  const like = search ? `%${search}%` : null
  const requestedLimit = Number(url.searchParams.get('limit') || (petId ? 1 : 1000))
  const limit = Math.min(1000, Math.max(1, Number.isFinite(requestedLimit) ? requestedLimit : 1000))
  const result = await bindings.DB!.prepare(`${CLIENT_PET_SELECT}
    WHERE p.tenant_id=?1 AND p.module_id=?2 AND p.status='active' AND c.status='active'
      AND (?3 IS NULL OR p.id=?3)
      AND (?4 IS NULL OR lower(c.name) LIKE ?4 OR lower(COALESCE(c.phone,'')) LIKE ?4
        OR lower(COALESCE(c.email,'')) LIKE ?4 OR lower(p.name) LIKE ?4 OR lower(COALESCE(p.breed,'')) LIKE ?4)
    ORDER BY c.name,p.name,p.id LIMIT ?5
  `).bind(scope.tenantId, scope.moduleId, petId || null, like, limit).all<ClientPetRow>()
  const clients = (result.results || []).map(clientPetPayload)
  if (!petId) return json({ clients })
  if (!clients[0]) return json({ code: 'CLIENT_PET_NOT_FOUND' }, 404)
  const appointments = await bindings.DB!.prepare(`
    SELECT a.id,a.status,a.scheduled_at_ms,
      (SELECT service_code FROM appointment_services s WHERE s.tenant_id=a.tenant_id AND s.module_id=a.module_id AND s.appointment_id=a.id ORDER BY position LIMIT 1) AS service_type
    FROM appointments a WHERE a.tenant_id=?1 AND a.module_id=?2 AND a.pet_id=?3 ORDER BY a.scheduled_at_ms DESC LIMIT 100
  `).bind(scope.tenantId, scope.moduleId, petId).all<{ id: string; status: string; scheduled_at_ms: number; service_type: string | null }>()
  return json({ client: {
    ...clients[0],
    appointments: (appointments.results || []).map((item) => ({
      id: item.id,
      service_type: item.service_type,
      scheduled_at: new Date(item.scheduled_at_ms).toISOString(),
      status: ({ scheduled: 'agendado', confirmed: 'confirmado', in_progress: 'em_andamento', completed: 'concluido', cancelled: 'cancelado' } as Record<string, string>)[item.status] || item.status,
    })),
  } })
}

function species(value: unknown): string {
  const normalized = text(value).toLowerCase()
  return ['dog', 'cat', 'bird', 'rabbit', 'fish', 'other'].includes(normalized) ? normalized : 'other'
}

async function createClient(request: Request, bindings: Bindings): Promise<Response> {
  const resolved = await resolveScope(request, bindings)
  if (resolved.error) return resolved.error
  const scope = resolved.scope!
  let body: JsonRecord
  try { body = record(await request.json()) } catch { return json({ code: 'INVALID_JSON' }, 400) }
  const ownerName = text(body.owner_name)
  const petName = text(body.pet_name)
  if (!ownerName || !petName) return json({ code: 'CLIENT_PET_NAME_REQUIRED' }, 400)
  const now = Date.now()
  const requestedClientId = text(body.tutor_group_id)
  let clientId = requestedClientId
  if (clientId) {
    const existing = await bindings.DB!.prepare("SELECT id FROM clients WHERE tenant_id=?1 AND module_id=?2 AND id=?3 AND status='active' LIMIT 1")
      .bind(scope.tenantId, scope.moduleId, clientId).first<{ id: string }>()
    if (!existing) return json({ code: 'TUTOR_NOT_FOUND' }, 404)
  } else {
    clientId = crypto.randomUUID()
  }
  const petId = crypto.randomUUID()
  const statements: D1PreparedStatement[] = []
  if (!requestedClientId) statements.push(bindings.DB!.prepare(`
    INSERT INTO clients(tenant_id,module_id,id,name,document,phone,email,birth_date,address,address_number,address_complement,
      address_reference,neighborhood,city,postal_code,notes,status,created_at_ms,updated_at_ms)
    VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,'active',?17,?17)
  `).bind(scope.tenantId, scope.moduleId, clientId, ownerName, nullable(body.owner_cpf), nullable(body.phone), nullable(body.email),
    nullable(body.tutor_birth_date), nullable(body.owner_address), nullable(body.address_number), nullable(body.address_complement),
    nullable(body.address_reference), nullable(body.owner_neighborhood), nullable(body.owner_city), nullable(body.zip_code), nullable(body.client_notes), now))
  statements.push(bindings.DB!.prepare(`
    INSERT INTO pets(tenant_id,module_id,id,client_id,name,species,breed,birth_date,weight_kg,color,notes,status,created_at_ms,updated_at_ms)
    VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,'active',?12,?12)
  `).bind(scope.tenantId, scope.moduleId, petId, clientId, petName, species(body.species), nullable(body.breed), nullable(body.birth_date),
    body.weight_kg === '' || body.weight_kg === null || body.weight_kg === undefined ? null : Number(body.weight_kg), nullable(body.color), nullable(body.notes), now))
  await bindings.DB!.batch(statements)
  return listClients(new Request(new URL(`/api/petshop/clients/${petId}`, request.url), { headers: request.headers }), bindings, petId)
}

async function updateClient(request: Request, bindings: Bindings, petId: string): Promise<Response> {
  const resolved = await resolveScope(request, bindings)
  if (resolved.error) return resolved.error
  const scope = resolved.scope!
  let body: JsonRecord
  try { body = record(await request.json()) } catch { return json({ code: 'INVALID_JSON' }, 400) }
  const current = await bindings.DB!.prepare(`${CLIENT_PET_SELECT} WHERE p.tenant_id=?1 AND p.module_id=?2 AND p.id=?3 AND p.status='active' LIMIT 1`)
    .bind(scope.tenantId, scope.moduleId, petId).first<ClientPetRow>()
  if (!current) return json({ code: 'CLIENT_PET_NOT_FOUND' }, 404)
  const now = Date.now()
  await bindings.DB!.batch([
    bindings.DB!.prepare(`UPDATE clients SET name=?4,document=?5,phone=?6,email=?7,birth_date=?8,address=?9,address_number=?10,
      address_complement=?11,address_reference=?12,neighborhood=?13,city=?14,postal_code=?15,notes=?16,updated_at_ms=?17
      WHERE tenant_id=?1 AND module_id=?2 AND id=?3`).bind(scope.tenantId, scope.moduleId, current.client_id,
      text(body.owner_name) || current.owner_name, nullable(body.owner_cpf), nullable(body.phone), nullable(body.email), nullable(body.tutor_birth_date),
      nullable(body.owner_address), nullable(body.address_number), nullable(body.address_complement), nullable(body.address_reference),
      nullable(body.owner_neighborhood), nullable(body.owner_city), nullable(body.zip_code), nullable(body.client_notes), now),
    bindings.DB!.prepare(`UPDATE pets SET name=?4,species=?5,breed=?6,birth_date=?7,weight_kg=?8,color=?9,notes=?10,updated_at_ms=?11
      WHERE tenant_id=?1 AND module_id=?2 AND id=?3`).bind(scope.tenantId, scope.moduleId, petId,
      text(body.pet_name) || current.pet_name, species(body.species || current.species), nullable(body.breed), nullable(body.birth_date),
      body.weight_kg === '' || body.weight_kg === null || body.weight_kg === undefined ? null : Number(body.weight_kg), nullable(body.color), nullable(body.notes), now),
  ])
  return listClients(new Request(new URL(`/api/petshop/clients/${petId}`, request.url), { headers: request.headers }), bindings, petId)
}

async function removeClient(request: Request, bindings: Bindings, petId: string): Promise<Response> {
  const resolved = await resolveScope(request, bindings)
  if (resolved.error) return resolved.error
  const scope = resolved.scope!
  const current = await bindings.DB!.prepare("SELECT client_id FROM pets WHERE tenant_id=?1 AND module_id=?2 AND id=?3 AND status='active' LIMIT 1")
    .bind(scope.tenantId, scope.moduleId, petId).first<{ client_id: string }>()
  if (!current) return json({ code: 'CLIENT_PET_NOT_FOUND' }, 404)
  const now = Date.now()
  await bindings.DB!.prepare("UPDATE pets SET status='inactive',updated_at_ms=?4 WHERE tenant_id=?1 AND module_id=?2 AND id=?3")
    .bind(scope.tenantId, scope.moduleId, petId, now).run()
  const remaining = await bindings.DB!.prepare("SELECT COUNT(*) AS total FROM pets WHERE tenant_id=?1 AND module_id=?2 AND client_id=?3 AND status='active'")
    .bind(scope.tenantId, scope.moduleId, current.client_id).first<{ total: number }>()
  if (Number(remaining?.total || 0) === 0) {
    await bindings.DB!.prepare("UPDATE clients SET status='inactive',updated_at_ms=?4 WHERE tenant_id=?1 AND module_id=?2 AND id=?3")
      .bind(scope.tenantId, scope.moduleId, current.client_id, now).run()
  }
  return json({ deleted: true, id: petId })
}

export async function handlePetshopClientsApiRequest(request: Request, bindings: Bindings): Promise<Response | null> {
  const { pathname } = new URL(request.url)
  const collection = /^\/api\/petshop\/clients\/?$/.test(pathname)
  const match = /^\/api\/petshop\/clients\/([^/]+)\/?$/.exec(pathname)
  if (!collection && !match) return null
  const petId = match ? decodeURIComponent(match[1]) : undefined
  if (petId && !ID.test(petId)) return json({ code: 'INVALID_CLIENT_PET' }, 400)
  if (request.method === 'GET') return listClients(request, bindings, petId)
  if (request.method === 'POST' && collection) return createClient(request, bindings)
  if (request.method === 'PATCH' && petId) return updateClient(request, bindings, petId)
  if (request.method === 'DELETE' && petId) return removeClient(request, bindings, petId)
  return json({ code: 'METHOD_NOT_ALLOWED' }, 405, { allow: collection ? 'GET, POST' : 'GET, PATCH, DELETE' })
}
