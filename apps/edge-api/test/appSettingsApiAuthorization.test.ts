import { env } from 'cloudflare:workers'
import { afterEach, describe, expect, it } from 'vitest'

import { handleAppSettingsApiRequest } from '../src/appSettingsApi'

const db = (env as EdgeEnv & { DB: D1Database }).DB
const createdTenants = new Set<string>()
const createdPrincipals = new Set<string>()

function sessionFor(subject: string) {
  return async () => ({ user: { id: subject } } as never)
}

async function seedPrincipal(prefix: string) {
  const suffix = crypto.randomUUID()
  const principalId = `${prefix}-principal-${suffix}`
  const subject = `${prefix}-subject-${suffix}`
  const now = Date.now()
  await db.prepare(`
    INSERT INTO identity_principals(id,provider,subject,status,created_at_ms,updated_at_ms)
    VALUES(?1,'better-auth',?2,'active',?3,?3)
  `).bind(principalId, subject, now).run()
  createdPrincipals.add(principalId)
  return { principalId, subject }
}

async function seedTenant(prefix: string, status: 'active' | 'inactive' = 'active') {
  const suffix = crypto.randomUUID()
  const tenantId = `${prefix}-${suffix}`
  const now = Date.now()
  await db.prepare(`
    INSERT INTO tenants(id,slug,name,status,created_at_ms,updated_at_ms)
    VALUES(?1,?2,?3,?4,?5,?5)
  `).bind(tenantId, `${prefix}-${suffix}`.toLowerCase(), `${prefix} test`, status, now).run()
  await db.prepare(`
    INSERT INTO tenant_module_settings(
      tenant_id,module_id,store_name,store_phone,store_address,store_neighborhood,store_city,
      bot_prompt,version,created_at_ms,updated_at_ms
    ) VALUES(?1,'petshop',?2,'','','','','',1,?3,?3)
  `).bind(tenantId, `${prefix} business`, now).run()
  createdTenants.add(tenantId)
  return tenantId
}

async function addMembership(
  tenantId: string,
  principalId: string,
  role: 'owner' | 'admin' | 'manager' | 'staff' | 'member',
  permissions: Record<string, unknown> = {},
  status: 'active' | 'inactive' = 'active',
) {
  const now = Date.now()
  await db.prepare(`
    INSERT INTO tenant_memberships(
      tenant_id,principal_id,status,created_at_ms,updated_at_ms,role,module_permissions_json
    ) VALUES(?1,?2,?3,?4,?4,?5,?6)
  `).bind(tenantId, principalId, status, now, role, JSON.stringify(permissions)).run()
}

function settingsRequest(
  method: 'GET' | 'PATCH',
  tenantId: string,
  body?: Record<string, unknown>,
) {
  return new Request(`https://edge.test/api/app/settings?tenant_id=${encodeURIComponent(tenantId)}&module_id=petshop`, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
}

afterEach(async () => {
  for (const tenantId of createdTenants) {
    await db.prepare('DELETE FROM module_settings_extensions WHERE tenant_id=?1').bind(tenantId).run()
    await db.prepare('DELETE FROM tenant_module_settings WHERE tenant_id=?1').bind(tenantId).run()
    await db.prepare('DELETE FROM tenant_memberships WHERE tenant_id=?1').bind(tenantId).run()
    await db.prepare('DELETE FROM tenants WHERE id=?1').bind(tenantId).run()
  }
  for (const principalId of createdPrincipals) {
    await db.prepare('DELETE FROM tenant_memberships WHERE principal_id=?1').bind(principalId).run()
    await db.prepare('DELETE FROM identity_principals WHERE id=?1').bind(principalId).run()
  }
  createdTenants.clear()
  createdPrincipals.clear()
})

describe('app settings tenant authorization', () => {
  it.each(['owner', 'admin'] as const)('%s can patch the native company and receipt fields for its own tenant', async (role) => {
    const principal = await seedPrincipal(`settings-${role}`)
    const tenantId = await seedTenant(`settings-${role}`)
    await addMembership(tenantId, principal.principalId, role)

    const response = await handleAppSettingsApiRequest(
      settingsRequest('PATCH', tenantId, {
        business_name: `${role} business`,
        business_address: 'Rua Um, 10',
        business_phone: '3232323232',
        business_email: `${role}@example.test`,
        business_tax_id: '12.345.678/0001-90',
        logo_url: '/brand/tenant-logo.png',
        receipt_format: 'a4',
        receipt_footer: 'Obrigado pela preferencia.',
      }),
      { DB: db } as never,
      { getSession: sessionFor(principal.subject) },
    )

    expect(response?.status).toBe(200)
    const payload = await response!.json() as { settings: Record<string, unknown> }
    expect(payload.settings).toMatchObject({
      business_name: `${role} business`,
      business_address: 'Rua Um, 10',
      business_phone: '3232323232',
      business_email: `${role}@example.test`,
      business_tax_id: '12.345.678/0001-90',
      logo_url: '/brand/tenant-logo.png',
      receipt_format: 'a4',
      receipt_footer: 'Obrigado pela preferencia.',
    })

    const canonical = await db.prepare(`
      SELECT store_name,store_address,store_phone
      FROM tenant_module_settings WHERE tenant_id=?1 AND module_id='petshop'
    `).bind(tenantId).first<{ store_name: string; store_address: string; store_phone: string }>()
    expect(canonical).toEqual({
      store_name: `${role} business`,
      store_address: 'Rua Um, 10',
      store_phone: '3232323232',
    })

    const extension = await db.prepare(`
      SELECT data_json FROM module_settings_extensions
      WHERE tenant_id=?1 AND module_id='petshop'
    `).bind(tenantId).first<{ data_json: string }>()
    expect(JSON.parse(extension?.data_json || '{}')).toMatchObject({
      business_email: `${role}@example.test`,
      business_tax_id: '12.345.678/0001-90',
      logo_url: '/brand/tenant-logo.png',
      receipt_format: 'a4',
      receipt_footer: 'Obrigado pela preferencia.',
    })
  })

  it('lets a module member read but not patch tenant settings', async () => {
    const principal = await seedPrincipal('settings-member')
    const tenantId = await seedTenant('settings-member')
    await addMembership(tenantId, principal.principalId, 'member', { petshop: true })

    const read = await handleAppSettingsApiRequest(
      settingsRequest('GET', tenantId),
      { DB: db } as never,
      { getSession: sessionFor(principal.subject) },
    )
    expect(read?.status).toBe(200)

    const write = await handleAppSettingsApiRequest(
      settingsRequest('PATCH', tenantId, { business_name: 'Nao permitido' }),
      { DB: db } as never,
      { getSession: sessionFor(principal.subject) },
    )
    expect(write?.status).toBe(403)
    await expect(write!.json()).resolves.toMatchObject({ code: 'FORBIDDEN' })
  })

  it('does not allow a principal from tenant A to read or mutate tenant B', async () => {
    const principalA = await seedPrincipal('settings-a')
    const principalB = await seedPrincipal('settings-b')
    const tenantA = await seedTenant('settings-a')
    const tenantB = await seedTenant('settings-b')
    await addMembership(tenantA, principalA.principalId, 'owner')
    await addMembership(tenantB, principalB.principalId, 'owner')

    for (const method of ['GET', 'PATCH'] as const) {
      const response = await handleAppSettingsApiRequest(
        settingsRequest(method, tenantB, method === 'PATCH' ? { business_name: 'Tenant A tentou alterar' } : undefined),
        { DB: db } as never,
        { getSession: sessionFor(principalA.subject) },
      )
      expect(response?.status).toBe(403)
      await expect(response!.json()).resolves.toMatchObject({ code: 'FORBIDDEN' })
    }

    const unchanged = await db.prepare(`
      SELECT store_name FROM tenant_module_settings
      WHERE tenant_id=?1 AND module_id='petshop'
    `).bind(tenantB).first<{ store_name: string }>()
    expect(unchanged?.store_name).toBe('settings-b business')
  })

  it('keeps two tenants with distinct receipt identities for the same authorized principal', async () => {
    const principal = await seedPrincipal('settings-multi')
    const tenantA = await seedTenant('settings-multi-a')
    const tenantB = await seedTenant('settings-multi-b')
    await addMembership(tenantA, principal.principalId, 'owner')
    await addMembership(tenantB, principal.principalId, 'owner')

    const patchA = await handleAppSettingsApiRequest(
      settingsRequest('PATCH', tenantA, { business_name: 'Empresa A', logo_url: '/a.png', receipt_format: '58' }),
      { DB: db } as never,
      { getSession: sessionFor(principal.subject) },
    )
    const patchB = await handleAppSettingsApiRequest(
      settingsRequest('PATCH', tenantB, { business_name: 'Empresa B', logo_url: '/b.png', receipt_format: 'a4' }),
      { DB: db } as never,
      { getSession: sessionFor(principal.subject) },
    )
    expect(patchA?.status).toBe(200)
    expect(patchB?.status).toBe(200)

    const readA = await handleAppSettingsApiRequest(settingsRequest('GET', tenantA), { DB: db } as never, { getSession: sessionFor(principal.subject) })
    const readB = await handleAppSettingsApiRequest(settingsRequest('GET', tenantB), { DB: db } as never, { getSession: sessionFor(principal.subject) })
    const payloadA = await readA!.json() as { settings: Record<string, unknown> }
    const payloadB = await readB!.json() as { settings: Record<string, unknown> }

    expect(payloadA.settings).toMatchObject({ business_name: 'Empresa A', logo_url: '/a.png', receipt_format: '58' })
    expect(payloadB.settings).toMatchObject({ business_name: 'Empresa B', logo_url: '/b.png', receipt_format: 'a4' })
    expect(payloadA.settings).not.toEqual(payloadB.settings)
  })

  it('rejects inactive tenant access even when the membership role is owner', async () => {
    const principal = await seedPrincipal('settings-inactive')
    const tenantId = await seedTenant('settings-inactive', 'inactive')
    await addMembership(tenantId, principal.principalId, 'owner')

    const response = await handleAppSettingsApiRequest(
      settingsRequest('GET', tenantId),
      { DB: db } as never,
      { getSession: sessionFor(principal.subject) },
    )
    expect(response?.status).toBe(403)
  })

  it('rejects fields outside the native company/receipt contract without mutating settings', async () => {
    const principal = await seedPrincipal('settings-contract')
    const tenantId = await seedTenant('settings-contract')
    await addMembership(tenantId, principal.principalId, 'owner')

    const response = await handleAppSettingsApiRequest(
      settingsRequest('PATCH', tenantId, { max_pdv_discount_percent: 99 }),
      { DB: db } as never,
      { getSession: sessionFor(principal.subject) },
    )
    expect(response?.status).toBe(400)
    await expect(response!.json()).resolves.toMatchObject({
      code: 'UNSUPPORTED_SETTING_FIELD',
      field: 'max_pdv_discount_percent',
    })

    const row = await db.prepare(`
      SELECT store_name FROM tenant_module_settings
      WHERE tenant_id=?1 AND module_id='petshop'
    `).bind(tenantId).first<{ store_name: string }>()
    expect(row?.store_name).toBe('settings-contract business')
  })
})
