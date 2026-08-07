import type {
  TenantAccessDecision,
  TenantAccessRequest,
  TenantAuthorizationPort,
} from '../../../../server/application/ports/tenantAuthorization'

const AUTHORIZATION_SQL = `
WITH requested_tenant AS (
  SELECT id, status
  FROM tenants
  WHERE id = ?1
),
requested_principal AS (
  SELECT id, status
  FROM identity_principals
  WHERE provider = ?2 AND subject = ?3
)
SELECT
  (SELECT status FROM requested_tenant) AS tenant_status,
  (SELECT id FROM requested_principal) AS principal_id,
  (SELECT status FROM requested_principal) AS principal_status,
  (
    SELECT membership.status
    FROM tenant_memberships AS membership
    INNER JOIN requested_tenant AS tenant
      ON tenant.id = membership.tenant_id
    INNER JOIN requested_principal AS principal
      ON principal.id = membership.principal_id
    LIMIT 1
  ) AS membership_status;
`

type AuthorizationRow = Readonly<{
  tenant_status: 'active' | 'inactive' | null
  principal_id: string | null
  principal_status: 'active' | 'inactive' | null
  membership_status: 'active' | 'inactive' | null
}>

export type TenantAuthorizationErrorCode =
  | 'DATABASE_NOT_CONFIGURED'
  | 'DATABASE_UNAVAILABLE'
  | 'INVALID_ARGUMENT'

export class TenantAuthorizationError extends Error {
  readonly code: TenantAuthorizationErrorCode

  constructor(code: TenantAuthorizationErrorCode) {
    super('Tenant authorization could not be evaluated.')
    this.name = 'TenantAuthorizationError'
    this.code = code
  }
}

function normalizeProvider(value: string): string {
  const normalized = value.trim().toLowerCase()
  if (!/^[a-z0-9][a-z0-9_-]{0,31}$/.test(normalized)) {
    throw new TenantAuthorizationError('INVALID_ARGUMENT')
  }
  return normalized
}

function assertIdentifier(value: string, maxLength: number): string {
  const normalized = value.trim()
  if (!normalized || normalized.length > maxLength) {
    throw new TenantAuthorizationError('INVALID_ARGUMENT')
  }
  return normalized
}

export class D1TenantAuthorizationAdapter implements TenantAuthorizationPort {
  private readonly database?: D1Database

  constructor(database?: D1Database) {
    this.database = database
  }

  async authorize(request: TenantAccessRequest): Promise<TenantAccessDecision> {
    const database = this.requireDatabase()
    const tenantId = assertIdentifier(request.tenantId, 160)
    const authProvider = normalizeProvider(request.authProvider)
    const authSubject = assertIdentifier(request.authSubject, 255)

    let row: AuthorizationRow | null
    try {
      row = await database
        .prepare(AUTHORIZATION_SQL)
        .bind(tenantId, authProvider, authSubject)
        .first<AuthorizationRow>()
    } catch {
      throw new TenantAuthorizationError('DATABASE_UNAVAILABLE')
    }

    if (!row) {
      throw new TenantAuthorizationError('DATABASE_UNAVAILABLE')
    }

    if (row.tenant_status === null) {
      return { allowed: false, tenantId, reason: 'tenant_not_found' }
    }
    if (row.tenant_status !== 'active') {
      return { allowed: false, tenantId, reason: 'tenant_inactive' }
    }
    if (row.principal_id === null || row.principal_status === null) {
      return { allowed: false, tenantId, reason: 'identity_not_found' }
    }
    if (row.principal_status !== 'active') {
      return { allowed: false, tenantId, reason: 'identity_inactive' }
    }
    if (row.membership_status === null) {
      return { allowed: false, tenantId, reason: 'membership_not_found' }
    }
    if (row.membership_status !== 'active') {
      return { allowed: false, tenantId, reason: 'membership_inactive' }
    }

    return {
      allowed: true,
      tenantId,
      principalId: row.principal_id,
    }
  }

  private requireDatabase(): D1Database {
    if (!this.database) {
      throw new TenantAuthorizationError('DATABASE_NOT_CONFIGURED')
    }
    return this.database
  }
}
