import { env } from 'cloudflare:workers'
import { hash } from 'bcryptjs'
import { describe, expect, it } from 'vitest'

import { handleAppApiRequest } from '../src/appApi'
import { getBetterAuthSession, handleBetterAuthRequest } from '../src/auth/betterAuthRuntime'
import { handleCompatApiRequest } from '../src/compatApi'

const AUTH_SECRET = 'better-auth-d1-test-secret-123456789012345678901234'

function bindings() {
  return {
    ...(env as EdgeEnv),
    APP_ENV: 'staging',
    EDGE_BETTER_AUTH_ENABLED: 'true',
    BETTER_AUTH_SECRET: AUTH_SECRET,
    AUTH_DB: (env as EdgeEnv & { AUTH_DB: D1Database }).AUTH_DB,
  }
}

function fakeAppSession(userId: string) {
  return {
    user: {
      id: userId,
      name: 'Directory Test User',
      email: `${userId}@test.invalid`,
    },
  } as unknown as NonNullable<Awaited<ReturnType<typeof getBetterAuthSession>>>
}

describe('Better Auth native D1 runtime', () => {
  it('signs in a credential user and persists a session using the real D1 dialect', async () => {
    const database = (env as EdgeEnv & { AUTH_DB: D1Database }).AUTH_DB
    const userId = crypto.randomUUID()
    const email = `d1-${userId}@test.invalid`
    const password = 'ValidPassword123!'
    const passwordHash = await hash(password, 12)
    const now = Date.now()
    const nowIso = new Date(now).toISOString()

    await database.batch([
      database.prepare('INSERT INTO user(id,name,email,emailVerified,image,createdAt,updatedAt) VALUES(?1,?2,?3,1,NULL,?4,?4)')
        .bind(userId, 'D1 Test User', email, nowIso),
      database.prepare('INSERT INTO account(id,userId,accountId,providerId,password,createdAt,updatedAt) VALUES(?1,?2,?3,?4,?5,?6,?6)')
        .bind(`credential:${userId}`, userId, userId, 'credential', passwordHash, nowIso),
    ])

    try {
      const response = await handleBetterAuthRequest(new Request('https://edge.test/api/auth/sign-in/email', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: 'https://edge.test',
        },
        body: JSON.stringify({ email, password, rememberMe: false }),
      }), bindings())

      expect(response).not.toBeNull()
      if (!response) return
      const responseBody = await response.clone().text()
      expect(response.status, `${responseBody} diagnostic=${response.headers.get('x-yuisync-auth-diagnostic') || ''}`).toBe(200)
      expect(response.headers.get('set-cookie')).toContain('better-auth')

      const sessions = await database.prepare('SELECT id,userId,token,expiresAt,createdAt,updatedAt FROM session WHERE userId=?1').bind(userId).all()
      expect(sessions.results).toHaveLength(1)
      expect(sessions.results[0]).toEqual(expect.objectContaining({ userId }))
      expect(Date.parse(String(sessions.results[0]?.expiresAt))).toBeGreaterThan(now)
      expect(typeof sessions.results[0]?.createdAt).toBe('string')
      expect(typeof sessions.results[0]?.updatedAt).toBe('string')
    } finally {
      await database.prepare('DELETE FROM session WHERE userId=?1').bind(userId).run()
      await database.prepare('DELETE FROM account WHERE userId=?1').bind(userId).run()
      await database.prepare('DELETE FROM user WHERE id=?1').bind(userId).run()
    }
  })

  it('lists only the requested tenant directory for authorized manager and staff sessions', async () => {
    const database = (env as EdgeEnv & { DB: D1Database }).DB
    const suffix = crypto.randomUUID()
    const tenantId = `tenant-directory-${suffix}`
    const otherTenantId = `tenant-directory-other-${suffix}`
    const managerId = `principal-manager-${suffix}`
    const memberId = `principal-member-${suffix}`
    const adminId = `principal-admin-${suffix}`
    const inactiveId = `principal-inactive-${suffix}`
    const outsiderId = `principal-outsider-${suffix}`
    const managerSubject = `better-manager-${suffix}`
    const memberSubject = `better-member-${suffix}`
    const now = Date.now()
    const allPrincipalIds = [managerId, memberId, adminId, inactiveId, outsiderId]

    await database.batch([
      database.prepare("INSERT INTO tenants(id,slug,name,status,created_at_ms,updated_at_ms) VALUES(?1,?2,'Directory Tenant','active',?3,?3)")
        .bind(tenantId, `directory-${suffix}`, now),
      database.prepare("INSERT INTO tenants(id,slug,name,status,created_at_ms,updated_at_ms) VALUES(?1,?2,'Other Directory Tenant','active',?3,?3)")
        .bind(otherTenantId, `directory-other-${suffix}`, now),
      database.prepare("INSERT INTO identity_principals(id,provider,subject,display_name,email,status,created_at_ms,updated_at_ms) VALUES(?1,'better-auth',?2,'Manager Test',?3,'active',?4,?4)")
        .bind(managerId, managerSubject, `manager-${suffix}@test.invalid`, now),
      database.prepare("INSERT INTO identity_principals(id,provider,subject,display_name,email,status,created_at_ms,updated_at_ms) VALUES(?1,'better-auth',?2,'Member Test',?3,'active',?4,?4)")
        .bind(memberId, memberSubject, `member-${suffix}@test.invalid`, now),
      database.prepare("INSERT INTO identity_principals(id,provider,subject,display_name,email,status,created_at_ms,updated_at_ms) VALUES(?1,'better-auth',?2,'Admin Test',?3,'active',?4,?4)")
        .bind(adminId, `better-admin-${suffix}`, `admin-${suffix}@test.invalid`, now),
      database.prepare("INSERT INTO identity_principals(id,provider,subject,display_name,email,status,created_at_ms,updated_at_ms) VALUES(?1,'better-auth',?2,'Inactive Test',?3,'active',?4,?4)")
        .bind(inactiveId, `better-inactive-${suffix}`, `inactive-${suffix}@test.invalid`, now),
      database.prepare("INSERT INTO identity_principals(id,provider,subject,display_name,email,status,created_at_ms,updated_at_ms) VALUES(?1,'better-auth',?2,'Outsider Test',?3,'active',?4,?4)")
        .bind(outsiderId, `better-outsider-${suffix}`, `outsider-${suffix}@test.invalid`, now),
      database.prepare("INSERT INTO tenant_memberships(tenant_id,principal_id,status,created_at_ms,updated_at_ms,role,module_permissions_json) VALUES(?1,?2,'active',?3,?3,'manager',?4)")
        .bind(tenantId, managerId, now, JSON.stringify({ petshop: { role: 'admin_pet' } })),
      database.prepare("INSERT INTO tenant_memberships(tenant_id,principal_id,status,created_at_ms,updated_at_ms,role,module_permissions_json) VALUES(?1,?2,'active',?3,?3,'staff',?4)")
        .bind(tenantId, memberId, now, JSON.stringify({ petshop: { role: 'funcionario_pet' } })),
      database.prepare("INSERT INTO tenant_memberships(tenant_id,principal_id,status,created_at_ms,updated_at_ms,role,module_permissions_json) VALUES(?1,?2,'active',?3,?3,'admin',?4)")
        .bind(tenantId, adminId, now, JSON.stringify({ petshop: { role: 'admin_pet' } })),
      database.prepare("INSERT INTO tenant_memberships(tenant_id,principal_id,status,created_at_ms,updated_at_ms,role,module_permissions_json) VALUES(?1,?2,'inactive',?3,?3,'staff',?4)")
        .bind(tenantId, inactiveId, now, JSON.stringify({ petshop: { role: 'funcionario_pet' } })),
      database.prepare("INSERT INTO tenant_memberships(tenant_id,principal_id,status,created_at_ms,updated_at_ms,role,module_permissions_json) VALUES(?1,?2,'active',?3,?3,'staff',?4)")
        .bind(otherTenantId, outsiderId, now, JSON.stringify({ petshop: { role: 'funcionario_pet' } })),
    ])

    const appBindings = { ...(env as EdgeEnv), DB: database }

    try {
      for (const subject of [managerSubject, memberSubject]) {
        const response = await handleAppApiRequest(
          new Request(`https://edge.test/api/admin/users?module_id=petshop&tenant_id=${encodeURIComponent(tenantId)}`),
          appBindings,
          { getSession: async () => fakeAppSession(subject) },
        )
        expect(response).not.toBeNull()
        if (!response) continue
        expect(response.status).toBe(200)

        const body = await response.json<{ profiles: Array<Record<string, unknown>> }>()
        expect(body.profiles).toHaveLength(4)
        expect(body.profiles.some((profile) => profile.id === outsiderId)).toBe(false)
        expect(body.profiles.find((profile) => profile.id === adminId)).toEqual(expect.objectContaining({
          role: 'admin',
          staff_type: 'gerente',
          active: true,
        }))
        expect(body.profiles.find((profile) => profile.id === managerId)).toEqual(expect.objectContaining({
          role: 'employee',
          staff_type: 'gerente',
          active: true,
        }))
        expect(body.profiles.find((profile) => profile.id === memberId)).toEqual(expect.objectContaining({
          role: 'employee',
          staff_type: 'funcionario',
          active: true,
        }))
        expect(body.profiles.find((profile) => profile.id === inactiveId)).toEqual(expect.objectContaining({ active: false }))
        expect(Object.keys(body.profiles[0] || {}).sort()).toEqual(['active', 'email', 'full_name', 'id', 'role', 'staff_type'].sort())
        expect(JSON.stringify(body)).not.toContain('module_permissions_json')
        expect(JSON.stringify(body)).not.toContain(managerSubject)
        expect(JSON.stringify(body)).not.toContain(memberSubject)
      }

      const crossTenant = await handleAppApiRequest(
        new Request(`https://edge.test/api/admin/users?module_id=petshop&tenant_id=${encodeURIComponent(otherTenantId)}`),
        appBindings,
        { getSession: async () => fakeAppSession(managerSubject) },
      )
      expect(crossTenant).not.toBeNull()
      expect(crossTenant?.status).toBe(403)
    } finally {
      await database.prepare('DELETE FROM tenant_memberships WHERE tenant_id IN (?1,?2)').bind(tenantId, otherTenantId).run()
      for (const principalId of allPrincipalIds) {
        await database.prepare('DELETE FROM identity_principals WHERE id=?1').bind(principalId).run()
      }
      await database.prepare('DELETE FROM tenants WHERE id IN (?1,?2)').bind(tenantId, otherTenantId).run()
    }
  })

  it('preserves the compat request body when deferred routing falls through to the base query handler', async () => {
    const authDatabase = (env as EdgeEnv & { AUTH_DB: D1Database }).AUTH_DB
    const database = (env as EdgeEnv & { DB: D1Database }).DB
    const suffix = crypto.randomUUID()
    const userId = `compat-user-${suffix}`
    const principalId = `compat-principal-${suffix}`
    const tenantId = `compat-tenant-${suffix}`
    const email = `compat-${suffix}@test.invalid`
    const password = 'ValidPassword123!'
    const passwordHash = await hash(password, 12)
    const now = Date.now()
    const nowIso = new Date(now).toISOString()
    const chatThreadId = `compat-thread-${suffix}`
    const chatMessageId = `compat-message-${suffix}`

    await authDatabase.batch([
      authDatabase.prepare('INSERT INTO user(id,name,email,emailVerified,image,createdAt,updatedAt) VALUES(?1,?2,?3,1,NULL,?4,?4)')
        .bind(userId, 'Compat Body Test', email, nowIso),
      authDatabase.prepare('INSERT INTO account(id,userId,accountId,providerId,password,createdAt,updatedAt) VALUES(?1,?2,?3,?4,?5,?6,?6)')
        .bind(`credential:${userId}`, userId, userId, 'credential', passwordHash, nowIso),
    ])
    await database.batch([
      database.prepare("INSERT INTO tenants(id,slug,name,status,created_at_ms,updated_at_ms) VALUES(?1,?2,'Compat Body Tenant','active',?3,?3)")
        .bind(tenantId, `compat-body-${suffix}`, now),
      database.prepare("INSERT INTO identity_principals(id,provider,subject,display_name,email,status,created_at_ms,updated_at_ms) VALUES(?1,'better-auth',?2,'Compat Body Test',?3,'active',?4,?4)")
        .bind(principalId, userId, email, now),
      database.prepare("INSERT INTO tenant_memberships(tenant_id,principal_id,status,created_at_ms,updated_at_ms,role,module_permissions_json) VALUES(?1,?2,'active',?3,?3,'staff',?4)")
        .bind(tenantId, principalId, now, JSON.stringify({ petshop: { role: 'funcionario_pet' } })),
      database.prepare("INSERT INTO chat_threads(tenant_id,module_id,id,channel,status,created_at_ms,updated_at_ms) VALUES(?1,'petshop',?2,'internal','open',?3,?3)")
        .bind(tenantId, chatThreadId, now),
      database.prepare("INSERT INTO chat_messages(tenant_id,module_id,id,thread_id,direction,actor_type,content_text,created_at_ms) VALUES(?1,'petshop',?2,?3,'outbound','assistant','Compat large IN',?4)")
        .bind(tenantId, chatMessageId, chatThreadId, now),
    ])

    try {
      const runtimeBindings = { ...bindings(), DB: database }
      const signIn = await handleBetterAuthRequest(new Request('https://edge.test/api/auth/sign-in/email', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: 'https://edge.test',
        },
        body: JSON.stringify({ email, password, rememberMe: false }),
      }), runtimeBindings)
      expect(signIn).not.toBeNull()
      if (!signIn) return
      expect(signIn.status).toBe(200)

      const setCookie = signIn.headers.get('set-cookie') || ''
      const sessionCookie = setCookie.split(';')[0]
      expect(sessionCookie).toContain('better-auth')

      const response = await handleCompatApiRequest(new Request('https://edge.test/api/compat/query', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie: sessionCookie,
          'x-tenant-id': tenantId,
          'x-module-id': 'petshop',
        },
        body: JSON.stringify({
          table: 'clients',
          action: 'select',
          filters: [],
          limit: 1,
        }),
      }), runtimeBindings)

      expect(response).not.toBeNull()
      if (!response) return
      const responseBody = await response.json<Record<string, unknown>>()
      expect(response.status).toBe(200)
      expect(responseBody.code).not.toBe('INVALID_JSON')
      expect(responseBody).toHaveProperty('data')

      const sessionIds = Array.from({ length: 600 }, (_, index) => `missing-thread-${suffix}-${index}`)
      sessionIds[317] = chatThreadId
      const largeInResponse = await handleCompatApiRequest(new Request('https://edge.test/api/compat/query', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie: sessionCookie,
          'x-tenant-id': tenantId,
          'x-module-id': 'petshop',
        },
        body: JSON.stringify({
          table: 'chat_messages',
          action: 'select',
          filters: [{ op: 'in', column: 'session_id', value: sessionIds }],
          limit: 1000,
        }),
      }), runtimeBindings)

      expect(largeInResponse).not.toBeNull()
      if (!largeInResponse) return
      const largeInBody = await largeInResponse.json<{ data: Array<Record<string, unknown>> }>()
      expect(largeInResponse.status).toBe(200)
      expect(largeInBody.data).toHaveLength(1)
      expect(largeInBody.data[0]).toMatchObject({ id: chatMessageId, session_id: chatThreadId })
    } finally {
      await authDatabase.prepare('DELETE FROM session WHERE userId=?1').bind(userId).run()
      await authDatabase.prepare('DELETE FROM account WHERE userId=?1').bind(userId).run()
      await authDatabase.prepare('DELETE FROM user WHERE id=?1').bind(userId).run()
      await database.prepare('DELETE FROM tenant_memberships WHERE tenant_id=?1').bind(tenantId).run()
      await database.prepare('DELETE FROM chat_messages WHERE tenant_id=?1').bind(tenantId).run()
      await database.prepare('DELETE FROM chat_threads WHERE tenant_id=?1').bind(tenantId).run()
      await database.prepare('DELETE FROM identity_principals WHERE id=?1').bind(principalId).run()
      await database.prepare('DELETE FROM tenants WHERE id=?1').bind(tenantId).run()
    }
  })
})
