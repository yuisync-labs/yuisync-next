const PROJECTION_NAME = 'phase7-clients-pets'
const PROJECTION_VERSION = 1
const SOURCE_SYSTEM = 'supabase'
const MAX_GROUP_STATEMENTS = 48

export type ClientsPetsWriterErrorCode =
  | 'DATABASE_NOT_CONFIGURED'
  | 'INVALID_SNAPSHOT'
  | 'CLIENT_GROUP_TOO_LARGE'
  | 'CLIENTS_PETS_WRITE_REJECTED'

export class ClientsPetsWriterError extends Error {
  readonly code: ClientsPetsWriterErrorCode

  constructor(code: ClientsPetsWriterErrorCode) {
    super('Clients/pets migration write could not be completed.')
    this.name = 'ClientsPetsWriterError'
    this.code = code
  }
}

type Status = 'active' | 'inactive'
type Species = 'dog' | 'cat' | 'bird' | 'rabbit' | 'fish' | 'other'

type ProjectedRecord<T> = Readonly<{ key: string; data: T }>

type ClientData = Readonly<{
  tenant_id: string
  module_id: string
  id: string
  name: string
  document: string | null
  phone: string | null
  email: string | null
  birth_date: string | null
  address: string | null
  address_number: string | null
  address_complement: string | null
  address_reference: string | null
  neighborhood: string | null
  city: string | null
  postal_code: string | null
  notes: string | null
  status: Status
}>

type PetData = Readonly<{
  tenant_id: string
  module_id: string
  id: string
  client_id: string
  name: string
  species: Species
  breed: string | null
  birth_date: string | null
  weight_kg: number | null
  color: string | null
  notes: string | null
  status: Status
}>

type NormalizedSnapshot = Readonly<{
  tenantId: string
  moduleId: string
  clients: readonly ClientData[]
  pets: readonly PetData[]
}>

function invalidSnapshot(): never {
  throw new ClientsPetsWriterError('INVALID_SNAPSHOT')
}

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalidSnapshot()
  return value as Record<string, unknown>
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): void {
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  if (actual.length !== expected.length) invalidSnapshot()
  if (actual.some((key, index) => key !== expected[index])) invalidSnapshot()
}

function requiredString(value: unknown, maxLength: number, allowEmpty = false): string {
  if (typeof value !== 'string' || value.length > maxLength) invalidSnapshot()
  const normalized = value.trim()
  if (!allowEmpty && !normalized) invalidSnapshot()
  return allowEmpty ? value : normalized
}

function nullableString(value: unknown, maxLength: number): string | null {
  if (value === null) return null
  if (typeof value !== 'string' || value.length > maxLength) invalidSnapshot()
  return value
}

function tenantId(value: unknown): string {
  const normalized = requiredString(value, 160)
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(normalized)) invalidSnapshot()
  return normalized
}

function moduleId(value: unknown): string {
  const normalized = requiredString(value, 64).toLowerCase()
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(normalized)) invalidSnapshot()
  return normalized
}

function status(value: unknown): Status {
  if (value !== 'active' && value !== 'inactive') invalidSnapshot()
  return value
}

function species(value: unknown): Species {
  if (!['dog', 'cat', 'bird', 'rabbit', 'fish', 'other'].includes(String(value))) {
    invalidSnapshot()
  }
  return value as Species
}

function nullableWeight(value: unknown): number | null {
  if (value === null) return null
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 500) {
    invalidSnapshot()
  }
  return value
}

function projectedRecord(value: unknown): { key: string; data: Record<string, unknown> } {
  const record = asObject(value)
  exactKeys(record, ['key', 'data'])
  return {
    key: requiredString(record.key, 512),
    data: asObject(record.data),
  }
}

function normalizeClient(value: unknown, scopeTenantId: string, scopeModuleId: string): ClientData {
  const record = projectedRecord(value)
  exactKeys(record.data, [
    'tenant_id', 'module_id', 'id', 'name', 'document', 'phone', 'email', 'birth_date',
    'address', 'address_number', 'address_complement', 'address_reference', 'neighborhood',
    'city', 'postal_code', 'notes', 'status',
  ])

  const normalized: ClientData = {
    tenant_id: tenantId(record.data.tenant_id),
    module_id: moduleId(record.data.module_id),
    id: requiredString(record.data.id, 160),
    name: requiredString(record.data.name, 250),
    document: nullableString(record.data.document, 32),
    phone: nullableString(record.data.phone, 32),
    email: nullableString(record.data.email, 320),
    birth_date: nullableString(record.data.birth_date, 10),
    address: nullableString(record.data.address, 300),
    address_number: nullableString(record.data.address_number, 40),
    address_complement: nullableString(record.data.address_complement, 250),
    address_reference: nullableString(record.data.address_reference, 500),
    neighborhood: nullableString(record.data.neighborhood, 150),
    city: nullableString(record.data.city, 150),
    postal_code: nullableString(record.data.postal_code, 16),
    notes: nullableString(record.data.notes, 4000),
    status: status(record.data.status),
  }

  if (normalized.tenant_id !== scopeTenantId || normalized.module_id !== scopeModuleId) invalidSnapshot()
  if (record.key !== `client:${scopeTenantId}:${scopeModuleId}:${normalized.id}`) invalidSnapshot()
  if (normalized.module_id !== record.data.module_id) invalidSnapshot()
  return normalized
}

function normalizePet(value: unknown, scopeTenantId: string, scopeModuleId: string): PetData {
  const record = projectedRecord(value)
  exactKeys(record.data, [
    'tenant_id', 'module_id', 'id', 'client_id', 'name', 'species', 'breed', 'birth_date',
    'weight_kg', 'color', 'notes', 'status',
  ])

  const normalized: PetData = {
    tenant_id: tenantId(record.data.tenant_id),
    module_id: moduleId(record.data.module_id),
    id: requiredString(record.data.id, 160),
    client_id: requiredString(record.data.client_id, 160),
    name: requiredString(record.data.name, 160, true),
    species: species(record.data.species),
    breed: nullableString(record.data.breed, 160),
    birth_date: nullableString(record.data.birth_date, 10),
    weight_kg: nullableWeight(record.data.weight_kg),
    color: nullableString(record.data.color, 120),
    notes: nullableString(record.data.notes, 4000),
    status: status(record.data.status),
  }

  if (normalized.tenant_id !== scopeTenantId || normalized.module_id !== scopeModuleId) invalidSnapshot()
  if (record.key !== `pet:${scopeTenantId}:${scopeModuleId}:${normalized.id}`) invalidSnapshot()
  if (normalized.module_id !== record.data.module_id) invalidSnapshot()
  return normalized
}

function normalizeSnapshot(snapshotValue: unknown): NormalizedSnapshot {
  const snapshot = asObject(snapshotValue)
  exactKeys(snapshot, ['projection', 'source', 'scope', 'collections'])

  const projection = asObject(snapshot.projection)
  exactKeys(projection, ['name', 'version'])
  if (projection.name !== PROJECTION_NAME || projection.version !== PROJECTION_VERSION) invalidSnapshot()

  const source = asObject(snapshot.source)
  exactKeys(source, ['system', 'snapshot_id'])
  if (source.system !== SOURCE_SYSTEM) invalidSnapshot()
  requiredString(source.snapshot_id, 200)

  const scope = asObject(snapshot.scope)
  exactKeys(scope, ['tenant_id', 'module_id'])
  const scopeTenantId = tenantId(scope.tenant_id)
  const scopeModuleId = moduleId(scope.module_id)
  if (scopeModuleId !== scope.module_id) invalidSnapshot()

  const collections = asObject(snapshot.collections)
  exactKeys(collections, ['clients', 'pets'])
  if (!Array.isArray(collections.clients) || !Array.isArray(collections.pets)) invalidSnapshot()

  const clients = collections.clients.map((row) => normalizeClient(row, scopeTenantId, scopeModuleId))
  const pets = collections.pets.map((row) => normalizePet(row, scopeTenantId, scopeModuleId))

  const clientIds = new Set<string>()
  for (const client of clients) {
    if (clientIds.has(client.id)) invalidSnapshot()
    clientIds.add(client.id)
  }

  const petIds = new Set<string>()
  for (const pet of pets) {
    if (petIds.has(pet.id) || !clientIds.has(pet.client_id)) invalidSnapshot()
    petIds.add(pet.id)
  }

  return {
    tenantId: scopeTenantId,
    moduleId: scopeModuleId,
    clients,
    pets,
  }
}

function normalizeNowMs(value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0) invalidSnapshot()
  return value
}

const CLIENT_CONFLICT_GUARD_SQL = `
INSERT INTO clients (
  tenant_id, module_id, id, name, status, created_at_ms, updated_at_ms
)
SELECT '', '', '', '', 'invalid', 0, 0
WHERE EXISTS (
  SELECT 1 FROM clients
  WHERE tenant_id = ?1 AND module_id = ?2 AND id = ?3
    AND NOT (
      name = ?4 AND document IS ?5 AND phone IS ?6 AND email IS ?7 AND birth_date IS ?8
      AND address IS ?9 AND address_number IS ?10 AND address_complement IS ?11
      AND address_reference IS ?12 AND neighborhood IS ?13 AND city IS ?14
      AND postal_code IS ?15 AND notes IS ?16 AND status = ?17
    )
)
`

const CLIENT_INSERT_SQL = `
INSERT INTO clients (
  tenant_id, module_id, id, name, document, phone, email, birth_date, address,
  address_number, address_complement, address_reference, neighborhood, city,
  postal_code, notes, status, created_at_ms, updated_at_ms
)
VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?18)
ON CONFLICT (tenant_id, module_id, id) DO NOTHING
`

const PET_CONFLICT_GUARD_SQL = `
INSERT INTO pets (
  tenant_id, module_id, id, client_id, name, species, status, created_at_ms, updated_at_ms
)
SELECT '', '', '', '', '', 'other', 'invalid', 0, 0
WHERE EXISTS (
  SELECT 1 FROM pets
  WHERE tenant_id = ?1 AND module_id = ?2 AND id = ?3
    AND NOT (
      client_id = ?4 AND name = ?5 AND species = ?6 AND breed IS ?7 AND birth_date IS ?8
      AND weight_kg IS ?9 AND color IS ?10 AND notes IS ?11 AND status = ?12
    )
)
`

const PET_INSERT_SQL = `
INSERT INTO pets (
  tenant_id, module_id, id, client_id, name, species, breed, birth_date,
  weight_kg, color, notes, status, created_at_ms, updated_at_ms
)
VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?13)
ON CONFLICT (tenant_id, module_id, id) DO NOTHING
`

function bindClient(statement: D1PreparedStatement, client: ClientData, nowMs?: number) {
  const values = [
    client.tenant_id, client.module_id, client.id, client.name, client.document, client.phone,
    client.email, client.birth_date, client.address, client.address_number,
    client.address_complement, client.address_reference, client.neighborhood, client.city,
    client.postal_code, client.notes, client.status,
  ]
  return nowMs == null ? statement.bind(...values) : statement.bind(...values, nowMs)
}

function bindPet(statement: D1PreparedStatement, pet: PetData, nowMs?: number) {
  const values = [
    pet.tenant_id, pet.module_id, pet.id, pet.client_id, pet.name, pet.species, pet.breed,
    pet.birth_date, pet.weight_kg, pet.color, pet.notes, pet.status,
  ]
  return nowMs == null ? statement.bind(...values) : statement.bind(...values, nowMs)
}

async function rejectUnexpectedDestinationRows(
  database: D1Database,
  snapshot: NormalizedSnapshot,
): Promise<void> {
  const [clientRows, petRows] = await Promise.all([
    database.prepare('SELECT id FROM clients WHERE tenant_id = ? AND module_id = ?')
      .bind(snapshot.tenantId, snapshot.moduleId)
      .all<{ id: string }>(),
    database.prepare('SELECT id FROM pets WHERE tenant_id = ? AND module_id = ?')
      .bind(snapshot.tenantId, snapshot.moduleId)
      .all<{ id: string }>(),
  ])

  const expectedClients = new Set(snapshot.clients.map((row) => row.id))
  const expectedPets = new Set(snapshot.pets.map((row) => row.id))
  if (clientRows.results.some((row) => !expectedClients.has(row.id))) {
    throw new ClientsPetsWriterError('CLIENTS_PETS_WRITE_REJECTED')
  }
  if (petRows.results.some((row) => !expectedPets.has(row.id))) {
    throw new ClientsPetsWriterError('CLIENTS_PETS_WRITE_REJECTED')
  }
}

export type ClientsPetsWriteResult = Readonly<{
  status: 'applied_or_already_present'
  tenantId: string
  moduleId: string
  clientCount: number
  petCount: number
  groupCount: number
}>

export async function writeClientsPetsSnapshot({
  database,
  snapshot: snapshotValue,
  nowMs = Date.now(),
}: {
  database?: D1Database
  snapshot: unknown
  nowMs?: number
}): Promise<ClientsPetsWriteResult> {
  if (!database) throw new ClientsPetsWriterError('DATABASE_NOT_CONFIGURED')
  const snapshot = normalizeSnapshot(snapshotValue)
  const timestamp = normalizeNowMs(nowMs)
  await rejectUnexpectedDestinationRows(database, snapshot)

  const petsByClient = new Map<string, PetData[]>()
  for (const pet of snapshot.pets) {
    const rows = petsByClient.get(pet.client_id) ?? []
    rows.push(pet)
    petsByClient.set(pet.client_id, rows)
  }

  const sortedClients = [...snapshot.clients].sort((a, b) => a.id.localeCompare(b.id, 'en'))
  for (const client of sortedClients) {
    const clientPets = [...(petsByClient.get(client.id) ?? [])]
      .sort((a, b) => a.id.localeCompare(b.id, 'en'))
    const statementCount = 2 + (clientPets.length * 2)
    if (statementCount > MAX_GROUP_STATEMENTS) {
      throw new ClientsPetsWriterError('CLIENT_GROUP_TOO_LARGE')
    }

    const statements: D1PreparedStatement[] = [
      bindClient(database.prepare(CLIENT_CONFLICT_GUARD_SQL), client),
      bindClient(database.prepare(CLIENT_INSERT_SQL), client, timestamp),
    ]
    for (const pet of clientPets) {
      statements.push(bindPet(database.prepare(PET_CONFLICT_GUARD_SQL), pet))
      statements.push(bindPet(database.prepare(PET_INSERT_SQL), pet, timestamp))
    }

    try {
      await database.batch(statements)
    } catch {
      throw new ClientsPetsWriterError('CLIENTS_PETS_WRITE_REJECTED')
    }
  }

  return {
    status: 'applied_or_already_present',
    tenantId: snapshot.tenantId,
    moduleId: snapshot.moduleId,
    clientCount: snapshot.clients.length,
    petCount: snapshot.pets.length,
    groupCount: snapshot.clients.length,
  }
}