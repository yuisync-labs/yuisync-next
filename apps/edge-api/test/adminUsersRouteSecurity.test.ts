import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'

import { handleAdminUsersRoute } from '../src/adminUsersRoute'

function fakeSession(userId: string) {
  return {
    user: {
      id: userId,
      name: 'Tenant Manager',
      email: `${userId}@test.invalid`,
    },
  } as any
}

describe('admin users shared credential guard', () => {
  it('blocks a tenant-local admin from editing an identity shared with another tenant', async () => {
    const runtime = env as EdgeEnv & { DB: D1Database; AUTH_DB: D1Database }
    const database = runtime.DB
    const suffix = crypto.randomUUID()
    const tenantA = `guard-a-${suffix}`
    const tenantB = `guard-b-${suffix}`
    const actorPrincipal = `guard-actor-${suffix}`
    const actorSubject = `guard-actor-subject-${suffix}`
    const targetPrincipal = `guard-target-${suffix}`
    const targetSubject = `guard-target-subject-${suffix}`
    const now = Date.now()

    await database.batch([
      database.prepare("INSERT INTO tenants(id,slug,name,status,created_at_ms,updated_at_ms) VALUES(?1,?2,'Guard A','active',?3,?3)")
        .bind(tenantA, `guard-a-${suffix}`, now),
      database.prepare("INSERT INTO tenants(id,slug,name,status,created_at_ms,updated_at_ms) VALUES(?1,?2,'Guard B','active',?3,?3)")
        .bind(tenantB, `guard-b-${suffix}`, now),
      database.prepare("INSERT INTO identity_principals(id,provider,subject,display_name,email,status,created_at_ms,updated_at_ms) VALUES(?1,'better-auth',?2,'Tenant Manager',?3,'active',?4,?4)")
        .bind(actorPrincipal, actorSubject, `manager-${suffix}@test.invalid`, now),
      database.prepare("INSERT INTO identity_principals(id,provider,subject,display_name,email,status,created_at_ms,updated_at_ms) VALUES(?1,'better-auth',?2,'Shared Employee',?3,'active',?4,?4)")
        .bind(targetPrincipal, targetSubject, `shared-${suffix}@test.invalid`, now),
      database.prepare("INSERT INTO tenant_memberships(tenant_id,principal_id,status,created_at_ms,updated_at_ms,role,module_permissions_json,staff_type) VALUES(?1,?2,'active',?3,?3,'manager',?4,'gerente')")
        .bind(tenantA, actorPrincipal, now, JSON.stringify({ petshop: 'admin_pet' })),
      database.prepare("INSERT INTO tenant_memberships(tenant_id,principal_id,status,created_at_ms,updated_at_ms,role,module_permissions_json,staff_type) VALUES(?1,?2,'active',?3,?3,'staff',?4,'funcionario')")
        .bind(tenantA, targetPrincipal, now, JSON.stringify({ petshop: 'funcionario_pet' })),
      database.prepare("INSERT INTO tenant_memberships(tenant_id,principal_id,status,created_at_ms,updated_at_ms,role,module_permissions_json,staff_type) VALUES(?1,?2,'inactive',?3,?3,'staff',?4,'funcionario')")
        .bind(tenantB, targetPrincipal, now, JSON.stringify({ petshop: 'funcionario_pet' })),
    ])

    try {
      const response = await handleAdminUsersRoute(new Request(`https://edge.test/api/admin/users/${targetPrincipal}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          full_name: 'Credential Hijack Attempt',
          password: 'ChangedPassword456!',
          role: 'employee',
          staff_type: 'funcionario',
          permissions: { petshop: 'funcionario_pet' },
          scopeModuleId: 'petshop',
          tenantIds: [tenantA],
          activeTenantId: tenantA,
        }),
      }), runtime, {
        getSession: async () => fakeSession(actorSubject),
      })

      expect(response?.status).toBe(403)
      expect(await response?.json()).toMatchObject({ error: { code: 'FORBIDDEN' } })
    } finally {
      await database.prepare('DELETE FROM tenant_memberships WHERE tenant_id IN (?1,?2)').bind(tenantA, tenantB).run()
      await database.prepare('DELETE FROM identity_principals WHERE id IN (?1,?2)').bind(actorPrincipal, targetPrincipal).run()
      await database.prepare('DELETE FROM tenants WHERE id IN (?1,?2)').bind(tenantA, tenantB).run()
    }
  })

  it('blocks a tenant-local admin from editing a global-admin credential', async () => {
    const runtime = env as EdgeEnv & { DB: D1Database; AUTH_DB: D1Database }
    const database = runtime.DB
    const suffix = crypto.randomUUID()
    const tenantId = `guard-global-${suffix}`
    const actorPrincipal = `guard-local-${suffix}`
    const actorSubject = `guard-local-subject-${suffix}`
    const targetPrincipal = `guard-global-admin-${suffix}`
    const targetSubject = `guard-global-admin-subject-${suffix}`
    const now = Date.now()

    await database.batch([
      database.prepare("INSERT INTO tenants(id,slug,name,status,created_at_ms,updated_at_ms) VALUES(?1,?2,'Guard Global','active',?3,?3)")
        .bind(tenantId, `guard-global-${suffix}`, now),
      database.prepare("INSERT INTO identity_principals(id,provider,subject,display_name,email,status,created_at_ms,updated_at_ms) VALUES(?1,'better-auth',?2,'Local Manager',?3,'active',?4,?4)")
        .bind(actorPrincipal, actorSubject, `local-${suffix}@test.invalid`, now),
      database.prepare("INSERT INTO identity_principals(id,provider,subject,display_name,email,status,created_at_ms,updated_at_ms) VALUES(?1,'better-auth',?2,'Global Admin',?3,'active',?4,?4)")
        .bind(targetPrincipal, targetSubject, `global-${suffix}@test.invalid`, now),
      database.prepare("INSERT INTO tenant_memberships(tenant_id,principal_id,status,created_at_ms,updated_at_ms,role,module_permissions_json,staff_type) VALUES(?1,?2,'active',?3,?3,'manager',?4,'gerente')")
        .bind(tenantId, actorPrincipal, now, JSON.stringify({ petshop: 'admin_pet' })),
      database.prepare("INSERT INTO tenant_memberships(tenant_id,principal_id,status,created_at_ms,updated_at_ms,role,module_permissions_json,staff_type) VALUES(?1,?2,'active',?3,?3,'admin',?4,NULL)")
        .bind(tenantId, targetPrincipal, now, JSON.stringify({ petshop: 'admin_pet' })),
    ])

    try {
      const response = await handleAdminUsersRoute(new Request(`https://edge.test/api/admin/users/${targetPrincipal}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          full_name: 'Global Admin',
          role: 'employee',
          staff_type: 'funcionario',
          permissions: { petshop: 'funcionario_pet' },
          scopeModuleId: 'petshop',
          tenantIds: [tenantId],
          activeTenantId: tenantId,
        }),
      }), runtime, {
        getSession: async () => fakeSession(actorSubject),
      })

      expect(response?.status).toBe(403)
      expect(await response?.json()).toMatchObject({ error: { code: 'FORBIDDEN' } })
    } finally {
      await database.prepare('DELETE FROM tenant_memberships WHERE tenant_id=?1').bind(tenantId).run()
      await database.prepare('DELETE FROM identity_principals WHERE id IN (?1,?2)').bind(actorPrincipal, targetPrincipal).run()
      await database.prepare('DELETE FROM tenants WHERE id=?1').bind(tenantId).run()
    }
  })
})
