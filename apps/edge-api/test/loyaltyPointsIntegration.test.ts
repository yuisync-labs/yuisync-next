import { env } from 'cloudflare:workers'
import { hash } from 'bcryptjs'
import { describe, expect, it } from 'vitest'

import { handleBetterAuthRequest } from '../src/auth/betterAuthRuntime'
import { handleCompatApiRequest } from '../src/compatApi'

const AUTH_SECRET = 'loyalty-points-test-secret-123456789012345678901234'

function bindings() {
  return {
    ...(env as EdgeEnv),
    APP_ENV: 'staging',
    EDGE_BETTER_AUTH_ENABLED: 'true',
    BETTER_AUTH_SECRET: AUTH_SECRET,
    AUTH_DB: (env as EdgeEnv & { AUTH_DB: D1Database }).AUTH_DB,
    DB: (env as EdgeEnv & { DB: D1Database }).DB,
  }
}

async function insertPoints(cookie: string, tenantId: string, payload: Record<string, unknown>) {
  const response = await handleCompatApiRequest(new Request('https://edge.test/api/compat/query', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      cookie,
      'x-tenant-id': tenantId,
      'x-module-id': 'petshop',
    },
    body: JSON.stringify({
      table: 'loyalty_points',
      action: 'insert',
      payload,
      filters: [{ op: 'eq', column: 'id', value: payload.id }],
      columns: '*,clients(id,name,phone,email,address,neighborhood,city,details)',
      mode: 'single',
    }),
  }), bindings())
  expect(response).not.toBeNull()
  return response as Response
}

describe('loyalty points compatibility flow', () => {
  it('resolves a selected pet to its tutor and persists expiry and cumulative balance', async () => {
    const authDb = (env as EdgeEnv & { AUTH_DB: D1Database }).AUTH_DB
    const db = (env as EdgeEnv & { DB: D1Database }).DB
    const suffix = crypto.randomUUID()
    const tenantId = `tenant-loyalty-${suffix}`
    const userId = `loyalty-user-${suffix}`
    const principalId = `loyalty-principal-${suffix}`
    const clientId = `loyalty-client-${suffix}`
    const petId = `loyalty-pet-${suffix}`
    const firstId = `loyalty-entry-1-${suffix}`
    const secondId = `loyalty-entry-2-${suffix}`
    const email = `loyalty-${suffix}@test.invalid`
    const password = 'ValidPassword123!'
    const passwordHash = await hash(password, 12)
    const now = Date.now()
    const nowIso = new Date(now).toISOString()

    await authDb.batch([
      authDb.prepare('INSERT INTO user(id,name,email,emailVerified,image,createdAt,updatedAt) VALUES(?1,?2,?3,1,NULL,?4,?4)')
        .bind(userId, 'Loyalty Test User', email, nowIso),
      authDb.prepare('INSERT INTO account(id,userId,accountId,providerId,password,createdAt,updatedAt) VALUES(?1,?2,?3,?4,?5,?6,?6)')
        .bind(`credential:${userId}`, userId, userId, 'credential', passwordHash, nowIso),
    ])
    await db.batch([
      db.prepare("INSERT INTO tenants(id,slug,name,status,created_at_ms,updated_at_ms) VALUES(?1,?2,'Loyalty Tenant','active',?3,?3)")
        .bind(tenantId, `loyalty-${suffix}`, now),
      db.prepare("INSERT INTO identity_principals(id,provider,subject,display_name,email,status,created_at_ms,updated_at_ms) VALUES(?1,'better-auth',?2,'Loyalty Test User',?3,'active',?4,?4)")
        .bind(principalId, userId, email, now),
      db.prepare("INSERT INTO tenant_memberships(tenant_id,principal_id,status,created_at_ms,updated_at_ms,role,module_permissions_json) VALUES(?1,?2,'active',?3,?3,'staff',?4)")
        .bind(tenantId, principalId, now, JSON.stringify({ petshop: { role: 'funcionario_pet' } })),
      db.prepare("INSERT INTO clients(tenant_id,module_id,id,name,phone,status,created_at_ms,updated_at_ms) VALUES(?1,'petshop',?2,'Joaquim','11999999999','active',?3,?3)")
        .bind(tenantId, clientId, now),
      db.prepare("INSERT INTO pets(tenant_id,module_id,id,client_id,name,species,status,created_at_ms,updated_at_ms) VALUES(?1,'petshop',?2,?3,'Loki','dog','active',?4,?4)")
        .bind(tenantId, petId, clientId, now),
    ])

    try {
      const signIn = await handleBetterAuthRequest(new Request('https://edge.test/api/auth/sign-in/email', {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: 'https://edge.test' },
        body: JSON.stringify({ email, password, rememberMe: false }),
      }), bindings())
      expect(signIn?.status).toBe(200)
      const cookie = signIn?.headers.get('set-cookie')?.split(';')[0] || ''

      const first = await insertPoints(cookie, tenantId, {
        id: firstId,
        client_id: petId,
        points: 20,
        reason: 'bonus',
        expires_at: '2026-12-25',
        created_at: '2026-09-16T12:00:00.000Z',
      })
      const firstBody = await first.json<{ data: Record<string, any> }>()
      expect(first.status).toBe(200)
      expect(firstBody.data).toMatchObject({
        id: firstId,
        client_id: clientId,
        points: 20,
        expires_at: '2026-12-25T00:00:00.000Z',
        clients: { id: clientId, name: 'Joaquim' },
      })

      const second = await insertPoints(cookie, tenantId, {
        id: secondId,
        client_id: clientId,
        points: 10,
        reason: 'bonus',
        created_at: '2026-09-16T12:00:00.000Z',
      })
      expect(second.status).toBe(200)

      const stored = await db.prepare('SELECT client_id,points_delta,balance_after,expires_at_ms,created_at_ms FROM loyalty_points WHERE tenant_id=?1 AND module_id=?2 ORDER BY created_at_ms,id')
        .bind(tenantId, 'petshop').all<Record<string, unknown>>()
      expect(stored.results).toEqual([
        expect.objectContaining({ client_id: clientId, points_delta: 20, balance_after: 20, expires_at_ms: Date.parse('2026-12-25'), created_at_ms: Date.parse('2026-09-16T12:00:00.000Z') }),
        expect.objectContaining({ client_id: clientId, points_delta: 10, balance_after: 30, expires_at_ms: null, created_at_ms: Date.parse('2026-09-16T12:00:00.000Z') + 1 }),
      ])
    } finally {
      await authDb.prepare('DELETE FROM session WHERE userId=?1').bind(userId).run()
      await authDb.prepare('DELETE FROM account WHERE userId=?1').bind(userId).run()
      await authDb.prepare('DELETE FROM user WHERE id=?1').bind(userId).run()
      await db.prepare('DELETE FROM loyalty_points WHERE tenant_id=?1').bind(tenantId).run()
      await db.prepare('DELETE FROM pets WHERE tenant_id=?1').bind(tenantId).run()
      await db.prepare('DELETE FROM clients WHERE tenant_id=?1').bind(tenantId).run()
      await db.prepare('DELETE FROM tenant_memberships WHERE tenant_id=?1').bind(tenantId).run()
      await db.prepare('DELETE FROM identity_principals WHERE id=?1').bind(principalId).run()
      await db.prepare('DELETE FROM tenants WHERE id=?1').bind(tenantId).run()
    }
  })
})
