import { env } from 'cloudflare:workers'
import { afterEach, describe, expect, it } from 'vitest'

import { handleAppSettingsApiRequest } from '../src/appSettingsApi'

const db = (env as EdgeEnv & { DB: D1Database }).DB
const tenants = new Set<string>()
const principals = new Set<string>()

function sessionFor(subject: string) {
  return async () => ({ user: { id: subject } } as never)
}

async function seedPrincipal(prefix: string, status = 'active') {
  const suffix = crypto.randomUUID()
  const principalId = `${prefix}-principal-${suffix}`
  const subject = `${prefix}-subject-${suffix}`
  const now = Date.now()
  await db.prepare(`
    INSERT INTO identity_principals(id,provider,subject,status,created_at_ms,updated_at_ms)
    VALUES(?1,'better-auth',?2,?3,?4,?4)
  `).bind(principalId, subject, status, now).run()
  principals.add(principalId)
  return { principalId, subject }
}

async function seedTenant(prefix: string, status = 'active') {
  const suffix = crypto.randomUUID()
  const tenantId = `${prefix}-${suffix}`
  const now = Date.now()
  await db.batch([
    db.prepare(`
      INSERT INTO tenants(id,slug,name,status,created_at_ms,updated_at_ms)
      VALUES(?1,?2,?3,?4,?5,?5)
    `).bind(tenantId, `${prefix}-${suffix}`.toLowerCase(), `${prefix} test`, status, now),
    db.prepare(`
      INSERT INTO tenant_module_settings(
        tenant_id,module_id,store_name,store_phone,store_address,store_neighborhood,store_city,
        bot_prompt,version,created_at_ms,updated_at_ms
      ) VALUES(?1,'petshop',?2,'','','','','',1,?3,?3)
    `).bind(tenantId, `${prefix} original`, now),
  ])
  tenants.add(tenantId)
  return tenantId
}

async function addMembership(
  tenantId: string,
  principalId: string,
  role: string,
  permissions: Record<string, unknown> = {},
  status = 'active',
) {
  const now = Date.now()
  await db.prepare(`
    INSERT INTO tenant_memberships(
      tenant_id,principal_id,status,created_at_ms,updated_at_ms,role,module_permissions_json
    ) VALUES(?1,?2,?3,?4,?4,?5,?6)
  `).bind(tenantId, principalId, status, now, role, JSON.stringify(permissions)).run()
}

function request(method: 'GET' | 'PATCH', tenantId: string, body?: Record<string, unknown>) {
  return new Request(`https://edge.test/api/app/settings?tenant_id=${encodeURIComponent(tenantId)}&module_id=petshop`, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
}

afterEach(async () => {
  for (const tenantId of tenants) {
    await db.prepare('DELETE FROM module_settings_extensions WHERE tenant_id=?1').bind(tenantId).run()
    await db.prepare('DELETE FROM tenant_module_settings WHERE tenant_id=?1').bind(tenantId).run()
    await db.prepare('DELETE FROM tenant_memberships WHERE tenant_id=?1').bind(tenantId).run()
    await db.prepare('DELETE FROM tenants WHERE id=?1').bind(tenantId).run()
  }
  for (const principalId of principals) {
    await db.prepare('DELETE FROM tenant_memberships WHERE principal_id=?1').bind(principalId).run()
    await db.prepare('DELETE FROM identity_principals WHERE id=?1').bind(principalId).run()
  }
  tenants.clear()
  principals.clear()
})

describe('app settings centralized authorization', () => {
  it.each([
    { name: 'owner', role: 'owner', permissions: {}, read: 200, patch: 200 },
    { name: 'admin', role: 'admin', permissions: {}, read: 200, patch: 200 },
    { name: 'admin_pet membership', role: 'admin_pet', permissions: {}, read: 200, patch: 200 },
    { name: 'admin_pet permission', role: 'manager', permissions: { petshop: { role: 'admin_pet' } }, read: 200, patch: 200 },
    { name: 'funcionario_pet', role: 'staff', permissions: { petshop: { role: 'funcionario_pet' } }, read: 200, patch: 403 },
    { name: 'conflicting admin flag', role: 'staff', permissions: { petshop: { role: 'funcionario_pet', admin: true } }, read: 200, patch: 403 },
    { name: 'other module admin', role: 'staff', permissions: { agenda: { role: 'admin_agenda' } }, read: 403, patch: 403 },
    { name: 'wildcard admin role', role: 'staff', permissions: { '*': { role: 'admin_pet' } }, read: 403, patch: 403 },
  ])('$name has the expected GET/PATCH boundary', async ({ role, permissions, read, patch }) => {
    const principal = await seedPrincipal(`settings-role-${role}`)
    const tenantId = await seedTenant(`settings-role-${role}`)
    await addMembership(tenantId, principal.principalId, role, permissions)

    const readResponse = await handleAppSettingsApiRequest(
      request('GET', tenantId),
      { DB: db } as never,
      { getSession: sessionFor(principal.subject) },
    )
    expect(readResponse?.status).toBe(read)

    const patchResponse = await handleAppSettingsApiRequest(
      request('PATCH', tenantId, { business_name: 'attempted change' }),
      { DB: db } as never,
      { getSession: sessionFor(principal.subject) },
    )
    expect(patchResponse?.status).toBe(patch)

    const stored = await db.prepare(`
      SELECT store_name FROM tenant_module_settings WHERE tenant_id=?1 AND module_id='petshop'
    `).bind(tenantId).first<{ store_name: string }>()
    expect(stored?.store_name).toBe(patch === 200 ? 'attempted change' : `settings-role-${role} original`)
  })

  it('denies inactive membership without touching data', async () => {
    const principal = await seedPrincipal('settings-inactive-membership')
    const tenantId = await seedTenant('settings-inactive-membership')
    await addMembership(tenantId, principal.principalId, 'owner', {}, 'inactive')

    for (const method of ['GET', 'PATCH'] as const) {
      const response = await handleAppSettingsApiRequest(
        request(method, tenantId, method === 'PATCH' ? { business_name: 'blocked' } : undefined),
        { DB: db } as never,
        { getSession: sessionFor(principal.subject) },
      )
      expect(response?.status).toBe(403)
    }
  })

  it('denies suspended/inactive tenant and inactive principal', async () => {
    const inactivePrincipal = await seedPrincipal('settings-inactive-principal', 'inactive')
    const activePrincipal = await seedPrincipal('settings-inactive-tenant')
    const activeTenant = await seedTenant('settings-active-tenant')
    const inactiveTenant = await seedTenant('settings-suspended-tenant', 'inactive')
    await addMembership(activeTenant, inactivePrincipal.principalId, 'owner')
    await addMembership(inactiveTenant, activePrincipal.principalId, 'owner')

    const principalDenied = await handleAppSettingsApiRequest(
      request('PATCH', activeTenant, { business_name: 'blocked principal' }),
      { DB: db } as never,
      { getSession: sessionFor(inactivePrincipal.subject) },
    )
    expect(principalDenied?.status).toBe(403)

    const tenantDenied = await handleAppSettingsApiRequest(
      request('PATCH', inactiveTenant, { business_name: 'blocked tenant' }),
      { DB: db } as never,
      { getSession: sessionFor(activePrincipal.subject) },
    )
    expect(tenantDenied?.status).toBe(403)
  })
})
