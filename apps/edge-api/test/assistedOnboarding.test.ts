import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'

import { handleAppApiRequest } from '../src/appApi'
import type { getBetterAuthSession } from '../src/auth/betterAuthRuntime'

const hours = {
  '1': [{ open: '08:00', close: '18:00' }],
  '2': [{ open: '08:00', close: '18:00' }],
  '3': [{ open: '08:00', close: '18:00' }],
  '4': [{ open: '08:00', close: '18:00' }],
  '5': [{ open: '08:00', close: '18:00' }],
  '6': [{ open: '08:00', close: '13:00' }],
  '7': [],
}

describe('assisted onboarding state', () => {
  it('resumes from persisted state, preserves extensions and replays team/schedule without duplication', async () => {
    const DB = (env as EdgeEnv & { DB: D1Database }).DB
    const now = Date.now()
    const suffix = crypto.randomUUID().slice(0, 8)
    const parentId = `assist-parent-${suffix}`
    const principalId = `assist-principal-${suffix}`
    const subject = `assist-user-${suffix}`
    const getSession: typeof getBetterAuthSession = async () => ({
      user: { id: subject, email: `${subject}@test.invalid`, name: 'Operador', emailVerified: true, createdAt: new Date(), updatedAt: new Date() },
      session: { id: `session-${suffix}`, userId: subject, token: 'test-only', expiresAt: new Date(now + 60000), createdAt: new Date(), updatedAt: new Date() },
    })

    await DB.batch([
      DB.prepare('INSERT INTO tenants(id,slug,name,status,created_at_ms,updated_at_ms) VALUES(?1,?2,?3,\'active\',?4,?4)').bind(parentId, parentId, 'Operadora', now),
      DB.prepare('INSERT INTO identity_principals(id,provider,subject,display_name,email,status,created_at_ms,updated_at_ms) VALUES(?1,\'better-auth\',?2,\'Operador\',?3,\'active\',?4,?4)').bind(principalId, subject, `${subject}@test.invalid`, now),
      DB.prepare('INSERT INTO tenant_memberships(tenant_id,principal_id,role,status,module_permissions_json,created_at_ms,updated_at_ms) VALUES(?1,?2,\'admin\',\'active\',\'{"petshop":{"role":"admin_pet"}}\',?3,?3)').bind(parentId, principalId, now),
    ])

    const createRequest = new Request('https://edge.test/api/app/tenants', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': `assist-operation-${suffix}` },
      body: JSON.stringify({ name: `Empresa Assistida ${suffix}` }),
    })
    const createdResponse = await handleAppApiRequest(createRequest, { DB }, { getSession })
    expect(createdResponse?.status).toBe(201)
    const created = await createdResponse!.json<{ id: string }>()
    const onboardingUrl = `https://edge.test/api/app/onboarding?tenant_id=${encodeURIComponent(created.id)}`

    const initialResponse = await handleAppApiRequest(new Request(onboardingUrl), { DB }, { getSession })
    expect(initialResponse?.status).toBe(200)
    expect(await initialResponse!.json()).toMatchObject({
      steps: { company: true, administrator: false, team: false, catalog: false, schedule: false },
      review_ready: false,
      safeguards: {
        saas_subscription_created_automatically: false,
        whatsapp_functional: false,
        whatsapp_status: 'not_verified_by_assisted_onboarding',
      },
    })

    const extension = await DB.prepare("SELECT data_json FROM module_settings_extensions WHERE tenant_id=?1 AND module_id='petshop'")
      .bind(created.id).first<{ data_json: string }>()
    const seeded = { ...JSON.parse(extension!.data_json), keep_me: { untouched: true } }
    await DB.prepare("UPDATE module_settings_extensions SET data_json=?2 WHERE tenant_id=?1 AND module_id='petshop'")
      .bind(created.id, JSON.stringify(seeded)).run()

    const teamPayload = {
      step: 'team',
      staff: [{ key: 'ana', name: 'Ana Souza', active: true }, { key: 'bruno', name: 'Bruno Lima', active: true }],
      commission_reset_at: '2026-09-07T18:00:00.000Z',
    }
    for (let replay = 0; replay < 2; replay += 1) {
      const response = await handleAppApiRequest(new Request(onboardingUrl, {
        method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(teamPayload),
      }), { DB }, { getSession })
      expect(response?.status).toBe(200)
      expect((await response!.json<{ team: unknown[] }>()).team).toHaveLength(2)
    }

    const schedulePayload = {
      step: 'schedule',
      business_hours: hours,
      slot_interval_min: 30,
      booking_lead_time_min: 15,
      booking_capacity: 2,
    }
    for (let replay = 0; replay < 2; replay += 1) {
      const response = await handleAppApiRequest(new Request(onboardingUrl, {
        method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(schedulePayload),
      }), { DB }, { getSession })
      expect(response?.status).toBe(200)
    }

    const clientAdminId = `assist-client-admin-${suffix}`
    await DB.batch([
      DB.prepare('INSERT INTO identity_principals(id,provider,subject,display_name,email,status,created_at_ms,updated_at_ms) VALUES(?1,\'better-auth\',?2,\'Administrador Cliente\',?3,\'active\',?4,?4)')
        .bind(clientAdminId, `assist-client-subject-${suffix}`, `cliente-${suffix}@test.invalid`, now),
      DB.prepare('INSERT INTO tenant_memberships(tenant_id,principal_id,role,status,module_permissions_json,created_at_ms,updated_at_ms) VALUES(?1,?2,\'admin\',\'active\',\'{"petshop":{"role":"admin_pet"}}\',?3,?3)')
        .bind(created.id, clientAdminId, now),
      DB.prepare(`INSERT INTO services(
        tenant_id,module_id,id,code,name,group_type,default_price_cents,default_duration_min,
        commission_type,commission_basis_points,sort_order,status,created_at_ms,updated_at_ms
      ) VALUES(?1,'petshop',?2,?3,?4,'banho_tosa',5000,60,'percentage',0,1,'active',?5,?5)`)
        .bind(created.id, `assist-service-${suffix}`, `banho-${suffix}`, 'Banho', now),
    ])

    const finalResponse = await handleAppApiRequest(new Request(onboardingUrl), { DB }, { getSession })
    expect(finalResponse?.status).toBe(200)
    expect(await finalResponse!.json()).toMatchObject({
      steps: { company: true, administrator: true, team: true, catalog: true, schedule: true },
      review_ready: true,
      catalog: { active_service_count: 1 },
    })

    const persisted = await DB.prepare("SELECT data_json FROM module_settings_extensions WHERE tenant_id=?1 AND module_id='petshop'")
      .bind(created.id).first<{ data_json: string }>()
    const parsed = JSON.parse(persisted!.data_json)
    expect(parsed.keep_me).toEqual({ untouched: true })
    expect(parsed.petshop_operational_staff).toHaveLength(2)
    expect(parsed.message_templates.__petshop_operational_staff).toHaveLength(2)
    expect(parsed.message_templates.__petshop_commission_reset_at).toBe('2026-09-07T18:00:00.000Z')
    expect(parsed.store_business_hours).toEqual(hours)

    await DB.prepare("UPDATE tenant_memberships SET role='member',module_permissions_json='{}' WHERE tenant_id=?1 AND principal_id=?2")
      .bind(created.id, principalId).run()
    const forbidden = await handleAppApiRequest(new Request(onboardingUrl), { DB }, { getSession })
    expect(forbidden?.status).toBe(403)
  })
})
