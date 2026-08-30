import { env } from 'cloudflare:workers'
import { hash } from 'bcryptjs'
import { describe, expect, it } from 'vitest'

import { handleBetterAuthRequest } from '../src/auth/betterAuthRuntime'
import { handlePetshopClientsApiRequest } from '../src/petshopClientsApi'

const AUTH_SECRET = 'petshop-clients-test-secret-123456789012345678901'
const bindings = () => ({
  ...(env as EdgeEnv),
  APP_ENV: 'staging',
  EDGE_BETTER_AUTH_ENABLED: 'true',
  BETTER_AUTH_SECRET: AUTH_SECRET,
  AUTH_DB: (env as EdgeEnv & { AUTH_DB: D1Database }).AUTH_DB,
  DB: (env as EdgeEnv & { DB: D1Database }).DB,
})

describe('native petshop clients API', () => {
  it('creates tutor and pet atomically, searches, updates and soft-deletes them', async () => {
    const suffix = crypto.randomUUID()
    const tenantId = `tenant-client-api-${suffix}`
    const userId = `client-api-user-${suffix}`
    const principalId = `client-api-principal-${suffix}`
    const email = `client-api-${suffix}@test.invalid`
    const password = 'ValidPassword123!'
    const now = Date.now()
    const nowIso = new Date(now).toISOString()
    const db = bindings().DB
    const authDb = bindings().AUTH_DB

    await authDb.batch([
      authDb.prepare('INSERT INTO user(id,name,email,emailVerified,image,createdAt,updatedAt) VALUES(?1,?2,?3,1,NULL,?4,?4)')
        .bind(userId, 'Client API Test', email, nowIso),
      authDb.prepare('INSERT INTO account(id,userId,accountId,providerId,password,createdAt,updatedAt) VALUES(?1,?2,?3,?4,?5,?6,?6)')
        .bind(`credential:${userId}`, userId, userId, 'credential', await hash(password, 12), nowIso),
    ])
    await db.batch([
      db.prepare("INSERT INTO tenants(id,slug,name,status,created_at_ms,updated_at_ms) VALUES(?1,?2,'Client API Tenant','active',?3,?3)")
        .bind(tenantId, `client-api-${suffix}`, now),
      db.prepare("INSERT INTO identity_principals(id,provider,subject,display_name,email,status,created_at_ms,updated_at_ms) VALUES(?1,'better-auth',?2,'Client API Test',?3,'active',?4,?4)")
        .bind(principalId, userId, email, now),
      db.prepare("INSERT INTO tenant_memberships(tenant_id,principal_id,status,created_at_ms,updated_at_ms,role,module_permissions_json) VALUES(?1,?2,'active',?3,?3,'staff',?4)")
        .bind(tenantId, principalId, now, JSON.stringify({ petshop: { role: 'funcionario_pet' } })),
    ])

    let cookie = ''
    let clientId = ''
    let petId = ''
    try {
      const signIn = await handleBetterAuthRequest(new Request('https://edge.test/api/auth/sign-in/email', {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: 'https://edge.test' },
        body: JSON.stringify({ email, password, rememberMe: false }),
      }), bindings())
      cookie = signIn?.headers.get('set-cookie')?.split(';')[0] || ''
      expect(cookie).toContain('better-auth')
      const headers = { cookie, 'x-tenant-id': tenantId, 'x-module-id': 'petshop' }

      const created = await handlePetshopClientsApiRequest(new Request('https://edge.test/api/petshop/clients', {
        method: 'POST',
        headers: { ...headers, 'content-type': 'application/json' },
        body: JSON.stringify({
          owner_name: 'Marina QA', phone: '11999990000', pet_name: 'Lua QA', species: 'dog', weight_kg: 8,
        }),
      }), bindings())
      expect(created?.status).toBe(200)
      const createdBody = await created?.json<{ client: { id: string; tutor_group_id: string; owner_name: string; pet_name: string } }>()
      petId = createdBody?.client.id || ''
      clientId = createdBody?.client.tutor_group_id || ''
      expect(createdBody?.client).toEqual(expect.objectContaining({ owner_name: 'Marina QA', pet_name: 'Lua QA' }))
      expect(petId).toBeTruthy()
      expect(clientId).toBeTruthy()
      expect(petId).not.toBe(clientId)

      const searched = await handlePetshopClientsApiRequest(new Request('https://edge.test/api/petshop/clients?search=lua', { headers }), bindings())
      await expect(searched?.json()).resolves.toEqual({ clients: [expect.objectContaining({ id: petId, tutor_group_id: clientId })] })

      const updated = await handlePetshopClientsApiRequest(new Request(`https://edge.test/api/petshop/clients/${petId}`, {
        method: 'PATCH',
        headers: { ...headers, 'content-type': 'application/json' },
        body: JSON.stringify({ owner_name: 'Marina QA', phone: '11999990000', pet_name: 'Lua Atualizada', species: 'dog', weight_kg: 9 }),
      }), bindings())
      await expect(updated?.json()).resolves.toEqual({ client: expect.objectContaining({ id: petId, pet_name: 'Lua Atualizada', weight_kg: 9 }) })

      const removed = await handlePetshopClientsApiRequest(new Request(`https://edge.test/api/petshop/clients/${petId}`, { method: 'DELETE', headers }), bindings())
      expect(removed?.status).toBe(200)
      const pet = await db.prepare('SELECT status FROM pets WHERE tenant_id=?1 AND module_id=?2 AND id=?3').bind(tenantId, 'petshop', petId).first<{ status: string }>()
      const client = await db.prepare('SELECT status FROM clients WHERE tenant_id=?1 AND module_id=?2 AND id=?3').bind(tenantId, 'petshop', clientId).first<{ status: string }>()
      expect(pet?.status).toBe('inactive')
      expect(client?.status).toBe('inactive')
    } finally {
      if (petId) await db.prepare('DELETE FROM pets WHERE tenant_id=?1 AND module_id=?2 AND id=?3').bind(tenantId, 'petshop', petId).run()
      if (clientId) await db.prepare('DELETE FROM clients WHERE tenant_id=?1 AND module_id=?2 AND id=?3').bind(tenantId, 'petshop', clientId).run()
      await db.prepare('DELETE FROM tenant_memberships WHERE tenant_id=?1').bind(tenantId).run()
      await db.prepare('DELETE FROM identity_principals WHERE id=?1').bind(principalId).run()
      await db.prepare('DELETE FROM tenants WHERE id=?1').bind(tenantId).run()
      await authDb.prepare('DELETE FROM session WHERE userId=?1').bind(userId).run()
      await authDb.prepare('DELETE FROM account WHERE userId=?1').bind(userId).run()
      await authDb.prepare('DELETE FROM user WHERE id=?1').bind(userId).run()
    }
  })
})
