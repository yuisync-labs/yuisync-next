import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'

import {
  D1TenantAuthorizationAdapter,
  TenantAuthorizationError,
} from '../src/adapters/d1TenantAuthorization'

const testEnv = env as EdgeEnv & { DB: D1Database }

const NOW_MS = 1_786_108_800_000

async function insertTenant(
  id: string,
  status: 'active' | 'inactive' = 'active',
): Promise<void> {
  await testEnv.DB
    .prepare(`
      INSERT INTO tenants (id, slug, name, status, created_at_ms, updated_at_ms)
      VALUES (?, ?, ?, ?, ?, ?)
    `)
    .bind(id, id.toLowerCase(), `Tenant ${id}`, status, NOW_MS, NOW_MS)
    .run()
}

async function insertPrincipal(
  id: string,
  subject: string,
  status: 'active' | 'inactive' = 'active',
): Promise<void> {
  await testEnv.DB
    .prepare(`
      INSERT INTO identity_principals (
        id,
        provider,
        subject,
        display_name,
        email,
        status,
        created_at_ms,
        updated_at_ms
      ) VALUES (?, 'supabase', ?, ?, ?, ?, ?, ?)
    `)
    .bind(
      id,
      subject,
      `Principal ${id}`,
      `${id}@example.test`,
      status,
      NOW_MS,
      NOW_MS,
    )
    .run()
}

async function insertMembership(
  tenantId: string,
  principalId: string,
  status: 'active' | 'inactive' = 'active',
): Promise<void> {
  await testEnv.DB
    .prepare(`
      INSERT INTO tenant_memberships (
        tenant_id,
        principal_id,
        status,
        created_at_ms,
        updated_at_ms
      ) VALUES (?, ?, ?, ?, ?)
    `)
    .bind(tenantId, principalId, status, NOW_MS, NOW_MS)
    .run()
}

function authorize(
  adapter: D1TenantAuthorizationAdapter,
  tenantId: string,
  subject: string,
) {
  return adapter.authorize({
    authProvider: 'SUPABASE',
    authSubject: subject,
    tenantId,
  })
}

describe('D1TenantAuthorizationAdapter', () => {
  it('nega tenant inexistente', async () => {
    const adapter = new D1TenantAuthorizationAdapter(testEnv.DB)

    await expect(authorize(adapter, 'tenant-missing', 'subject-missing')).resolves.toEqual({
      allowed: false,
      tenantId: 'tenant-missing',
      reason: 'tenant_not_found',
    })
  })

  it('nega tenant inativo mesmo quando identidade existe', async () => {
    await insertTenant('tenant-inactive', 'inactive')
    await insertPrincipal('principal-inactive-tenant', 'subject-inactive-tenant')
    await insertMembership('tenant-inactive', 'principal-inactive-tenant')

    const adapter = new D1TenantAuthorizationAdapter(testEnv.DB)

    await expect(authorize(
      adapter,
      'tenant-inactive',
      'subject-inactive-tenant',
    )).resolves.toEqual({
      allowed: false,
      tenantId: 'tenant-inactive',
      reason: 'tenant_inactive',
    })
  })

  it('nega identidade inexistente', async () => {
    await insertTenant('tenant-no-identity')
    const adapter = new D1TenantAuthorizationAdapter(testEnv.DB)

    await expect(authorize(
      adapter,
      'tenant-no-identity',
      'subject-no-identity',
    )).resolves.toEqual({
      allowed: false,
      tenantId: 'tenant-no-identity',
      reason: 'identity_not_found',
    })
  })

  it('nega identidade inativa', async () => {
    await insertTenant('tenant-inactive-identity')
    await insertPrincipal(
      'principal-inactive-identity',
      'subject-inactive-identity',
      'inactive',
    )
    await insertMembership(
      'tenant-inactive-identity',
      'principal-inactive-identity',
    )

    const adapter = new D1TenantAuthorizationAdapter(testEnv.DB)

    await expect(authorize(
      adapter,
      'tenant-inactive-identity',
      'subject-inactive-identity',
    )).resolves.toEqual({
      allowed: false,
      tenantId: 'tenant-inactive-identity',
      reason: 'identity_inactive',
    })
  })

  it('nega quando não existe membership', async () => {
    await insertTenant('tenant-no-membership')
    await insertPrincipal('principal-no-membership', 'subject-no-membership')

    const adapter = new D1TenantAuthorizationAdapter(testEnv.DB)

    await expect(authorize(
      adapter,
      'tenant-no-membership',
      'subject-no-membership',
    )).resolves.toEqual({
      allowed: false,
      tenantId: 'tenant-no-membership',
      reason: 'membership_not_found',
    })
  })

  it('nega membership inativa', async () => {
    await insertTenant('tenant-membership-inactive')
    await insertPrincipal('principal-membership-inactive', 'subject-membership-inactive')
    await insertMembership(
      'tenant-membership-inactive',
      'principal-membership-inactive',
      'inactive',
    )

    const adapter = new D1TenantAuthorizationAdapter(testEnv.DB)

    await expect(authorize(
      adapter,
      'tenant-membership-inactive',
      'subject-membership-inactive',
    )).resolves.toEqual({
      allowed: false,
      tenantId: 'tenant-membership-inactive',
      reason: 'membership_inactive',
    })
  })

  it('autoriza somente membership ativa no tenant solicitado', async () => {
    await insertTenant('tenant-authorized')
    await insertTenant('tenant-other')
    await insertPrincipal('principal-authorized', 'subject-authorized')
    await insertMembership('tenant-authorized', 'principal-authorized')

    const adapter = new D1TenantAuthorizationAdapter(testEnv.DB)

    await expect(authorize(
      adapter,
      'tenant-authorized',
      'subject-authorized',
    )).resolves.toEqual({
      allowed: true,
      tenantId: 'tenant-authorized',
      principalId: 'principal-authorized',
    })

    await expect(authorize(
      adapter,
      'tenant-other',
      'subject-authorized',
    )).resolves.toEqual({
      allowed: false,
      tenantId: 'tenant-other',
      reason: 'membership_not_found',
    })
  })

  it('falha fechado quando o binding D1 não está configurado', async () => {
    const adapter = new D1TenantAuthorizationAdapter()

    await expect(authorize(
      adapter,
      'tenant-any',
      'subject-any',
    )).rejects.toMatchObject<TenantAuthorizationError>({
      name: 'TenantAuthorizationError',
      code: 'DATABASE_NOT_CONFIGURED',
    })
  })

  it('D1 impede membership órfã por foreign key', async () => {
    await expect(testEnv.DB
      .prepare(`
        INSERT INTO tenant_memberships (
          tenant_id,
          principal_id,
          status,
          created_at_ms,
          updated_at_ms
        ) VALUES (?, ?, 'active', ?, ?)
      `)
      .bind('tenant-orphan', 'principal-orphan', NOW_MS, NOW_MS)
      .run()).rejects.toThrow()
  })
})
