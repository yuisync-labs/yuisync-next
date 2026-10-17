import { createHash } from 'node:crypto'
import { snapshotHash } from './finalSyncCore.mjs'

const text = value => String(value ?? '').trim()
const key = value => text(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ')
const species = value => ['dog', 'cat', 'bird', 'rabbit', 'fish', 'other'].includes(text(value).toLowerCase()) ? text(value).toLowerCase() : 'other'
const digits = value => text(value).replace(/\D/g, '')
const validIdentity = value => value.length >= 10 && !/^(.)\1+$/.test(value)
const sameIdentity = (client, owner) => {
  const document = digits(client.document), phone = digits(client.phone)
  return (validIdentity(document) && document === digits(owner.document))
    || (key(client.name).split(' ').length >= 2 && validIdentity(phone) && phone === digits(owner.phone))
}
const extraId = (scope, clientId, name) => {
  const h = createHash('sha256').update(`active-pet-recovery:v1:${scope.tenant_id}:${scope.module_id}:${clientId}:${key(name)}`).digest('hex')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`
}

// Input is a frozen, scoped read of legacy clients and pet details, not a new
// full-source extraction. Existing pets (including inactive ones) are preserved.
export function planActivePetsRecovery({ scope, nextClients, sourceRows, existingPets = [], existingOwners = [], now = Date.now() }) {
  if (!scope?.tenant_id || scope.module_id !== 'petshop') throw new Error('PET_RECOVERY_SCOPE_REQUIRED')
  const clients = new Map(nextClients.map(row => [row.id, row]))
  const rows = [], skipped = [], invalid = []
  for (const source of sourceRows) {
    const [clientId, createdAt, primaryName, sourceSpecies, sourceBreed, birthDate, weight, color, notes, legacyPets, tutorGroupId] = source
    const client = clients.get(clientId)
    if (!client) throw new Error('PET_RECOVERY_CLIENT_OUTSIDE_SNAPSHOT')
    if (text(tutorGroupId) && tutorGroupId !== clientId) {
      skipped.push({ client_id: clientId, reason: 'explicit_tutor_group_requires_review' }); continue
    }
    if (existingPets.some(pet => pet.client_id === clientId)) {
      skipped.push({ client_id: clientId, reason: 'existing_pets_preserved' }); continue
    }
    const pets = [], seen = new Set()
    const primary = text(primaryName)
    const entries = [...(Array.isArray(legacyPets) ? legacyPets.filter(pet => pet && typeof pet === 'object') : [])]
    if (primary && !entries.some(pet => key(pet.name) === key(primary))) entries.unshift({ name: primary })
    if (!primary && entries[0]?.name) entries[0] = { ...entries[0], primary: true }
    for (const pet of entries) {
      const name = primary && key(pet.name) === key(primary) ? primary : text(pet.name)
      if (!name || seen.has(key(name))) continue
      seen.add(key(name))
      const isPrimary = primary ? key(name) === key(primary) : pet.primary === true
      const duplicate = existingOwners.find(owner => key(owner.name) === key(client.name) && key(owner.pet_name) === key(name) && sameIdentity(client, owner))
      if (duplicate) {
        skipped.push({ client_id: clientId, name, existing_client_id: duplicate.id, existing_pet_id: duplicate.pet_id, reason: 'same_owner_and_pet_already_registered' }); continue
      }
      const breed = text(pet.breed || (isPrimary ? sourceBreed : '')) || null
      const dob = text(pet.birth_date || (isPrimary ? birthDate : '')) || null
      const rawWeight = pet.weight_kg ?? (isPrimary ? weight : null)
      const kg = rawWeight == null || rawWeight === '' ? null : Number(String(rawWeight).replace(',', '.'))
      const petColor = text(pet.color || (isPrimary ? color : '')) || null
      const petNotes = text(pet.notes || (isPrimary ? notes : '')) || null
      if (name.length > 160 || (breed?.length || 0) > 160 || (petColor?.length || 0) > 120 || (petNotes?.length || 0) > 4000
        || (dob && (!/^\d{4}-\d{2}-\d{2}$/.test(dob) || !Number.isFinite(Date.parse(dob))))
        || (kg !== null && (!Number.isFinite(kg) || kg < 0 || kg > 500))) {
        invalid.push({ client_id: clientId, name, reason: 'pet_fields_outside_canonical_limits' }); continue
      }
      const breedKey = key(breed)
      const inferredSpecies = /\b(gato|gata|gatos|gatas|cat|felino|felina)\b/.test(breedKey) ? 'cat'
        : /\b(cachorro|cachorra|cao|dog|canino|canina)\b/.test(breedKey) ? 'dog' : 'other'
      const created = Date.parse(createdAt)
      pets.push({
        tenant_id: scope.tenant_id, module_id: scope.module_id,
        id: isPrimary ? clientId : extraId(scope, clientId, name), client_id: clientId,
        name, species: species(pet.species || (isPrimary ? sourceSpecies : inferredSpecies)),
        breed, birth_date: dob, weight_kg: kg, color: petColor, notes: petNotes, status: 'active',
        created_at_ms: Number.isFinite(created) ? created : client.created_at_ms,
        updated_at_ms: now, expected_client_updated_at_ms: client.updated_at_ms,
      })
    }
    const ids = pets.map(pet => pet.id)
    rows.push(...pets.map(pet => ({ ...pet, planned_pet_ids: ids })))
  }
  return { rows, skipped, invalid, clients: [...new Set(rows.map(row => row.client_id))], hash: snapshotHash(rows) }
}

// A single bound JSON payload keeps writes within D1's variable limit. Guards
// protect newer tutor edits and pets added after the snapshot. Replays are safe.
export const ACTIVE_PET_RECOVERY_INSERT_SQL = `INSERT INTO pets(
  tenant_id,module_id,id,client_id,name,species,breed,birth_date,weight_kg,color,notes,status,created_at_ms,updated_at_ms)
SELECT ?1,?2,json_extract(r.value,'$.id'),c.id,json_extract(r.value,'$.name'),json_extract(r.value,'$.species'),
  json_extract(r.value,'$.breed'),json_extract(r.value,'$.birth_date'),json_extract(r.value,'$.weight_kg'),
  json_extract(r.value,'$.color'),json_extract(r.value,'$.notes'),'active',
  json_extract(r.value,'$.created_at_ms'),json_extract(r.value,'$.updated_at_ms')
FROM json_each(?3) r CROSS JOIN clients c INDEXED BY sqlite_autoindex_clients_1 ON c.tenant_id=?1 AND c.module_id=?2 AND c.id=CAST(json_extract(r.value,'$.client_id') AS TEXT)
WHERE c.status='active' AND c.updated_at_ms=json_extract(r.value,'$.expected_client_updated_at_ms')
  AND NOT EXISTS(SELECT 1 FROM pets p WHERE p.tenant_id=?1 AND p.module_id=?2 AND p.client_id=c.id
    AND (p.status<>'active' OR p.id NOT IN (SELECT value FROM json_each(json_extract(r.value,'$.planned_pet_ids')))))
ON CONFLICT(tenant_id,module_id,id) DO NOTHING`
