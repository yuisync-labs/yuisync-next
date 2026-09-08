import { env } from 'cloudflare:workers'
import { afterEach, describe, expect, it } from 'vitest'

import { handleAppSettingsApiRequest } from '../src/appSettingsApi'
import { handleAssistedOnboardingApiRequest } from '../src/assistedOnboardingApi'

const db = (env as EdgeEnv & { DB: D1Database }).DB
const created = { tenantId: '', principalId: '', subject: '' }
const businessHours = {
  '1': [{ open: '08:00', close: '18:00' }],
  '2': [{ open: '08:00', close: '18:00' }],
  '3': [{ open: '08:00', close: '18:00' }],
  '4': [{ open: '08:00', close: '18:00' }],
  '5': [{ open: '08:00', close: '18:00' }],
  '6': [],
  '7': [],
}

function session() {
  return async () => ({ user: { id: created.subject } } as never)
}

async function seed() {
  const suffix = crypto.randomUUID()
  const now = Date.now()
  created.tenantId = `settings-concurrency-${suffix}`
  created.principalId = `settings-concurrency-principal-${suffix}`
  created.subject = `settings-concurrency-subject-${suffix}`
  await db.batch([
    db.prepare(`INSERT INTO tenants(id,slug,name,status,created_at_ms,updated_at_ms)
      VALUES(?1,?2,'Concurrency','active',?3,?3)`)
      .bind(created.tenantId, created.tenantId, now),
    db.prepare(`INSERT INTO identity_principals(id,provider,subject,status,created_at_ms,updated_at_ms)
      VALUES(?1,'better-auth',?2,'active',?3,?3)`)
      .bind(created.principalId, created.subject, now),
    db.prepare(`INSERT INTO tenant_memberships(tenant_id,principal_id,status,created_at_ms,updated_at_ms,role,module_permissions_json)
      VALUES(?1,?2,'active',?3,?3,'owner','{}')`)
      .bind(created.tenantId, created.principalId, now),
    db.prepare(`INSERT INTO tenant_module_settings(
      tenant_id,module_id,store_name,store_phone,store_address,store_neighborhood,store_city,bot_prompt,version,created_at_ms,updated_at_ms
    ) VALUES(?1,'petshop','Concurrency','','','','','',1,?2,?2)`)
      .bind(created.tenantId, now),
    db.prepare(`INSERT INTO module_settings_extensions(tenant_id,module_id,data_json,updated_at_ms)
      VALUES(?1,'petshop',?2,?3)`)
      .bind(created.tenantId, JSON.stringify({ keep_me: { untouched: true }, receipt_footer: 'initial' }), now),
  ])
}

function settingsPatch(body: Record<string, unknown>) {
  return handleAppSettingsApiRequest(new Request(
    `https://edge.test/api/app/settings?tenant_id=${encodeURIComponent(created.tenantId)}&module_id=petshop`,
    { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) },
  ), { DB: db } as never, { getSession: session() })
}

function onboardingPatch(body: Record<string, unknown>) {
  return handleAssistedOnboardingApiRequest(new Request(
    `https://edge.test/api/app/onboarding?tenant_id=${encodeURIComponent(created.tenantId)}`,
    { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) },
  ), { DB: db } as never, { getSession: session() })
}

async function extensions() {
  const row = await db.prepare(`SELECT data_json FROM module_settings_extensions
    WHERE tenant_id=?1 AND module_id='petshop'`).bind(created.tenantId).first<{ data_json: string }>()
  return JSON.parse(row?.data_json || '{}') as Record<string, unknown>
}

afterEach(async () => {
  if (!created.tenantId) return
  await db.prepare('DELETE FROM module_settings_extensions WHERE tenant_id=?1').bind(created.tenantId).run()
  await db.prepare('DELETE FROM tenant_module_settings WHERE tenant_id=?1').bind(created.tenantId).run()
  await db.prepare('DELETE FROM tenant_memberships WHERE tenant_id=?1').bind(created.tenantId).run()
  await db.prepare('DELETE FROM identity_principals WHERE id=?1').bind(created.principalId).run()
  await db.prepare('DELETE FROM tenants WHERE id=?1').bind(created.tenantId).run()
  created.tenantId = ''
  created.principalId = ''
  created.subject = ''
})

describe('shared settings writers', () => {
  it('preserves logo and hours written concurrently', async () => {
    await seed()
    const [logo, schedule] = await Promise.all([
      settingsPatch({ logo_url: '/brand/concurrent.png' }),
      onboardingPatch({
        step: 'schedule',
        business_hours: businessHours,
        slot_interval_min: 30,
        booking_lead_time_min: 15,
        booking_capacity: 2,
      }),
    ])
    expect(logo?.status).toBe(200)
    expect(schedule?.status).toBe(200)

    const stored = await extensions()
    expect(stored.logo_url).toBe('/brand/concurrent.png')
    expect(stored.store_business_hours).toEqual(businessHours)
    expect(stored.keep_me).toEqual({ untouched: true })
  })

  it('preserves phone and address written concurrently', async () => {
    await seed()
    const [phone, address] = await Promise.all([
      settingsPatch({ business_phone: '32 99999-1111' }),
      settingsPatch({ business_address: 'Rua Concorrente, 42' }),
    ])
    expect(phone?.status).toBe(200)
    expect(address?.status).toBe(200)

    const row = await db.prepare(`SELECT store_phone,store_address,version FROM tenant_module_settings
      WHERE tenant_id=?1 AND module_id='petshop'`).bind(created.tenantId).first<{
        store_phone: string; store_address: string; version: number
      }>()
    expect(row).toEqual({ store_phone: '32 99999-1111', store_address: 'Rua Concorrente, 42', version: 3 })
  })

  it('preserves team and printing settings written concurrently', async () => {
    await seed()
    const [team, printing] = await Promise.all([
      onboardingPatch({
        step: 'team',
        staff: [{ key: 'staff-concurrent-1', name: 'Pessoa Concorrente', active: true }],
      }),
      settingsPatch({ receipt_format: '58', receipt_footer: 'Impressao concorrente' }),
    ])
    expect(team?.status).toBe(200)
    expect(printing?.status).toBe(200)

    const stored = await extensions()
    expect(stored.petshop_operational_staff).toEqual([
      { key: 'staff-concurrent-1', name: 'Pessoa Concorrente', active: true },
    ])
    expect(stored.receipt_format).toBe('58')
    expect(stored.receipt_footer).toBe('Impressao concorrente')
    expect(stored.keep_me).toEqual({ untouched: true })
  })

  it('defines same-field contention as serialized last-writer-wins with both writes accounted for', async () => {
    await seed()
    const [first, second] = await Promise.all([
      settingsPatch({ business_phone: '1111' }),
      settingsPatch({ business_phone: '2222' }),
    ])
    expect(first?.status).toBe(200)
    expect(second?.status).toBe(200)

    const row = await db.prepare(`SELECT store_phone,version FROM tenant_module_settings
      WHERE tenant_id=?1 AND module_id='petshop'`).bind(created.tenantId).first<{ store_phone: string; version: number }>()
    expect(['1111', '2222']).toContain(row?.store_phone)
    expect(row?.version).toBe(3)
  })
})
