export const PHASE7_FOUNDATION_PROJECTION = Object.freeze({
  name: 'phase7-foundation',
  version: 1,
})

export class FoundationProjectionError extends Error {
  constructor(code, message = 'Foundation projection could not be built.') {
    super(message)
    this.name = 'FoundationProjectionError'
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

function normalizeScope(scope = {}) {
  const tenantId = text(scope.tenant_id)
  const moduleId = text(scope.module_id).toLowerCase()
  if (!tenantId) throw new FoundationProjectionError('TENANT_REQUIRED')
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(moduleId)) {
    throw new FoundationProjectionError('MODULE_INVALID')
  }
  return { tenant_id: tenantId, module_id: moduleId }
}

function activeStatus(value) {
  return value === false || value === 'inactive' ? 'inactive' : 'active'
}

function identityKey(provider, subject) {
  return `identity:${provider}:${subject}`
}

function membershipKey(tenantId, provider, subject) {
  return `membership:${tenantId}:${provider}:${subject}`
}

function settingsData(row, scope) {
  return {
    tenant_id: scope.tenant_id,
    module_id: scope.module_id,
    store_name: text(row?.store_name),
    store_phone: text(row?.store_phone),
    store_address: text(row?.store_address),
    store_neighborhood: text(row?.store_neighborhood),
    store_city: text(row?.store_city),
    bot_prompt: text(row?.bot_prompt),
  }
}

function oneOrNone(rows, code) {
  if (rows.length > 1) throw new FoundationProjectionError(code)
  return rows[0] || null
}

function sourceTenantRecord(tenant, scope) {
  if (!tenant || text(tenant.id) !== scope.tenant_id) {
    throw new FoundationProjectionError('SOURCE_TENANT_NOT_FOUND')
  }

  return {
    key: `tenant:${scope.tenant_id}`,
    data: {
      id: scope.tenant_id,
      slug: text(tenant.slug).toLowerCase(),
      name: text(tenant.name),
      status: activeStatus(tenant.active),
    },
  }
}

function destinationTenantRecord(tenant, scope) {
  if (!tenant || text(tenant.id) !== scope.tenant_id) {
    throw new FoundationProjectionError('DESTINATION_TENANT_NOT_FOUND')
  }

  return {
    key: `tenant:${scope.tenant_id}`,
    data: {
      id: scope.tenant_id,
      slug: text(tenant.slug).toLowerCase(),
      name: text(tenant.name),
      status: activeStatus(tenant.status),
    },
  }
}

function sourceIdentityRecord(profile) {
  const subject = text(profile?.id)
  if (!subject) throw new FoundationProjectionError('SOURCE_PROFILE_ID_MISSING')

  return {
    key: identityKey('supabase', subject),
    data: {
      provider: 'supabase',
      subject,
      display_name: nullableText(profile.full_name),
      email: nullableText(profile.email)?.toLowerCase() || null,
      status: activeStatus(profile.active),
    },
  }
}

function destinationIdentityRecord(principal) {
  const provider = text(principal?.provider).toLowerCase()
  const subject = text(principal?.subject)
  if (!provider || !subject) {
    throw new FoundationProjectionError('DESTINATION_IDENTITY_INVALID')
  }

  return {
    key: identityKey(provider, subject),
    data: {
      provider,
      subject,
      display_name: nullableText(principal.display_name),
      email: nullableText(principal.email)?.toLowerCase() || null,
      status: activeStatus(principal.status),
    },
  }
}

function sourceMembershipRecord(scope, profile, membership = null, derivedGlobalAdmin = false) {
  const subject = text(profile?.id)
  if (!subject) throw new FoundationProjectionError('SOURCE_PROFILE_ID_MISSING')

  const status = derivedGlobalAdmin
    ? activeStatus(profile.active)
    : (membership?.active === false ? 'inactive' : activeStatus(profile.active))

  return {
    key: membershipKey(scope.tenant_id, 'supabase', subject),
    data: {
      tenant_id: scope.tenant_id,
      provider: 'supabase',
      subject,
      status,
    },
  }
}

function destinationMembershipRecord(scope, principal, membership) {
  const provider = text(principal?.provider).toLowerCase()
  const subject = text(principal?.subject)
  if (!provider || !subject) {
    throw new FoundationProjectionError('DESTINATION_MEMBERSHIP_IDENTITY_MISSING')
  }

  return {
    key: membershipKey(scope.tenant_id, provider, subject),
    data: {
      tenant_id: scope.tenant_id,
      provider,
      subject,
      status: activeStatus(membership?.status),
    },
  }
}

function uniqueByKey(records, code) {
  const seen = new Set()
  for (const record of records) {
    if (seen.has(record.key)) throw new FoundationProjectionError(code)
    seen.add(record.key)
  }
  return records.sort((left, right) => left.key.localeCompare(right.key, 'en'))
}

export function projectSupabaseFoundation({
  snapshotId,
  scope: rawScope,
  tenant,
  profiles = [],
  profileTenants = [],
  settings = [],
} = {}) {
  const scope = normalizeScope(rawScope)
  const sourceId = text(snapshotId)
  if (!sourceId) throw new FoundationProjectionError('SNAPSHOT_ID_REQUIRED')

  const profilesById = new Map(
    profiles
      .filter((profile) => text(profile?.id))
      .map((profile) => [text(profile.id), profile]),
  )

  const scopedMemberships = profileTenants.filter(
    (membership) => text(membership?.tenant_id) === scope.tenant_id,
  )

  const membershipByProfileId = new Map()
  for (const membership of scopedMemberships) {
    const profileId = text(membership?.profile_id)
    if (!profileId) throw new FoundationProjectionError('SOURCE_MEMBERSHIP_PROFILE_ID_MISSING')
    if (membershipByProfileId.has(profileId)) {
      throw new FoundationProjectionError('SOURCE_MEMBERSHIP_DUPLICATE')
    }
    membershipByProfileId.set(profileId, membership)
  }

  const relevantProfileIds = new Set(membershipByProfileId.keys())
  for (const profile of profiles) {
    if (profile?.role === 'admin' && text(profile?.id)) {
      relevantProfileIds.add(text(profile.id))
    }
  }

  const identityRecords = []
  const membershipRecords = []
  for (const profileId of relevantProfileIds) {
    const profile = profilesById.get(profileId)
    if (!profile) throw new FoundationProjectionError('SOURCE_MEMBERSHIP_PROFILE_NOT_FOUND')

    identityRecords.push(sourceIdentityRecord(profile))
    const explicitMembership = membershipByProfileId.get(profileId)
    membershipRecords.push(sourceMembershipRecord(
      scope,
      profile,
      explicitMembership,
      profile.role === 'admin' && !explicitMembership,
    ))
  }

  const scopedSettings = settings.filter(
    (row) => text(row?.tenant_id) === scope.tenant_id
      && text(row?.module_id).toLowerCase() === scope.module_id,
  )
  const settingsRow = oneOrNone(scopedSettings, 'SOURCE_SETTINGS_DUPLICATE')

  return {
    projection: PHASE7_FOUNDATION_PROJECTION,
    source: {
      system: 'supabase',
      snapshot_id: sourceId,
    },
    scope,
    collections: {
      tenants: [sourceTenantRecord(tenant, scope)],
      identity_principals: uniqueByKey(identityRecords, 'SOURCE_IDENTITY_DUPLICATE'),
      tenant_memberships: uniqueByKey(membershipRecords, 'SOURCE_PROJECTED_MEMBERSHIP_DUPLICATE'),
      tenant_module_settings: settingsRow
        ? [{ key: `settings:${scope.tenant_id}:${scope.module_id}`, data: settingsData(settingsRow, scope) }]
        : [],
    },
  }
}

export function projectD1Foundation({
  snapshotId,
  scope: rawScope,
  tenant,
  identityPrincipals = [],
  tenantMemberships = [],
  settings = [],
} = {}) {
  const scope = normalizeScope(rawScope)
  const sourceId = text(snapshotId)
  if (!sourceId) throw new FoundationProjectionError('SNAPSHOT_ID_REQUIRED')

  const principalsById = new Map(
    identityPrincipals
      .filter((principal) => text(principal?.id))
      .map((principal) => [text(principal.id), principal]),
  )

  const scopedMemberships = tenantMemberships.filter(
    (membership) => text(membership?.tenant_id) === scope.tenant_id,
  )

  const identityRecords = []
  const membershipRecords = []
  const seenPrincipalIds = new Set()
  for (const membership of scopedMemberships) {
    const principalId = text(membership?.principal_id)
    if (!principalId) throw new FoundationProjectionError('DESTINATION_MEMBERSHIP_PRINCIPAL_ID_MISSING')
    const principal = principalsById.get(principalId)
    if (!principal) throw new FoundationProjectionError('DESTINATION_MEMBERSHIP_PRINCIPAL_NOT_FOUND')

    if (!seenPrincipalIds.has(principalId)) {
      identityRecords.push(destinationIdentityRecord(principal))
      seenPrincipalIds.add(principalId)
    }
    membershipRecords.push(destinationMembershipRecord(scope, principal, membership))
  }

  const scopedSettings = settings.filter(
    (row) => text(row?.tenant_id) === scope.tenant_id
      && text(row?.module_id).toLowerCase() === scope.module_id,
  )
  const settingsRow = oneOrNone(scopedSettings, 'DESTINATION_SETTINGS_DUPLICATE')

  return {
    projection: PHASE7_FOUNDATION_PROJECTION,
    source: {
      system: 'd1',
      snapshot_id: sourceId,
    },
    scope,
    collections: {
      tenants: [destinationTenantRecord(tenant, scope)],
      identity_principals: uniqueByKey(identityRecords, 'DESTINATION_IDENTITY_DUPLICATE'),
      tenant_memberships: uniqueByKey(membershipRecords, 'DESTINATION_PROJECTED_MEMBERSHIP_DUPLICATE'),
      tenant_module_settings: settingsRow
        ? [{ key: `settings:${scope.tenant_id}:${scope.module_id}`, data: settingsData(settingsRow, scope) }]
        : [],
    },
  }
}
