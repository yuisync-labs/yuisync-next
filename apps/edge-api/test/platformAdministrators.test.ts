import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'

import { handleAppApiRequest } from '../src/appApi'
import { getBetterAuthSession } from '../src/auth/betterAuthRuntime'
import { handleManagedUsersApiRequest } from '../src/managedUsersApi'

function fakeSession(userId: string, email: string) {
  return {
    user: { id: userId, name: 'Platform Admin', email },
  } as unknown as NonNullable<Awaited<ReturnType<typeof getBetterAuthSession>>>
}

describe('platform administrators without tenant memberships', () => {
  it('bootstraps the management hub and creates another tenantless platform administrator', async () => {
    const DB = (env as EdgeEnv & { DB: D1Database }).DB
    const AUTH_DB = (env as EdgeEnv & { AUTH_DB: D1Database }).AUTH_DB
    const suffix = crypto.randomUUID()
    const actorUserId = `platform-actor-user-${suffix}`
    const actorPrincipalId = `platform-actor-principal-${suffix}`
    const actorEmail = `actor-${suffix}@test.invalid`
    const tenantId = `platform-directory-${suffix}`
    const targetEmail = `target-${suffix}@test.invalid`
    const now = Date.now()

    await DB.batch([
      DB.prepare("INSERT INTO tenants(id,slug,name,status,created_at_ms,updated_at_ms) VALUES(?1,?2,'Platform Directory Tenant','active',?3,?3)")
        .bind(tenantId, `platform-directory-${suffix}`, now),
      DB.prepare("INSERT INTO identity_principals(id,provider,subject,display_name,email,status,created_at_ms,updated_at_ms) VALUES(?1,'better-auth',?2,'Platform Actor',?3,'active',?4,?4)")
        .bind(actorPrincipalId, actorUserId, actorEmail, now),
      DB.prepare("INSERT INTO platform_administrators(principal_id,status,created_at_ms,updated_at_ms) VALUES(?1,'active',?2,?2)")
        .bind(actorPrincipalId, now),
    ])

    let targetPrincipalId = ''
    let targetUserId = ''
    const bindings = { ...(env as EdgeEnv), DB, AUTH_DB }
    const getSession = async () => fakeSession(actorUserId, actorEmail)

    try {
      const bootstrap = await handleAppApiRequest(
        new Request('https://edge.test/api/app/bootstrap'),
        bindings,
        { getSession },
      )
      expect(bootstrap?.status).toBe(200)
      const bootstrapBody = await bootstrap!.json<{
        profile: { role: string }
        tenants: unknown[]
        managed_tenants: Array<{ id: string }>
      }>()
      expect(bootstrapBody.profile.role).toBe('admin')
      expect(bootstrapBody.tenants).toEqual([])
      expect(bootstrapBody.managed_tenants.some((tenant) => tenant.id === tenantId)).toBe(true)

      const created = await handleManagedUsersApiRequest(new Request('https://edge.test/api/admin/users', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          full_name: 'Tenantless Platform Admin',
          email: targetEmail,
          password: 'TemporaryAdmin123!',
          role: 'admin',
          staff_type: null,
          permissions: {},
          scopeModuleId: 'system',
          tenantIds: [],
          activeTenantId: null,
        }),
      }), bindings, { getSession })
      expect(created?.status).toBe(201)
      const createdBody = await created!.json<{ profile: { id: string; role: string; tenant_ids: string[]; active: boolean } }>()
      targetPrincipalId = createdBody.profile.id
      expect(createdBody.profile).toEqual(expect.objectContaining({ role: 'admin', tenant_ids: [], active: true }))

      const principal = await DB.prepare('SELECT subject FROM identity_principals WHERE id=?1').bind(targetPrincipalId).first<{ subject: string }>()
      targetUserId = principal?.subject || ''
      expect(targetUserId).not.toBe('')
      expect(await DB.prepare('SELECT principal_id FROM platform_administrators WHERE principal_id=?1').bind(targetPrincipalId).first()).toBeTruthy()
      expect((await DB.prepare('SELECT COUNT(*) AS count FROM tenant_memberships WHERE principal_id=?1').bind(targetPrincipalId).first<{ count: number }>())?.count).toBe(0)

      const listed = await handleManagedUsersApiRequest(
        new Request('https://edge.test/api/admin/users'),
        bindings,
        { getSession },
      )
      expect(listed?.status).toBe(200)
      const listedBody = await listed!.json<{ profiles: Array<{ id: string; role: string; active: boolean }> }>()
      expect(listedBody.profiles.find((profile) => profile.id === targetPrincipalId)).toEqual(expect.objectContaining({
        role: 'admin',
        active: true,
      }))
    } finally {
      if (targetPrincipalId) {
        await DB.prepare('DELETE FROM admin_audit_events WHERE actor_principal_id=?1 OR target_principal_id=?2').bind(actorPrincipalId, targetPrincipalId).run()
        await DB.prepare('DELETE FROM identity_principals WHERE id=?1').bind(targetPrincipalId).run()
      }
      if (targetUserId) {
        await AUTH_DB.prepare('DELETE FROM session WHERE userId=?1').bind(targetUserId).run()
        await AUTH_DB.prepare('DELETE FROM account WHERE userId=?1').bind(targetUserId).run()
        await AUTH_DB.prepare('DELETE FROM user WHERE id=?1').bind(targetUserId).run()
      }
      await DB.prepare('DELETE FROM platform_administrators WHERE principal_id=?1').bind(actorPrincipalId).run()
      await DB.prepare('DELETE FROM identity_principals WHERE id=?1').bind(actorPrincipalId).run()
      await DB.prepare('DELETE FROM tenants WHERE id=?1').bind(tenantId).run()
    }
  })
})
