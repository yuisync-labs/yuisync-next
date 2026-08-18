import { describe, expect, it } from 'vitest'

import { buildBetterAuthCollisionQueries, evaluateBetterAuthCollisionPreflight } from '../scripts/migration/betterAuthCollisionPreflight.mjs'

function projection() {
  return {
    sensitive: true,
    authUsers: [{ id: 'u1', name: 'User', email: 'User@Example.com', emailVerified: 1, image: null }],
    authAccounts: [{ id: 'credential:u1', userId: 'u1', accountId: 'u1', providerId: 'credential', password: '$2a$12$hash' }],
    principals: [{ id: 'u1', provider: 'better-auth', subject: 'u1', display_name: 'User', email: 'user@example.com', status: 'active' }],
    tenantMemberships: [{ tenant_id: 'tenant-1', principal_id: 'u1', status: 'active', role: 'owner', module_permissions_json: '{"petshop":{"role":"admin_pet"}}' }],
    managedProfiles: [{ principal_id: 'u1', staff_type: 'funcionario', preferred_tenant_id: 'tenant-1' }],
  }
}

describe('Better Auth collision preflight', () => {
  it('builds read-only lookup queries without embedding password hashes', () => {
    const queries = buildBetterAuthCollisionQueries(projection())
    expect(queries.authUsers).toContain('user@example.com')
    expect(queries.authAccounts).toContain('credential:u1')
    expect(queries.principals).toContain("provider='better-auth'")
    expect(Object.values(queries).join('\n')).not.toContain('$2a$12$hash')
    expect(Object.values(queries).every((query) => /^SELECT /u.test(query))).toBe(true)
  })

  it('passes when the destination identity surface is completely free', () => {
    expect(evaluateBetterAuthCollisionPreflight({ projection: projection(), target: {
      authUsers: [], authAccounts: [], principals: [], memberships: [], tenant: [],
    } })).toMatchObject({ ok: true, collision_count: 0, tenant: { status: 'free' } })
  })

  it('passes exact retry identities only when the existing tenant is explicitly allowed', () => {
    const p = projection()
    const target = {
      authUsers: [{ id: 'u1', email: 'user@example.com' }],
      authAccounts: [{ id: 'credential:u1', userId: 'u1', accountId: 'u1', providerId: 'credential' }],
      principals: [{ id: 'u1', provider: 'better-auth', subject: 'u1', email: 'user@example.com' }],
      memberships: [{ tenant_id: 'tenant-1', principal_id: 'u1', role: 'owner', module_permissions_json: '{"petshop":{"role":"admin_pet"}}' }],
      tenant: [{ id: 'tenant-1', slug: 'tenant-1', name: 'Existing', status: 'active' }],
    }
    expect(evaluateBetterAuthCollisionPreflight({ projection: p, target }).ok).toBe(false)
    const retry = evaluateBetterAuthCollisionPreflight({ projection: p, target, allowExistingTenant: true })
    expect(retry.ok).toBe(true)
    expect(retry.users[0].status).toBe('exact_retry')
  })

  it('fails if an email is already owned by a different Better Auth user id', () => {
    const report = evaluateBetterAuthCollisionPreflight({ projection: projection(), target: {
      authUsers: [{ id: 'different-id', email: 'user@example.com' }],
      authAccounts: [], principals: [], memberships: [], tenant: [],
    } })
    expect(report.ok).toBe(false)
    expect(report.collision_count).toBeGreaterThan(0)
    expect(report.users[0].status).toBe('collision')
  })

  it('fails if a principal subject or membership collides with incompatible data', () => {
    const report = evaluateBetterAuthCollisionPreflight({ projection: projection(), target: {
      authUsers: [], authAccounts: [],
      principals: [{ id: 'other', provider: 'better-auth', subject: 'u1', email: 'other@example.com' }],
      memberships: [{ tenant_id: 'tenant-1', principal_id: 'u1', role: 'staff', module_permissions_json: '{}' }],
      tenant: [],
    } })
    expect(report.ok).toBe(false)
    expect(report.principals[0].status).toBe('collision')
    expect(report.memberships[0].status).toBe('collision')
  })
})
