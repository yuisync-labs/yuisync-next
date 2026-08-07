import { createHash } from 'node:crypto'

export const MIGRATION_MANIFEST_VERSION = 1

const SECRET_FIELD_PATTERN = /(?:^|_)(?:password|passwd|secret|service_role|service_role_key|access_token|refresh_token|authorization|api_key|apikey|private_key)(?:$|_)/i
const COLLECTION_NAME_PATTERN = /^[a-z][a-z0-9_]{0,63}$/
const SCOPE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/
const MODULE_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/
const PROJECTION_NAME_PATTERN = /^[a-z][a-z0-9._-]{0,63}$/
const SHA256_PATTERN = /^[a-f0-9]{64}$/

export class MigrationManifestError extends Error {
  constructor(code, message = 'Migration manifest validation failed.') {
    super(message)
    this.name = 'MigrationManifestError'
    this.code = code
  }
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function assertJsonValue(value, path = '$') {
  if (value === undefined) {
    throw new MigrationManifestError('UNDEFINED_VALUE', `Undefined value at ${path}.`)
  }
  if (typeof value === 'number' && !Number.isFinite(value)) {
    throw new MigrationManifestError('NON_FINITE_NUMBER', `Non-finite number at ${path}.`)
  }
  if (typeof value === 'bigint' || typeof value === 'function' || typeof value === 'symbol') {
    throw new MigrationManifestError('NON_JSON_VALUE', `Non-JSON value at ${path}.`)
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertJsonValue(item, `${path}[${index}]`))
    return
  }
  if (value && typeof value === 'object') {
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) {
      throw new MigrationManifestError('NON_JSON_OBJECT', `Non-plain object at ${path}.`)
    }
    for (const [key, nested] of Object.entries(value)) {
      if (SECRET_FIELD_PATTERN.test(key)) {
        throw new MigrationManifestError('SECRET_FIELD', `Secret-like field is not allowed at ${path}.${key}.`)
      }
      assertJsonValue(nested, `${path}.${key}`)
    }
  }
}

export function canonicalJson(value) {
  assertJsonValue(value)

  const normalize = (input) => {
    if (Array.isArray(input)) return input.map(normalize)
    if (input && typeof input === 'object') {
      return Object.fromEntries(
        Object.keys(input)
          .sort()
          .map((key) => [key, normalize(input[key])]),
      )
    }
    return input
  }

  return JSON.stringify(normalize(value))
}

function normalizeScope(scope = {}) {
  const tenantId = String(scope.tenant_id || '').trim()
  const moduleId = String(scope.module_id || '').trim().toLowerCase()

  if (!SCOPE_ID_PATTERN.test(tenantId)) {
    throw new MigrationManifestError('INVALID_TENANT_ID', 'tenant_id is invalid.')
  }
  if (!MODULE_ID_PATTERN.test(moduleId)) {
    throw new MigrationManifestError('INVALID_MODULE_ID', 'module_id is invalid.')
  }

  return {
    tenant_id: tenantId,
    module_id: moduleId,
  }
}

function normalizeProjection(projection = {}) {
  const name = String(projection.name || '').trim().toLowerCase()
  const version = Number(projection.version)

  if (!PROJECTION_NAME_PATTERN.test(name)) {
    throw new MigrationManifestError('INVALID_PROJECTION_NAME', 'projection.name is invalid.')
  }
  if (!Number.isSafeInteger(version) || version < 1) {
    throw new MigrationManifestError('INVALID_PROJECTION_VERSION', 'projection.version is invalid.')
  }

  return { name, version }
}

function normalizeSource(source = {}) {
  const system = String(source.system || '').trim().toLowerCase()
  const snapshotId = String(source.snapshot_id || '').trim()

  if (!/^[a-z][a-z0-9_-]{0,31}$/.test(system)) {
    throw new MigrationManifestError('INVALID_SOURCE_SYSTEM', 'source.system is invalid.')
  }
  if (!snapshotId || snapshotId.length > 200) {
    throw new MigrationManifestError('INVALID_SNAPSHOT_ID', 'source.snapshot_id is invalid.')
  }

  return {
    system,
    snapshot_id: snapshotId,
  }
}

function normalizeRecord(record, collectionName, index) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    throw new MigrationManifestError('INVALID_RECORD', `${collectionName}[${index}] must be an object.`)
  }

  const key = String(record.key || '').trim()
  if (!key || key.length > 512) {
    throw new MigrationManifestError('INVALID_RECORD_KEY', `${collectionName}[${index}].key is invalid.`)
  }

  assertJsonValue(record.data, `${collectionName}[${index}].data`)

  return {
    key_hash: sha256(key),
    checksum: sha256(canonicalJson(record.data)),
  }
}

function buildCollection(name, records) {
  if (!COLLECTION_NAME_PATTERN.test(name)) {
    throw new MigrationManifestError('INVALID_COLLECTION_NAME', `Invalid collection name: ${name}`)
  }
  if (!Array.isArray(records)) {
    throw new MigrationManifestError('INVALID_COLLECTION', `${name} must be an array.`)
  }

  const normalized = records.map((record, index) => normalizeRecord(record, name, index))
  normalized.sort((left, right) => left.key_hash.localeCompare(right.key_hash, 'en'))

  for (let index = 1; index < normalized.length; index += 1) {
    if (normalized[index - 1].key_hash === normalized[index].key_hash) {
      throw new MigrationManifestError('DUPLICATE_RECORD_KEY', `Duplicate logical key in ${name}.`)
    }
  }

  return {
    name,
    row_count: normalized.length,
    checksum: sha256(canonicalJson(normalized)),
    records: normalized,
  }
}

function manifestContent(manifest) {
  return {
    schema_version: manifest.schema_version,
    projection: manifest.projection,
    source: manifest.source,
    scope: manifest.scope,
    collections: manifest.collections,
  }
}

export function buildMigrationManifest(snapshot) {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
    throw new MigrationManifestError('INVALID_SNAPSHOT', 'Snapshot must be an object.')
  }

  const projection = normalizeProjection(snapshot.projection)
  const source = normalizeSource(snapshot.source)
  const scope = normalizeScope(snapshot.scope)
  const collectionsInput = snapshot.collections
  if (!collectionsInput || typeof collectionsInput !== 'object' || Array.isArray(collectionsInput)) {
    throw new MigrationManifestError('INVALID_COLLECTIONS', 'collections must be an object.')
  }

  const collections = Object.entries(collectionsInput)
    .map(([name, records]) => buildCollection(name, records))
    .sort((left, right) => left.name.localeCompare(right.name, 'en'))

  const base = {
    schema_version: MIGRATION_MANIFEST_VERSION,
    projection,
    source,
    scope,
    collections,
  }

  return {
    ...base,
    checksum: sha256(canonicalJson(base)),
  }
}

function assertManifestCollection(collection, label, index) {
  if (!collection || typeof collection !== 'object' || Array.isArray(collection)) {
    throw new MigrationManifestError('INVALID_MANIFEST_COLLECTION', `${label} collection ${index} is invalid.`)
  }
  if (!COLLECTION_NAME_PATTERN.test(String(collection.name || ''))) {
    throw new MigrationManifestError('INVALID_MANIFEST_COLLECTION', `${label} collection name is invalid.`)
  }
  if (!Number.isSafeInteger(collection.row_count) || collection.row_count < 0) {
    throw new MigrationManifestError('INVALID_MANIFEST_COLLECTION', `${label} row_count is invalid.`)
  }
  if (!Array.isArray(collection.records) || collection.records.length !== collection.row_count) {
    throw new MigrationManifestError('INVALID_MANIFEST_COLLECTION', `${label} records do not match row_count.`)
  }

  const seen = new Set()
  for (const record of collection.records) {
    if (!record || !SHA256_PATTERN.test(String(record.key_hash || '')) || !SHA256_PATTERN.test(String(record.checksum || ''))) {
      throw new MigrationManifestError('INVALID_MANIFEST_RECORD', `${label} manifest record is invalid.`)
    }
    if (seen.has(record.key_hash)) {
      throw new MigrationManifestError('DUPLICATE_MANIFEST_RECORD', `${label} manifest contains duplicate key hashes.`)
    }
    seen.add(record.key_hash)
  }

  const expectedCollectionChecksum = sha256(canonicalJson(collection.records))
  if (collection.checksum !== expectedCollectionChecksum) {
    throw new MigrationManifestError('COLLECTION_CHECKSUM_MISMATCH', `${label} collection checksum is invalid.`)
  }
}

function assertManifestShape(manifest, label) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw new MigrationManifestError('INVALID_MANIFEST', `${label} manifest is invalid.`)
  }
  if (manifest.schema_version !== MIGRATION_MANIFEST_VERSION) {
    throw new MigrationManifestError('UNSUPPORTED_MANIFEST_VERSION', `${label} manifest version is unsupported.`)
  }

  const expectedChecksum = sha256(canonicalJson(manifestContent(manifest)))
  if (manifest.checksum !== expectedChecksum) {
    throw new MigrationManifestError('MANIFEST_CHECKSUM_MISMATCH', `${label} manifest checksum is invalid.`)
  }

  normalizeProjection(manifest.projection)
  normalizeSource(manifest.source)
  normalizeScope(manifest.scope)
  if (!Array.isArray(manifest.collections)) {
    throw new MigrationManifestError('INVALID_MANIFEST_COLLECTIONS', `${label} manifest collections are invalid.`)
  }

  const names = new Set()
  manifest.collections.forEach((collection, index) => {
    assertManifestCollection(collection, label, index)
    if (names.has(collection.name)) {
      throw new MigrationManifestError('DUPLICATE_MANIFEST_COLLECTION', `${label} manifest contains duplicate collections.`)
    }
    names.add(collection.name)
  })
}

function recordsByHash(collection) {
  return new Map((collection?.records || []).map((record) => [record.key_hash, record.checksum]))
}

export function reconcileMigrationManifests(sourceManifest, destinationManifest) {
  assertManifestShape(sourceManifest, 'source')
  assertManifestShape(destinationManifest, 'destination')

  const sourceScope = normalizeScope(sourceManifest.scope)
  const destinationScope = normalizeScope(destinationManifest.scope)
  if (canonicalJson(sourceScope) !== canonicalJson(destinationScope)) {
    throw new MigrationManifestError('SCOPE_MISMATCH', 'Source and destination scopes differ.')
  }

  const sourceProjection = normalizeProjection(sourceManifest.projection)
  const destinationProjection = normalizeProjection(destinationManifest.projection)
  if (canonicalJson(sourceProjection) !== canonicalJson(destinationProjection)) {
    throw new MigrationManifestError('PROJECTION_MISMATCH', 'Source and destination projections differ.')
  }

  const sourceCollections = new Map(sourceManifest.collections.map((collection) => [collection.name, collection]))
  const destinationCollections = new Map(destinationManifest.collections.map((collection) => [collection.name, collection]))
  const collectionNames = [...new Set([
    ...sourceCollections.keys(),
    ...destinationCollections.keys(),
  ])].sort()

  const collections = collectionNames.map((name) => {
    const source = sourceCollections.get(name)
    const destination = destinationCollections.get(name)
    const sourceRecords = recordsByHash(source)
    const destinationRecords = recordsByHash(destination)
    const missing = []
    const extra = []
    const mismatched = []

    for (const [keyHash, checksum] of sourceRecords) {
      if (!destinationRecords.has(keyHash)) {
        missing.push(keyHash)
      } else if (destinationRecords.get(keyHash) !== checksum) {
        mismatched.push(keyHash)
      }
    }

    for (const keyHash of destinationRecords.keys()) {
      if (!sourceRecords.has(keyHash)) extra.push(keyHash)
    }

    missing.sort()
    extra.sort()
    mismatched.sort()

    return {
      name,
      source_row_count: source?.row_count ?? 0,
      destination_row_count: destination?.row_count ?? 0,
      missing,
      extra,
      mismatched,
      in_sync: missing.length === 0 && extra.length === 0 && mismatched.length === 0,
    }
  })

  return {
    schema_version: MIGRATION_MANIFEST_VERSION,
    projection: sourceProjection,
    scope: sourceScope,
    source_manifest_checksum: sourceManifest.checksum,
    destination_manifest_checksum: destinationManifest.checksum,
    in_sync: collections.every((collection) => collection.in_sync),
    collections,
  }
}
