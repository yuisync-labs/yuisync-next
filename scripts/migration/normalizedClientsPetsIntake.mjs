export class NormalizedClientsPetsIntakeError extends Error {
  constructor(code, message = 'Normalized clients/pets intake failed.') {
    super(message)
    this.name = 'NormalizedClientsPetsIntakeError'
    this.code = code
  }
}

function text(value) { return value == null ? '' : String(value).trim() }
function nullable(value) { const out = text(value); return out || null }
function digits(value) { const out = text(value).replace(/\D/gu, ''); return out || null }
function lower(value) { return text(value).toLowerCase() }
function epoch(value, fallback) { const n = Date.parse(value); return Number.isFinite(n) ? n : fallback }
function details(row) { return row?.details && typeof row.details === 'object' && !Array.isArray(row.details) ? row.details : {} }
function active(value) { if (value === true) return 'active'; if (value === false) return 'inactive'; return 'active' }
function species(value) { const v = lower(value); return ['dog','cat','bird','rabbit','fish','other'].includes(v) ? v : 'other' }
function weight(value) { if (value == null || text(value) === '') return null; const n = Number(value); if (!Number.isFinite(n) || n < 0 || n > 500) throw new NormalizedClientsPetsIntakeError('PET_WEIGHT_INVALID'); return n }
function key(owner, phone) { return `${lower(owner)}\u001f${digits(phone) || ''}` }

function canonicalClient(row, scope, now) {
  const extra = details(row)
  const id = text(row.id)
  const name = text(row.name)
  if (!id || !name) throw new NormalizedClientsPetsIntakeError('CLIENT_ID_OR_NAME_MISSING')
  if (text(row.tenant_id) !== scope.tenant_id) throw new NormalizedClientsPetsIntakeError('CLIENT_TENANT_MISMATCH')
  return {
    tenant_id: scope.tenant_id,
    module_id: lower(row.module_id || scope.module_id),
    id,
    name,
    document: digits(row.document),
    phone: digits(row.phone),
    email: lower(row.email) || null,
    birth_date: nullable(extra.tutor_birth_date),
    address: nullable(row.address),
    address_number: nullable(extra.address_number),
    address_complement: nullable(extra.address_complement),
    address_reference: nullable(extra.address_reference),
    neighborhood: nullable(row.neighborhood),
    city: nullable(row.city),
    postal_code: digits(extra.zip_code),
    notes: nullable(row.notes),
    status: active(row.active),
    created_at_ms: epoch(row.created_at, now),
    updated_at_ms: epoch(row.updated_at || row.created_at, now),
  }
}

function syntheticClient(pet, scope, now) {
  const id = text(pet.id)
  const name = text(pet.owner_name)
  if (!id || !name) throw new NormalizedClientsPetsIntakeError('SYNTHETIC_CLIENT_INPUT_MISSING')
  return {
    tenant_id: scope.tenant_id,
    module_id: lower(pet.module_id || scope.module_id),
    id,
    name,
    document: digits(pet.owner_cpf),
    phone: digits(pet.phone),
    email: lower(pet.email) || null,
    birth_date: null,
    address: nullable(pet.owner_address),
    address_number: null,
    address_complement: null,
    address_reference: null,
    neighborhood: nullable(pet.owner_neighborhood),
    city: nullable(pet.owner_city),
    postal_code: null,
    notes: null,
    status: 'active',
    created_at_ms: epoch(pet.created_at, now),
    updated_at_ms: epoch(pet.updated_at || pet.created_at, now),
  }
}

export function projectNormalizedSupabaseClientsPets({ clients = [], pets = [], scope, now = Date.now() } = {}) {
  const normalizedScope = { tenant_id: text(scope?.tenant_id), module_id: lower(scope?.module_id) }
  if (!normalizedScope.tenant_id || !normalizedScope.module_id) throw new NormalizedClientsPetsIntakeError('SCOPE_REQUIRED')
  if (!Array.isArray(clients) || !Array.isArray(pets)) throw new NormalizedClientsPetsIntakeError('INPUT_INVALID')

  const canonicalClients = clients.map((row) => canonicalClient(row, normalizedScope, now))
  const byId = new Map()
  const ownerIndex = new Map()
  for (const client of canonicalClients) {
    if (byId.has(client.id)) throw new NormalizedClientsPetsIntakeError('CLIENT_DUPLICATE')
    byId.set(client.id, client)
    const ownerKey = key(client.name, client.phone)
    if (!ownerIndex.has(ownerKey)) ownerIndex.set(ownerKey, [])
    ownerIndex.get(ownerKey).push(client.id)
  }

  const canonicalPets = []
  const syntheticIds = []
  const fallbackMatchedIds = []
  const seenPets = new Set()

  for (const pet of pets) {
    if (text(pet.tenant_id) !== normalizedScope.tenant_id) throw new NormalizedClientsPetsIntakeError('PET_TENANT_MISMATCH')
    const id = text(pet.id)
    if (!id || seenPets.has(id)) throw new NormalizedClientsPetsIntakeError(seenPets.has(id) ? 'PET_DUPLICATE' : 'PET_ID_MISSING')
    seenPets.add(id)

    let clientId = byId.has(id) ? id : null
    if (!clientId) {
      const matches = ownerIndex.get(key(pet.owner_name, pet.phone)) || []
      if (matches.length > 1) throw new NormalizedClientsPetsIntakeError('PET_OWNER_MATCH_AMBIGUOUS')
      if (matches.length === 1) {
        clientId = matches[0]
        fallbackMatchedIds.push(id)
      } else {
        const synthetic = syntheticClient(pet, normalizedScope, now)
        if (byId.has(synthetic.id)) throw new NormalizedClientsPetsIntakeError('SYNTHETIC_CLIENT_COLLISION')
        canonicalClients.push(synthetic)
        byId.set(synthetic.id, synthetic)
        clientId = synthetic.id
        syntheticIds.push(id)
      }
    }

    canonicalPets.push({
      tenant_id: normalizedScope.tenant_id,
      module_id: lower(pet.module_id || normalizedScope.module_id),
      id,
      client_id: clientId,
      name: text(pet.pet_name),
      species: species(pet.species),
      breed: nullable(pet.breed),
      birth_date: nullable(pet.birth_date),
      weight_kg: weight(pet.weight_kg),
      color: nullable(pet.color),
      notes: nullable(pet.notes),
      status: 'active',
      created_at_ms: epoch(pet.created_at, now),
      updated_at_ms: epoch(pet.updated_at || pet.created_at, now),
    })
  }

  canonicalClients.sort((a, b) => a.id.localeCompare(b.id, 'en'))
  canonicalPets.sort((a, b) => a.id.localeCompare(b.id, 'en'))
  return {
    clients: canonicalClients,
    pets: canonicalPets,
    diagnostics: {
      source_clients: clients.length,
      source_pets: pets.length,
      destination_clients: canonicalClients.length,
      destination_pets: canonicalPets.length,
      fallback_owner_matches: fallbackMatchedIds.sort(),
      synthetic_clients: syntheticIds.sort(),
    },
  }
}
