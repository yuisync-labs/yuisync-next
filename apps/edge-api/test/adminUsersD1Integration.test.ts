import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'

import { handleAdminUsersApiRequest } from '../src/adminUsersApi'
import { handleBetterAuthRequest } from '../src/auth/betterAuthRuntime'

const AUTH_SECRET = 'managed-users-test-secret-123456789012345678901234567'

function bindings() {
  return {
    ...(env as EdgeEnv),
    APP_ENV: 'staging',
    EDGE_BETTER_AUTH_ENABLED: 'true',
    BETTER_AUTH_SECRET: AUTH_SECRET,
    DB: (env as EdgeEnv & { DB: D1Database }).DB,
    AUTH_DB: (env as EdgeEnv & { AUTH_DB: D1Database }).AUTH_DB,
  }
}

function fakeSession(userId: string) {
  return {
    user: {
      id: userId,
      name: 'Managed Users Test',
      email: `${userId}@test.invalid`,
    },
  } as any
}

async function signIn(email: string, password: string) {
  return handleBetterAuthRequest(new Request('https://edge.test/api/auth/sign-in/email', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: 'https://edge.test',
    },
    body: JSON.stringify({ email, password, rememberMe: false }),
  }), bindings())
}

describe('native users and roles API', () => {
  it('creates, lists, edits and deactivates a Better Auth user without crossing tenant boundaries', async () => {
    const runtime = bindings()
    const database = runtime.DB
    const authDatabase = runtime.AUTH_DB
    const suffix = crypto.randomUUID()
    const tenantId = `users-tenant-${suffix}`
    const otherTenantId = `users-other-${suffix}`
    const actorPrincipalId = `users-admin-principal-${suffix}`
    const actorSubject = `users-admin-subject-${suffix}`
    const managerPrincipalId = `users-manager-principal-${suffix}`
    const managerSubject = `users-manager-subject-${suffix}`
    const email = `employee-${suffix}@test.invalid`
    const firstPassword = 'InitialPassword123!'
    const secondPassword = 'ChangedPassword456!'
    const now = Date.now()
    let createdPrincipalId = ''
    let createdUserId = ''

    await database.batch([
      database.prepare("INSERT INTO tenants(id,slug,name,status,created_at_ms,updated_at_ms) VALUES(?1,?2,'Users Tenant','active',?3,?3)")
        .bind(tenantId, `users-${suffix}`, now),
      database.prepare("INSERT INTO tenants(id,slug,name,status,created_at_ms,updated_at_ms) VALUES(?1,?2,'Other Users Tenant','active',?3,?3)")
        .bind(otherTenantId, `users-other-${suffix}`, now),
      database.prepare("INSERT INTO identity_principals(id,provider,subject,display_name,email,status,created_at_ms,updated_at_ms) VALUES(?1,'better-auth',?2,'Global Admin',?3,'active',?4,?4)")
        .bind(actorPrincipalId, actorSubject, `global-${suffix}@test.invalid`, now),
      database.prepare("INSERT INTO tenant_memberships(tenant_id,principal_id,status,created_at_ms,updated_at_ms,role,module_permissions_json,staff_type) VALUES(?1,?2,'active',?3,?3,'admin',?4,NULL)")
        .bind(tenantId, actorPrincipalId, now, JSON.stringify({ petshop: 'admin_pet' })),
      database.prepare("INSERT INTO identity_principals(id,provider,subject,display_name,email,status,created_at_ms,updated_at_ms) VALUES(?1,'better-auth',?2,'Module Manager',?3,'active',?4,?4)")
        .bind(managerPrincipalId, managerSubject, `manager-${suffix}@test.invalid`, now),
      database.prepare("INSERT INTO tenant_memberships(tenant_id,principal_id,status,created_at_ms,updated_at_ms,role,module_permissions_json,staff_type) VALUES(?1,?2,'active',?3,?3,'manager',?4,'gerente')")
        .bind(tenantId, managerPrincipalId, now, JSON.stringify({ petshop: 'admin_pet' })),
    ])

    const asActor = { getSession: async () => fakeSession(actorSubject) }
    const asManager = { getSession: async () => fakeSession(managerSubject) }

    try {
      const create = await handleAdminUsersApiRequest(new Request('https://edge.test/api/admin/users', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          full_name: 'Maria Banho',
          email,
          password: firstPassword,
          role: 'employee',
          staff_type: 'banho_tosa',
          permissions: { petshop: 'funcionario_pet' },
          scopeModuleId: 'petshop',
          tenantIds: [tenantId],
          activeTenantId: tenantId,
        }),
      }), runtime, asActor)

      expect(create).not.toBeNull()
      expect(create?.status).toBe(201)
      const created = await create!.json<{ id: string; user_id: string }>()
      createdPrincipalId = created.id
      createdUserId = created.user_id

      const authUser = await authDatabase.prepare('SELECT id,name,email FROM user WHERE id=?1').bind(createdUserId).first<Record<string, unknown>>()
      expect(authUser).toEqual(expect.objectContaining({ id: createdUserId, name: 'Maria Banho', email }))
      const membership = await database.prepare('SELECT role,module_permissions_json,staff_type,status FROM tenant_memberships WHERE tenant_id=?1 AND principal_id=?2')
        .bind(tenantId, createdPrincipalId).first<Record<string, unknown>>()
      expect(membership).toEqual(expect.objectContaining({ role: 'staff', staff_type: 'banho_tosa', status: 'active' }))
      expect(JSON.parse(String(membership?.module_permissions_json))).toEqual({ petshop: 'funcionario_pet' })

      const firstLogin = await signIn(email, firstPassword)
      expect(firstLogin).not.toBeNull()
      expect(firstLogin?.status).toBe(200)

      const scopedList = await handleAdminUsersApiRequest(
        new Request(`https://edge.test/api/admin/users?module_id=petshop&tenant_id=${encodeURIComponent(tenantId)}`),
        runtime,
        asManager,
      )
      expect(scopedList?.status).toBe(200)
      const scopedBody = await scopedList!.json<{ profiles: Array<Record<string, any>> }>()
      const createdProfile = scopedBody.profiles.find((profile) => profile.id === createdPrincipalId)
      expect(createdProfile).toEqual(expect.objectContaining({
        full_name: 'Maria Banho',
        email,
        role: 'employee',
        active: true,
        staff_type: 'banho_tosa',
        module_permissions: { petshop: 'funcionario_pet' },
        tenant_ids: [tenantId],
      }))
      expect(createdProfile?.tenants?.[0]).toEqual(expect.objectContaining({ id: tenantId, active: true }))

      const hubDenied = await handleAdminUsersApiRequest(new Request('https://edge.test/api/admin/users'), runtime, asManager)
      expect(hubDenied?.status).toBe(403)

      const crossTenantCreate = await handleAdminUsersApiRequest(new Request('https://edge.test/api/admin/users', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          full_name: 'Forbidden User',
          email: `forbidden-${suffix}@test.invalid`,
          password: firstPassword,
          role: 'employee',
          staff_type: 'funcionario',
          permissions: { petshop: 'funcionario_pet' },
          scopeModuleId: 'petshop',
          tenantIds: [otherTenantId],
          activeTenantId: otherTenantId,
        }),
      }), runtime, asManager)
      expect(crossTenantCreate?.status).toBe(403)

      const update = await handleAdminUsersApiRequest(new Request(`https://edge.test/api/admin/users/${createdPrincipalId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          full_name: 'Maria Gerente',
          password: secondPassword,
          role: 'employee',
          staff_type: 'gerente',
          permissions: { petshop: 'admin_pet' },
          scopeModuleId: 'petshop',
          tenantIds: [tenantId],
          activeTenantId: tenantId,
        }),
      }), runtime, asActor)
      expect(update?.status).toBe(200)

      const updatedMembership = await database.prepare('SELECT role,module_permissions_json,staff_type FROM tenant_memberships WHERE tenant_id=?1 AND principal_id=?2')
        .bind(tenantId, createdPrincipalId).first<Record<string, unknown>>()
      expect(updatedMembership).toEqual(expect.objectContaining({ role: 'manager', staff_type: 'gerente' }))
      expect(JSON.parse(String(updatedMembership?.module_permissions_json))).toEqual({ petshop: 'admin_pet' })
      const secondLogin = await signIn(email, secondPassword)
      expect(secondLogin?.status).toBe(200)

      const deactivate = await handleAdminUsersApiRequest(new Request(`https://edge.test/api/admin/users/${createdPrincipalId}/status`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ active: false }),
      }), runtime, asActor)
      expect(deactivate?.status).toBe(200)
      const principal = await database.prepare('SELECT status FROM identity_principals WHERE id=?1').bind(createdPrincipalId).first<{ status: string }>()
      expect(principal?.status).toBe('inactive')

      const blocked = await handleAdminUsersApiRequest(
        new Request(`https://edge.test/api/admin/users?module_id=petshop&tenant_id=${encodeURIComponent(tenantId)}`),
        runtime,
        { getSession: async () => fakeSession(createdUserId) },
      )
      expect(blocked?.status).toBe(403)

      const selfDeactivate = await handleAdminUsersApiRequest(new Request(`https://edge.test/api/admin/users/${actorPrincipalId}/status`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ active: false }),
      }), runtime, asActor)
      expect(selfDeactivate?.status).toBe(409)
    } finally {
      if (createdUserId) {
        await authDatabase.prepare('DELETE FROM session WHERE userId=?1').bind(createdUserId).run()
        await authDatabase.prepare('DELETE FROM account WHERE userId=?1').bind(createdUserId).run()
        await authDatabase.prepare('DELETE FROM user WHERE id=?1').bind(createdUserId).run()
      }
      await database.prepare('DELETE FROM tenant_memberships WHERE tenant_id IN (?1,?2)').bind(tenantId, otherTenantId).run()
      for (const principalId of [createdPrincipalId, actorPrincipalId, managerPrincipalId].filter(Boolean)) {
        await database.prepare('DELETE FROM identity_principals WHERE id=?1').bind(principalId).run()
      }
      await database.prepare('DELETE FROM tenants WHERE id IN (?1,?2)').bind(tenantId, otherTenantId).run()
    }
  })
})
