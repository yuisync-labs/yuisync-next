import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'
import { handleAppApiRequest } from '../src/appApi'
import type { getBetterAuthSession } from '../src/auth/betterAuthRuntime'

describe('assisted tenant provisioning', () => {
  it('rejects employees and replays concurrent provisioning without duplicate companies or settings', async () => {
    const DB = (env as EdgeEnv & { DB: D1Database }).DB
    const now = Date.now()
    const getSession: typeof getBetterAuthSession = async () => ({
      user: { id: 'onboarding-user', email: 'onboarding@test.invalid', name: 'Test', emailVerified: true, createdAt: new Date(), updatedAt: new Date() },
      session: { id: 'onboarding-session', userId: 'onboarding-user', token: 'test-only', expiresAt: new Date(now + 60000), createdAt: new Date(), updatedAt: new Date() },
    })
    await DB.batch([
      DB.prepare("INSERT INTO tenants(id,slug,name,status,created_at_ms,updated_at_ms) VALUES('onboarding-parent','onboarding-parent','Parent','active',?1,?1)").bind(now),
      DB.prepare("INSERT INTO identity_principals(id,provider,subject,status,created_at_ms,updated_at_ms) VALUES('onboarding-principal','better-auth','onboarding-user','active',?1,?1)").bind(now),
      DB.prepare("INSERT INTO tenant_memberships(tenant_id,principal_id,role,status,module_permissions_json,created_at_ms,updated_at_ms) VALUES('onboarding-parent','onboarding-principal','member','active','{}',?1,?1)").bind(now),
    ])
    const make = (name = 'Nova empresa') => new Request('https://edge.test/api/app/tenants', { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': 'onboarding-operation-123' }, body: JSON.stringify({ name }) })
    expect((await handleAppApiRequest(make(), { DB }, { getSession }))?.status).toBe(403)
    await DB.prepare("UPDATE tenant_memberships SET role='admin' WHERE principal_id='onboarding-principal'").run()
    const results = await Promise.all([handleAppApiRequest(make(), { DB }, { getSession }), handleAppApiRequest(make(), { DB }, { getSession })])
    expect(results.every(response => response && [200, 201].includes(response.status))).toBe(true)
    const [a, b] = await Promise.all(results.map(response => response!.json<{ id: string }>()))
    expect(a.id).toBe(b.id)
    const extension = await DB.prepare("SELECT data_json FROM module_settings_extensions WHERE tenant_id=?1 AND module_id='petshop'").bind(a.id).first<{ data_json: string }>()
    expect(JSON.parse(extension!.data_json)).toMatchObject({ veterinary_name: 'Veterinário responsável', petshop_operational_staff: [], petshop_delivery_staff: [] })
    expect((await handleAppApiRequest(make('Outro nome'), { DB }, { getSession }))?.status).toBe(409)
    expect((await DB.prepare("SELECT id FROM tenants WHERE name='Nova empresa'").all()).results).toHaveLength(1)
  })
})
