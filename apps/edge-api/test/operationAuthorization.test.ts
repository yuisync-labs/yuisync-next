import { describe, expect, it } from 'vitest'
import { env } from 'cloudflare:workers'
import { authorizePetshopRequest, compatibilityAccess, membershipAllows } from '../src/operationAuthorization'

import type { getBetterAuthSession } from '../src/auth/betterAuthRuntime'
const getSession: typeof getBetterAuthSession = async () => ({
  user: { id: 'commercial-test-user', name: 'Test', email: 'test@example.com', emailVerified: true, createdAt: new Date(), updatedAt: new Date() },
  session: { id: 'test-session', userId: 'commercial-test-user', token: 'test-only', expiresAt: new Date(Date.now() + 60000), createdAt: new Date(), updatedAt: new Date() },
})
const active = { role: 'member', status: 'active', tenant_status: 'active', module_permissions_json: JSON.stringify({ petshop: { role: 'funcionario_pet' } }) }

describe('commercial operation authorization', () => {
  it('does not interpret an arbitrary permission object as administrative access', () => {
    expect(membershipAllows(active, 'petshop', 'operational')).toBe(true)
    expect(membershipAllows(active, 'petshop', 'administrative')).toBe(false)
    expect(membershipAllows({ ...active, module_permissions_json: '{"petshop":{}}' }, 'petshop', 'operational')).toBe(false)
    expect(membershipAllows({ ...active, module_permissions_json: '{"petshop":{"role":"admin_pet"}}' }, 'petshop', 'administrative')).toBe(true)
  })
  it('rejects suspended tenants and inactive memberships, including owners', () => {
    expect(membershipAllows({ ...active, role: 'owner', tenant_status: 'suspended' }, 'petshop', 'administrative')).toBe(false)
    expect(membershipAllows({ ...active, role: 'owner', status: 'inactive' }, 'petshop', 'operational')).toBe(false)
  })
  it('separates catalog reads from price, configuration and commission writes', () => {
    expect(compatibilityAccess('/api/compat/query', { table: 'petshop_services' })).toBe('operational')
    for (const table of ['petshop_services', 'products', 'settings', 'commission_rules', 'profiles']) {
      expect(compatibilityAccess('/api/compat/query', { table, action: 'update' })).toBe('administrative')
    }
  })
  it('rejects direct native and compatibility writes by a real D1 employee membership', async () => {
    const db = (env as EdgeEnv & { DB: D1Database }).DB
    const now = Date.now()
    await db.batch([
      db.prepare("INSERT INTO tenants(id,slug,name,status,created_at_ms,updated_at_ms) VALUES('commercial-a','commercial-a','A','active',?1,?1)").bind(now),
      db.prepare("INSERT INTO identity_principals(id,provider,subject,status,created_at_ms,updated_at_ms) VALUES('commercial-p','better-auth','commercial-test-user','active',?1,?1)").bind(now),
      db.prepare("INSERT INTO tenant_memberships(tenant_id,principal_id,role,status,module_permissions_json,created_at_ms,updated_at_ms) VALUES('commercial-a','commercial-p','member','active',?1,?2,?2)").bind(active.module_permissions_json, now),
    ])
    const make = (path: string, tenant: string, body: unknown = {}) => new Request(`https://example.com${path}`, { method: 'POST', headers: { 'x-tenant-id': tenant, 'x-module-id': 'petshop', 'content-type': 'application/json' }, body: JSON.stringify(body) })
    expect((await authorizePetshopRequest(make('/api/petshop/services', 'commercial-a'), { DB: db }, getSession))?.status).toBe(403)
    expect((await authorizePetshopRequest(make('/api/compat/query', 'commercial-a', { table: 'settings', action: 'update' }), { DB: db }, getSession))?.status).toBe(403)
    expect(await authorizePetshopRequest(make('/api/petshop/appointments', 'commercial-a'), { DB: db }, getSession)).toBeNull()
    expect((await authorizePetshopRequest(make('/api/petshop/appointments', 'commercial-b'), { DB: db }, getSession))?.status).toBe(403)
    await db.prepare("UPDATE tenants SET status='inactive' WHERE id='commercial-a'").run()
    expect((await authorizePetshopRequest(make('/api/petshop/appointments', 'commercial-a'), { DB: db }, getSession))?.status).toBe(403)
  })
})
