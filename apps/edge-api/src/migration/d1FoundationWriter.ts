const PROJECTION_NAME = 'phase7-foundation'
const PROJECTION_VERSION = 1
const SOURCE_SYSTEM = 'supabase'
const MAX_ATOMIC_BATCH_STATEMENTS = 48

export type FoundationWriterErrorCode =
  | 'DATABASE_NOT_CONFIGURED'
  | 'INVALID_SNAPSHOT'
  | 'SNAPSHOT_TOO_LARGE'
  | 'FOUNDATION_WRITE_REJECTED'

export class FoundationWriterError extends Error {
  readonly code: FoundationWriterErrorCode

  constructor(code: FoundationWriterErrorCode) {
    super('Foundation migration write could not be completed.')
    this.name = 'FoundationWriterError'
    this.code = code
  }
}

type Status = 'active' | 'inactive'

type ProjectedRecord<T> = Readonly<{
  key: string
  data: T
}>

type TenantData = Readonly<{
  id: string
  slug: string
  name: string
  status: Status
}>

type IdentityData = Readonly<{
  provider: string
  subject: string
  display_name: string | null
  email: string | null
  status: Status
}>

type MembershipData = Readonly<{
  tenant_id: string
  provider: string
  subject: string
  status: Status
}>

type SettingsData = Readonly<{
  tenant_id: string
  module_id: string
  store_name: string
  store_phone: string
  store_address: string
  store_neighborhood: string
  store_city: string
  bot_prompt: string
}>

export type FoundationProjectedSnapshot = Readonly<{
  projection: Readonly<{
    name: string
    version: number
  }>
  source: Readonly<{
    system: string
    snapshot_id: string
  }>
  scope: Readonly<{
    tenant_id: string
    module_id: string
  }>
  collections: Readonly<{
    tenants: readonly ProjectedRecord<TenantData>[]
    identity_principals: readonly ProjectedRecord<IdentityData>[]
    tenant_memberships: readonly ProjectedRecord<MembershipData>[]
    tenant_module_settings: readonly ProjectedRecord<SettingsData>[]
  }>
}>

export type FoundationWriteResult = Readonly<{
  status: 'applied_or_already_present'
  tenantId: string
  moduleId: string
  identityCount: number
  membershipCount: number
  settingsPresent: boolean
  statementCount: number
}>

type NormalizedSnapshot = Readonly<{
  tenant: TenantData
  identities: readonly IdentityData[]
  memberships: readonly MembershipData[]
  settings: SettingsData | null
  tenantId: string
  moduleId: string
}>

function invalidSnapshot(): never {
  throw new FoundationWriterError('INVALID_SNAPSHOT')
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

function requiredString(value: unknown, maxLength: number): string {
  if (typeof value !== 'string') invalidSnapshot()
  const normalized = value.trim()
  if (!normalized || normalized.length > maxLength) invalidSnapshot()
  return normalized
}

function boundedString(value: unknown, maxLength: number): string {
  if (typeof value !== 'string' || value.length > maxLength) invalidSnapshot()
  return value
}

function nullableString(value: unknown, maxLength: number): string | null {
  if (value === null) return null
  if (typeof value !== 'string' || value.length > maxLength) invalidSnapshot()
  return value
}

function status(value: unknown): Status {
  if (value !== 'active' && value !== 'inactive') invalidSnapshot()
  return value
}

function moduleId(value: unknown): string {
  const normalized = requiredString(value, 64).toLowerCase()
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(normalized)) invalidSnapshot()
  return normalized
}

function tenantId(value: unknown): string {
  const normalized = requiredString(value, 160)
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(normalized)) invalidSnapshot()
  return normalized
}

function provider(value: unknown): string {
  const normalized = requiredString(value, 32).toLowerCase()
  if (!/^[a-z0-9][a-z0-9_-]{0,31}$/.test(normalized)) invalidSnapshot()
  return normalized
}

function subject(value: unknown): string {
  return requiredString(value, 255)
}

function projectedRecord(value: unknown): { key: string; data: Record<string, unknown> } {
  const record = asObject(value)
  exactKeys(record, ['key', 'data'])
  return {
    key: requiredString(record.key, 512),
    data: asObject(record.data),
  }
}

function collection(value: unknown): readonly unknown[] {
  if (!Array.isArray(value)) invalidSnapshot()
  return value
}

function normalizeTenant(value: unknown, scopeTenantId: string): TenantData {
  const record = projectedRecord(value)
  exactKeys(record.data, ['id', 'slug', 'name', 'status'])

  const id = tenantId(record.data.id)
  const slug = requiredString(record.data.slug, 120).toLowerCase()
  const name = requiredString(record.data.name, 160)
  const normalized: TenantData = {
    id,
    slug,
    name,
    status: status(record.data.status),
  }

  if (id !== scopeTenantId || record.key !== `tenant:${id}`) invalidSnapshot()
  if (slug !== record.data.slug) invalidSnapshot()
  return normalized
}

function normalizeIdentity(value: unknown): IdentityData {
  const record = projectedRecord(value)
  exactKeys(record.data, ['provider', 'subject', 'display_name', 'email', 'status'])

  const normalizedProvider = provider(record.data.provider)
  const normalizedSubject = subject(record.data.subject)
  const displayName = nullableString(record.data.display_name, 240)
  const email = nullableString(record.data.email, 320)
  const normalized: IdentityData = {
    provider: normalizedProvider,
    subject: normalizedSubject,
    display_name: displayName,
    email,
    status: status(record.data.status),
  }

  if (record.key !== `identity:${normalizedProvider}:${normalizedSubject}`) invalidSnapshot()
  if (normalizedProvider !== record.data.provider) invalidSnapshot()
  if (email !== null && email !== email.toLowerCase()) invalidSnapshot()
  return normalized
}

function normalizeMembership(value: unknown, scopeTenantId: string): MembershipData {
  const record = projectedRecord(value)
  exactKeys(record.data, ['tenant_id', 'provider', 'subject', 'status'])

  const normalizedTenantId = tenantId(record.data.tenant_id)
  const normalizedProvider = provider(record.data.provider)
  const normalizedSubject = subject(record.data.subject)
  const normalized: MembershipData = {
    tenant_id: normalizedTenantId,
    provider: normalizedProvider,
    subject: normalizedSubject,
    status: status(record.data.status),
  }

  if (normalizedTenantId !== scopeTenantId) invalidSnapshot()
  if (record.key !== `membership:${normalizedTenantId}:${normalizedProvider}:${normalizedSubject}`) {
    invalidSnapshot()
  }
  if (normalizedProvider !== record.data.provider) invalidSnapshot()
  return normalized
}

function normalizeSettings(
  value: unknown,
  scopeTenantId: string,
  scopeModuleId: string,
): SettingsData {
  const record = projectedRecord(value)
  exactKeys(record.data, [
    'tenant_id',
    'module_id',
    'store_name',
    'store_phone',
    'store_address',
    'store_neighborhood',
    'store_city',
    'bot_prompt',
  ])

  const normalizedTenantId = tenantId(record.data.tenant_id)
  const normalizedModuleId = moduleId(record.data.module_id)
  const normalized: SettingsData = {
    tenant_id: normalizedTenantId,
    module_id: normalizedModuleId,
    store_name: boundedString(record.data.store_name, 160),
    store_phone: boundedString(record.data.store_phone, 80),
    store_address: boundedString(record.data.store_address, 240),
    store_neighborhood: boundedString(record.data.store_neighborhood, 120),
    store_city: boundedString(record.data.store_city, 120),
    bot_prompt: boundedString(record.data.bot_prompt, 12_000),
  }

  if (normalizedTenantId !== scopeTenantId || normalizedModuleId !== scopeModuleId) {
    invalidSnapshot()
  }
  if (record.key !== `settings:${normalizedTenantId}:${normalizedModuleId}`) invalidSnapshot()
  if (normalizedModuleId !== record.data.module_id) invalidSnapshot()
  return normalized
}

function logicalIdentityKey(value: Pick<IdentityData, 'provider' | 'subject'>): string {
  return `${value.provider}\u0000${value.subject}`
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
  exactKeys(collections, [
    'tenants',
    'identity_principals',
    'tenant_memberships',
    'tenant_module_settings',
  ])

  const tenantRows = collection(collections.tenants)
  const identityRows = collection(collections.identity_principals)
  const membershipRows = collection(collections.tenant_memberships)
  const settingsRows = collection(collections.tenant_module_settings)
  if (tenantRows.length !== 1 || settingsRows.length > 1) invalidSnapshot()

  const tenant = normalizeTenant(tenantRows[0], scopeTenantId)
  const identities = identityRows.map(normalizeIdentity)
  const memberships = membershipRows.map((row) => normalizeMembership(row, scopeTenantId))
  const settings = settingsRows.length
    ? normalizeSettings(settingsRows[0], scopeTenantId, scopeModuleId)
    : null

  const identitiesByKey = new Map<string, IdentityData>()
  for (const identity of identities) {
    const key = logicalIdentityKey(identity)
    if (identitiesByKey.has(key)) invalidSnapshot()
    identitiesByKey.set(key, identity)
  }

  const membershipKeys = new Set<string>()
  for (const membership of memberships) {
    const key = logicalIdentityKey(membership)
    if (!identitiesByKey.has(key) || membershipKeys.has(key)) invalidSnapshot()
    membershipKeys.add(key)
  }

  if (identitiesByKey.size !== membershipKeys.size) invalidSnapshot()

  return {
    tenant,
    identities,
    memberships,
    settings,
    tenantId: scopeTenantId,
    moduleId: scopeModuleId,
  }
}

function normalizeNowMs(value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0) invalidSnapshot()
  return value
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export async function deterministicFoundationPrincipalId(
  providerValue: string,
  subjectValue: string,
): Promise<string> {
  const normalizedProvider = provider(providerValue)
  const normalizedSubject = subject(subjectValue)
  const input = new TextEncoder().encode(`${normalizedProvider}\u0000${normalizedSubject}`)
  const digest = await crypto.subtle.digest('SHA-256', input)
  return `principal_${bytesToHex(new Uint8Array(digest))}`
}

const TENANT_CONFLICT_GUARD_SQL = `
INSERT INTO tenants (id, slug, name, status, created_at_ms, updated_at_ms)
SELECT '', '', '', 'invalid', 0, 0
WHERE EXISTS (
  SELECT 1
  FROM tenants
  WHERE (id = ?1 OR slug = ?2)
    AND NOT (id = ?1 AND slug = ?2 AND name = ?3 AND status = ?4)
)
`

const TENANT_INSERT_SQL = `
INSERT INTO tenants (id, slug, name, status, created_at_ms, updated_at_ms)
VALUES (?1, ?2, ?3, ?4, ?5, ?5)
ON CONFLICT DO NOTHING
`

const IDENTITY_CONFLICT_GUARD_SQL = `
INSERT INTO identity_principals (
  id, provider, subject, display_name, email, status, created_at_ms, updated_at_ms
)
SELECT '', '', '', NULL, NULL, 'invalid', 0, 0
WHERE EXISTS (
  SELECT 1
  FROM identity_principals
  WHERE (id = ?1 OR (provider = ?2 AND subject = ?3))
    AND NOT (
      provider = ?2
      AND subject = ?3
      AND display_name IS ?4
      AND email IS ?5
      AND status = ?6
    )
)
`

const IDENTITY_INSERT_SQL = `
INSERT INTO identity_principals (
  id, provider, subject, display_name, email, status, created_at_ms, updated_at_ms
)
VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)
ON CONFLICT DO NOTHING
`

const MEMBERSHIP_CONFLICT_GUARD_SQL = `
INSERT INTO tenant_memberships (
  tenant_id, principal_id, status, created_at_ms, updated_at_ms
)
SELECT '', '', 'invalid', 0, 0
WHERE EXISTS (
  SELECT 1
  FROM tenant_memberships AS membership
  INNER JOIN identity_principals AS principal
    ON principal.id = membership.principal_id
  WHERE membership.tenant_id = ?1
    AND principal.provider = ?2
    AND principal.subject = ?3
    AND membership.status <> ?4
)
`

const MEMBERSHIP_INSERT_SQL = `
INSERT INTO tenant_memberships (
  tenant_id, principal_id, status, created_at_ms, updated_at_ms
)
SELECT ?1, principal.id, ?4, ?5, ?5
FROM identity_principals AS principal
WHERE principal.provider = ?2 AND principal.subject = ?3
ON CONFLICT (tenant_id, principal_id) DO NOTHING
`

const SETTINGS_CONFLICT_GUARD_SQL = `
INSERT INTO tenant_module_settings (
  tenant_id, module_id, version, created_at_ms, updated_at_ms
)
SELECT '', '', 0, 0, 0
WHERE EXISTS (
  SELECT 1
  FROM tenant_module_settings
  WHERE tenant_id = ?1
    AND module_id = ?2
    AND NOT (
      store_name = ?3
      AND store_phone = ?4
      AND store_address = ?5
      AND store_neighborhood = ?6
      AND store_city = ?7
      AND bot_prompt = ?8
    )
)
`

const SETTINGS_ABSENCE_GUARD_SQL = `
INSERT INTO tenant_module_settings (
  tenant_id, module_id, version, created_at_ms, updated_at_ms
)
SELECT '', '', 0, 0, 0
WHERE EXISTS (
  SELECT 1
  FROM tenant_module_settings
  WHERE tenant_id = ?1 AND module_id = ?2
)
`

const SETTINGS_INSERT_SQL = `
INSERT INTO tenant_module_settings (
  tenant_id,
  module_id,
  store_name,
  store_phone,
  store_address,
  store_neighborhood,
  store_city,
  bot_prompt,
  version,
  created_at_ms,
  updated_at_ms
)
VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 1, ?9, ?9)
ON CONFLICT (tenant_id, module_id) DO NOTHING
`

function extraMembershipGuardSql(membershipCount: number): string {
  if (membershipCount === 0) {
    return `
INSERT INTO tenant_memberships (
  tenant_id, principal_id, status, created_at_ms, updated_at_ms
)
SELECT '', '', 'invalid', 0, 0
WHERE EXISTS (
  SELECT 1 FROM tenant_memberships WHERE tenant_id = ?1
)
`
  }

  const allowed = Array.from({ length: membershipCount }, (_, index) => {
    const providerParameter = 2 + index * 2
    const subjectParameter = providerParameter + 1
    return `(principal.provider = ?${providerParameter} AND principal.subject = ?${subjectParameter})`
  }).join(' OR ')

  return `
INSERT INTO tenant_memberships (
  tenant_id, principal_id, status, created_at_ms, updated_at_ms
)
SELECT '', '', 'invalid', 0, 0
WHERE EXISTS (
  SELECT 1
  FROM tenant_memberships AS membership
  INNER JOIN identity_principals AS principal
    ON principal.id = membership.principal_id
  WHERE membership.tenant_id = ?1
    AND NOT (${allowed})
)
`
}

function extraMembershipGuardBindings(
  tenantIdValue: string,
  memberships: readonly MembershipData[],
): (string | number | null)[] {
  return [
    tenantIdValue,
    ...memberships.flatMap((membership) => [membership.provider, membership.subject]),
  ]
}

export async function applyFoundationSnapshotToD1({
  database,
  snapshot,
  nowMs,
}: Readonly<{
  database?: D1Database
  snapshot: unknown
  nowMs: number
}>): Promise<FoundationWriteResult> {
  if (!database) throw new FoundationWriterError('DATABASE_NOT_CONFIGURED')

  const normalized = normalizeSnapshot(snapshot)
  const timestamp = normalizeNowMs(nowMs)
  const principalIds = new Map<string, string>()

  for (const identity of normalized.identities) {
    principalIds.set(
      logicalIdentityKey(identity),
      await deterministicFoundationPrincipalId(identity.provider, identity.subject),
    )
  }

  const statements: D1PreparedStatement[] = []

  statements.push(
    database.prepare(extraMembershipGuardSql(normalized.memberships.length)).bind(
      ...extraMembershipGuardBindings(normalized.tenantId, normalized.memberships),
    ),
  )

  statements.push(
    database.prepare(TENANT_CONFLICT_GUARD_SQL).bind(
      normalized.tenant.id,
      normalized.tenant.slug,
      normalized.tenant.name,
      normalized.tenant.status,
    ),
    database.prepare(TENANT_INSERT_SQL).bind(
      normalized.tenant.id,
      normalized.tenant.slug,
      normalized.tenant.name,
      normalized.tenant.status,
      timestamp,
    ),
  )

  for (const identity of normalized.identities) {
    const principalId = principalIds.get(logicalIdentityKey(identity))
    if (!principalId) invalidSnapshot()

    statements.push(
      database.prepare(IDENTITY_CONFLICT_GUARD_SQL).bind(
        principalId,
        identity.provider,
        identity.subject,
        identity.display_name,
        identity.email,
        identity.status,
      ),
      database.prepare(IDENTITY_INSERT_SQL).bind(
        principalId,
        identity.provider,
        identity.subject,
        identity.display_name,
        identity.email,
        identity.status,
        timestamp,
      ),
    )
  }

  for (const membership of normalized.memberships) {
    statements.push(
      database.prepare(MEMBERSHIP_CONFLICT_GUARD_SQL).bind(
        normalized.tenantId,
        membership.provider,
        membership.subject,
        membership.status,
      ),
      database.prepare(MEMBERSHIP_INSERT_SQL).bind(
        normalized.tenantId,
        membership.provider,
        membership.subject,
        membership.status,
        timestamp,
      ),
    )
  }

  if (normalized.settings) {
    statements.push(
      database.prepare(SETTINGS_CONFLICT_GUARD_SQL).bind(
        normalized.settings.tenant_id,
        normalized.settings.module_id,
        normalized.settings.store_name,
        normalized.settings.store_phone,
        normalized.settings.store_address,
        normalized.settings.store_neighborhood,
        normalized.settings.store_city,
        normalized.settings.bot_prompt,
      ),
      database.prepare(SETTINGS_INSERT_SQL).bind(
        normalized.settings.tenant_id,
        normalized.settings.module_id,
        normalized.settings.store_name,
        normalized.settings.store_phone,
        normalized.settings.store_address,
        normalized.settings.store_neighborhood,
        normalized.settings.store_city,
        normalized.settings.bot_prompt,
        timestamp,
      ),
    )
  } else {
    statements.push(
      database.prepare(SETTINGS_ABSENCE_GUARD_SQL).bind(
        normalized.tenantId,
        normalized.moduleId,
      ),
    )
  }

  if (statements.length > MAX_ATOMIC_BATCH_STATEMENTS) {
    throw new FoundationWriterError('SNAPSHOT_TOO_LARGE')
  }

  try {
    await database.batch(statements)
  } catch {
    throw new FoundationWriterError('FOUNDATION_WRITE_REJECTED')
  }

  return {
    status: 'applied_or_already_present',
    tenantId: normalized.tenantId,
    moduleId: normalized.moduleId,
    identityCount: normalized.identities.length,
    membershipCount: normalized.memberships.length,
    settingsPresent: normalized.settings !== null,
    statementCount: statements.length,
  }
}
