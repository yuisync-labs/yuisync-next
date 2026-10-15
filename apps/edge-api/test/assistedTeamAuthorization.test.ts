import { env } from 'cloudflare:workers'
import { afterEach, expect, it } from 'vitest'
import { handleAppApiRequest } from '../src/appApi'

const DB = (env as EdgeEnv & { DB: D1Database }).DB
let tenantId = '', principalId = '', subject = '', otherTenantId = ''
const initialSettings = {
  petshop_operational_staff: [
    { key: 'esteticista-1', name: 'Thaiane', active: true },
    { key: 'esteticista-2', name: 'Estefanea', active: true },
    { key: 'esteticista-3', name: 'Neto', active: true },
  ],
  message_templates: { __petshop_commission_reset_at: '2026-07-31T12:52:26.793Z' },
  printing: { width: '80' },
}

async function seed() {
  const suffix = crypto.randomUUID()
  tenantId = `team-auth-${suffix}`
  principalId = `team-principal-${suffix}`
  subject = `team-user-${suffix}`
  otherTenantId = `other-team-${suffix}`
  const now = Date.now()
  await DB.batch([
    ...[tenantId, otherTenantId].map(id => DB.prepare(`INSERT INTO tenants(id,slug,name,status,created_at_ms,updated_at_ms)
      VALUES(?1,?1,'Team authorization','active',?2,?2)`).bind(id, now)),
    DB.prepare(`INSERT INTO identity_principals(id,provider,subject,status,created_at_ms,updated_at_ms)
      VALUES(?1,'better-auth',?2,'active',?3,?3)`).bind(principalId, subject, now),
    DB.prepare(`INSERT INTO tenant_memberships(tenant_id,principal_id,role,status,module_permissions_json,created_at_ms,updated_at_ms)
      VALUES(?1,?2,'manager','active',?3,?4,?4)`).bind(tenantId, principalId, JSON.stringify({ petshop: { role: 'admin_pet' } }), now),
    DB.prepare(`INSERT INTO module_settings_extensions(tenant_id,module_id,data_json,updated_at_ms)
      VALUES(?1,'petshop',?2,?3)`).bind(tenantId, JSON.stringify(initialSettings), now),
  ])
}

async function request(active?: boolean, targetTenant = tenantId) {
  return handleAppApiRequest(new Request(`https://edge.test/api/app/onboarding?tenant_id=${targetTenant}`, active === undefined ? {} : {
    method: 'PATCH', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ step: 'team', staff: [{ key: 'esteticista-3', name: 'Neto', active }] }),
  }), { DB }, { getSession: async () => ({ user: { id: subject } } as never) })
}

afterEach(async () => {
  if (!tenantId) return
  await DB.batch([
    DB.prepare('DELETE FROM module_settings_extensions WHERE tenant_id=?1').bind(tenantId),
    DB.prepare('DELETE FROM tenant_memberships WHERE tenant_id=?1').bind(tenantId),
    DB.prepare('DELETE FROM identity_principals WHERE id=?1').bind(principalId),
    DB.prepare('DELETE FROM tenants WHERE id IN (?1,?2)').bind(tenantId, otherTenantId),
  ])
  tenantId = ''
})

it('permite ao gerente admin_pet desativar e reativar Neto sem mudar identidades ou comissoes', async () => {
  await seed()
  for (const active of [false, true, false]) {
    const response = await request(active)
    expect(response?.status).toBe(200)
    const read = await request()
    expect(read?.status).toBe(200)
    const snapshot = await read!.json<{ team: unknown[] }>()
    expect(snapshot.team).toEqual([
      ...initialSettings.petshop_operational_staff.slice(0, 2),
      { key: 'esteticista-3', name: 'Neto', active },
    ])
  }
  const persisted = await DB.prepare("SELECT data_json FROM module_settings_extensions WHERE tenant_id=?1 AND module_id='petshop'")
    .bind(tenantId).first<{ data_json: string }>()
  const settings = JSON.parse(persisted!.data_json)
  expect(settings.printing).toEqual(initialSettings.printing)
  expect(settings.message_templates.__petshop_commission_reset_at).toBe(initialSettings.message_templates.__petshop_commission_reset_at)
  expect(settings.petshop_operational_staff[2].active).toBe(false)
  expect(settings.message_templates.__petshop_operational_staff).toEqual(settings.petshop_operational_staff)
})

it('nega alteracoes por outro tenant, funcionarios e permissoes genericas', async () => {
  await seed()
  expect((await request(false, otherTenantId))?.status).toBe(403)
  for (const permissions of [{}, { petshop: { role: 'funcionario_pet' } }, { petshop: true }, { '*': { role: 'admin_pet' } }, { outro: { role: 'admin_pet' } }]) {
    await DB.prepare('UPDATE tenant_memberships SET module_permissions_json=?2 WHERE tenant_id=?1')
      .bind(tenantId, JSON.stringify(permissions)).run()
    expect((await request(false))?.status).toBe(403)
  }
  await DB.prepare("UPDATE tenant_memberships SET module_permissions_json=?2,status='inactive' WHERE tenant_id=?1")
    .bind(tenantId, JSON.stringify({ petshop: { role: 'admin_pet' } })).run()
  expect((await request(false))?.status).toBe(403)
  const persisted = await DB.prepare("SELECT data_json FROM module_settings_extensions WHERE tenant_id=?1 AND module_id='petshop'")
    .bind(tenantId).first<{ data_json: string }>()
  expect(JSON.parse(persisted!.data_json)).toEqual(initialSettings)
})
