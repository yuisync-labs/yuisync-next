import { describe, expect, it } from 'vitest'

import { buildBetterAuthIntakeSql, createBetterAuthIntakeWriter } from '../scripts/migration/betterAuthIntakeWriter.mjs'

function projection() {
  return {
    sensitive: true,
    authUsers: [{ id: 'u', name: 'User', email: 'u@example.com', emailVerified: 1, image: null, createdAt: 1, updatedAt: 1 }],
    authAccounts: [{ id: 'credential:u', userId: 'u', accountId: 'u', providerId: 'credential', password: '$2a$12$example', createdAt: 1, updatedAt: 1 }],
    principals: [{ id: 'u', provider: 'better-auth', subject: 'u', display_name: 'User', email: 'u@example.com', status: 'active', created_at_ms: 1, updated_at_ms: 1 }],
    tenantMemberships: [{ tenant_id: 't', principal_id: 'u', status: 'active', role: 'owner', module_permissions_json: '{}', created_at_ms: 1, updated_at_ms: 1 }],
    managedProfiles: [{ principal_id: 'u', staff_type: 'funcionario', preferred_tenant_id: 't', created_at_ms: 1, updated_at_ms: 1 }],
  }
}

describe('Better Auth intake writer', () => {
  it('builds separate AUTH_DB and main DB transactions', () => {
    const result = buildBetterAuthIntakeSql(projection())
    expect(result.authSql).toContain('INSERT INTO user')
    expect(result.authSql).toContain('INSERT INTO account')
    expect(result.mainSql).toContain('INSERT INTO identity_principals')
    expect(result.mainSql).toContain('INSERT INTO tenant_memberships')
    expect(result.mainSql).toContain('INSERT INTO managed_user_profiles')
  })

  it('fails closed until an identity collision check is explicitly marked green', async () => {
    const writer = createBetterAuthIntakeWriter({ collisionCheckPassed: false, execFile: async () => ({ stdout: '' }) })
    await expect(writer({ runId: 'run-1', projection: projection() }))
      .rejects.toMatchObject({ code: 'AUTH_INTAKE_COLLISION_CHECK_REQUIRED' })
  })

  it('requires run-specific authorization for production', async () => {
    const writer = createBetterAuthIntakeWriter({
      environment: 'production', collisionCheckPassed: true, productionAuthorization: 'wrong', execFile: async () => ({ stdout: '' }),
    })
    await expect(writer({ runId: 'run-1', projection: projection() }))
      .rejects.toMatchObject({ code: 'AUTH_INTAKE_PRODUCTION_NOT_AUTHORIZED' })
  })
})
