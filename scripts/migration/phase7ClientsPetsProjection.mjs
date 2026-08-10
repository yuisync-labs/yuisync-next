export const PHASE7_CLIENTS_PETS_PROJECTION = Object.freeze({
  name: 'phase7-clients-pets',
  version: 1,
})

export class ClientsPetsProjectionError extends Error {
  constructor(code, message = 'Clients/pets projection could not be built.') {
    super(message)
    this.name = 'ClientsPetsProjectionError'
    this.code = code
  }
}

function text(value) {
  return value == null ? '' : String(value).trim()
}

function nullableText(value) {
  const normalized = text(value)
  return normalized || null
}

function digits(value) {
  const normalized = text(value).replace(/\D/g, '')
  return normalized || null
}

function normalizeScope(scope = {}) {
  const tenantId = text(scope.tenant_id)
  const moduleId = text(scope.module_id).toLowerCase()
  if (!tenantId) throw new ClientsPetsProjectionError('TENANT_REQUIRED')
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(moduleId)) {
    throw new ClientsPetsProjectionError('MODULE_INVALID')
  }
  return { tenant_id: tenantId, module_id: moduleId }
}

function legacyStatus(value) {
  if (value === true) return 'active'
  if (value === false) return 'inactive'
  throw new ClientsPetsProjectionError('SOURCE_STATUS_INVALID')
}

function d1Status(value) {
  if (value === 'active' || value === 'inactive') return value
  throw new ClientsPetsProjectionError('DESTINATION_STATUS_INVALID')
}

function normalizeSpecies(value) {
  const species = text(value).toLowerCase()
  return ['dog', 'cat', 'bird', 'rabbit', 'fish', 'other'].includes(species)
    ? species
    : 'other'
}

function finiteWeight(value) {
  if (value == null || text(value) === '') return null
  const number = Number(value)
  if (!Number.isFinite(number) || number < 0 || number > 500) {
    throw new ClientsPetsProjectionError('PET_WEIGHT_INVALID')
  }
  return number
}

function sourceDetails(row) {
  if (row?.details == null) return {}
  if (typeof row.details !== 'object' || Array.isArray(row.details)) {
    throw new ClientsPetsProjectionError('SOURCE_DETAILS_INVALID')
  }
  return row.details
}

function requireSourceScope(row, scope) {
  if (text(row?.tenant_id) !== scope.tenant_id) {
    throw new ClientsPetsProjectionError('SOURCE_TENANT_SCOPE_MISMATCH')
  }
  if (text(row?.module_id).toLowerCase() !== scope.module_id) {
    throw new ClientsPetsProjectionError('SOURCE_MODULE_SCOPE_MISMATCH')
  }
}

function requireDestinationScope(row, scope) {
  if (text(row?.tenant_id) !== scope.tenant_id) {
    throw new ClientsPetsProjectionError('DESTINATION_TENANT_SCOPE_MISMATCH')
  }
  if (text(row?.module_id).toLowerCase() !== scope.module_id) {
    throw new ClientsPetsProjectionError('DESTINATION_MODULE_SCOPE_MISMATCH')
  }
}

function recordKey(kind, scope, id) {
  return `${kind}:${scope.tenant_id}:${scope.module_id}:${id}`
}

function sourceClientId(row, details) {
  const sourceId = text(row?.id)
  if (!sourceId) throw new ClientsPetsProjectionError('SOURCE_CLIENT_ID_MISSING')
  const explicitTutorGroup = text(details?.tutor_group_id)
  return explicitTutorGroup || sourceId
}

function sourceTutorData(row, details, scope, clientId) {
  const name = text(row?.name)
  if (!name) throw new ClientsPetsProjectionError('SOURCE_TUTOR_NAME_MISSING')

  return {
    tenant_id: scope.tenant_id,
    module_id: scope.module_id,
    id: clientId,
    name,
    document: digits(row?.document),
    phone: digits(row?.phone),
    email: nullableText(row?.email)?.toLowerCase() || null,
    birth_date: nullableText(details?.tutor_birth_date),
    address: nullableText(row?.address),
    address_number: nullableText(details?.address_number),
    address_complement: nullableText(details?.address_complement),
    address_reference: nullableText(details?.address_reference),
    neighborhood: nullableText(row?.neighborhood),
    city: nullableText(row?.city),
    postal_code: digits(details?.zip_code),
    notes: nullableText(row?.notes),
    status: legacyStatus(row?.active),
  }
}

function sourcePetData(row, details, scope, clientId) {
  const id = text(row?.id)
  if (!id) throw new ClientsPetsProjectionError('SOURCE_PET_ID_MISSING')
  const hasPetNotes = Object.prototype.hasOwnProperty.call(details, 'pet_notes')

  return {
    tenant_id: scope.tenant_id,
    module_id: scope.module_id,
    id,
    client_id: clientId,
    name: text(details?.pet_name),
    species: normalizeSpecies(details?.species),
    breed: nullableText(details?.breed),
    birth_date: nullableText(details?.birth_date),
    weight_kg: finiteWeight(details?.weight_kg),
    color: nullableText(details?.color),
    notes: hasPetNotes ? nullableText(details?.pet_notes) : nullableText(row?.notes),
    status: legacyStatus(row?.active),
  }
}

function destinationTutorData(row, scope) {
  const id = text(row?.id)
  const name = text(row?.name)
  if (!id) throw new ClientsPetsProjectionError('DESTINATION_CLIENT_ID_MISSING')
  if (!name) throw new ClientsPetsProjectionError('DESTINATION_TUTOR_NAME_MISSING')

  return {
    tenant_id: scope.tenant_id,
    module_id: scope.module_id,
    id,
    name,
    document: nullableText(row?.document),
    phone: nullableText(row?.phone),
    email: nullableText(row?.email)?.toLowerCase() || null,
    birth_date: nullableText(row?.birth_date),
    address: nullableText(row?.address),
    address_number: nullableText(row?.address_number),
    address_complement: nullableText(row?.address_complement),
    address_reference: nullableText(row?.address_reference),
    neighborhood: nullableText(row?.neighborhood),
    city: nullableText(row?.city),
    postal_code: nullableText(row?.postal_code),
    notes: nullableText(row?.notes),
    status: d1Status(row?.status),
  }
}

function destinationPetData(row, scope) {
  const id = text(row?.id)
  const clientId = text(row?.client_id)
  if (!id) throw new ClientsPetsProjectionError('DESTINATION_PET_ID_MISSING')
  if (!clientId) throw new ClientsPetsProjectionError('DESTINATION_PET_CLIENT_ID_MISSING')

  return {
    tenant_id: scope.tenant_id,
    module_id: scope.module_id,
    id,
    client_id: clientId,
    name: text(row?.name),
    species: normalizeSpecies(row?.species),
    breed: nullableText(row?.breed),
    birth_date: nullableText(row?.birth_date),
    weight_kg: finiteWeight(row?.weight_kg),
    color: nullableText(row?.color),
    notes: nullableText(row?.notes),
    status: d1Status(row?.status),
  }
}

function stableJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`
}

function uniqueSorted(records, duplicateCode) {
  const seen = new Set()
  for (const record of records) {
    if (seen.has(record.key)) throw new ClientsPetsProjectionError(duplicateCode)
    seen.add(record.key)
  }
  return records.sort((left, right) => left.key.localeCompare(right.key, 'en'))
}

export function projectSupabaseClientsPets({
  snapshotId,
  scope: rawScope,
  clients = [],
} = {}) {
  const scope = normalizeScope(rawScope)
  const sourceId = text(snapshotId)
  if (!sourceId) throw new ClientsPetsProjectionError('SNAPSHOT_ID_REQUIRED')
  if (!Array.isArray(clients)) throw new ClientsPetsProjectionError('SOURCE_CLIENTS_INVALID')

  const tutorById = new Map()
  const pets = []
  const sourceIds = new Set()

  for (const row of clients) {
    requireSourceScope(row, scope)
    const sourceIdValue = text(row?.id)
    if (!sourceIdValue) throw new ClientsPetsProjectionError('SOURCE_CLIENT_ID_MISSING')
    if (sourceIds.has(sourceIdValue)) {
      throw new ClientsPetsProjectionError('SOURCE_CLIENT_DUPLICATE')
    }
    sourceIds.add(sourceIdValue)

    const details = sourceDetails(row)
    const clientId = sourceClientId(row, details)
    const tutorData = sourceTutorData(row, details, scope, clientId)
    const existingTutor = tutorById.get(clientId)
    if (existingTutor && stableJson(existingTutor) !== stableJson(tutorData)) {
      throw new ClientsPetsProjectionError('SOURCE_TUTOR_GROUP_CONFLICT')
    }
    tutorById.set(clientId, tutorData)

    pets.push({
      key: recordKey('pet', scope, sourceIdValue),
      data: sourcePetData(row, details, scope, clientId),
    })
  }

  const tutorRecords = [...tutorById.values()].map((data) => ({
    key: recordKey('client', scope, data.id),
    data,
  }))

  return {
    projection: PHASE7_CLIENTS_PETS_PROJECTION,
    source: { system: 'supabase', snapshot_id: sourceId },
    scope,
    collections: {
      clients: uniqueSorted(tutorRecords, 'SOURCE_PROJECTED_CLIENT_DUPLICATE'),
      pets: uniqueSorted(pets, 'SOURCE_PROJECTED_PET_DUPLICATE'),
    },
  }
}

export function projectD1ClientsPets({
  snapshotId,
  scope: rawScope,
  clients = [],
  pets = [],
} = {}) {
  const scope = normalizeScope(rawScope)
  const sourceId = text(snapshotId)
  if (!sourceId) throw new ClientsPetsProjectionError('SNAPSHOT_ID_REQUIRED')
  if (!Array.isArray(clients) || !Array.isArray(pets)) {
    throw new ClientsPetsProjectionError('DESTINATION_COLLECTION_INVALID')
  }

  const clientIds = new Set()
  const clientRecords = clients.map((row) => {
    requireDestinationScope(row, scope)
    const data = destinationTutorData(row, scope)
    if (clientIds.has(data.id)) {
      throw new ClientsPetsProjectionError('DESTINATION_CLIENT_DUPLICATE')
    }
    clientIds.add(data.id)
    return { key: recordKey('client', scope, data.id), data }
  })

  const petRecords = pets.map((row) => {
    requireDestinationScope(row, scope)
    const data = destinationPetData(row, scope)
    if (!clientIds.has(data.client_id)) {
      throw new ClientsPetsProjectionError('DESTINATION_PET_CLIENT_NOT_FOUND')
    }
    return { key: recordKey('pet', scope, data.id), data }
  })

  return {
    projection: PHASE7_CLIENTS_PETS_PROJECTION,
    source: { system: 'd1', snapshot_id: sourceId },
    scope,
    collections: {
      clients: uniqueSorted(clientRecords, 'DESTINATION_PROJECTED_CLIENT_DUPLICATE'),
      pets: uniqueSorted(petRecords, 'DESTINATION_PROJECTED_PET_DUPLICATE'),
    },
  }
}