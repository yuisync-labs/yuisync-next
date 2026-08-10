import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'

import { handleDeferredCompatApiRequest } from '../src/compatDeferredApi'
import type { CompatRuntimeBindings } from '../src/compatApiRuntime.js'

const testEnv = env as CompatRuntimeBindings & { DB: D1Database }
const now = Date.now()

async function seedTenant(id: string) {
  await testEnv.DB
    .prepare(`INSERT INTO tenants(id,slug,name,status,created_at_ms,updated_at_ms) VALUES(?,?,?,'active',?,?)`)
    .bind(id, id, id, now, now)
    .run()
}

async function rpc(name: string, args: Record<string, unknown>) {
  const result = await handleDeferredCompatApiRequest(
    new Request('https://edge.test/api/compat/rpc', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, args }),
    }),
    testEnv,
  )
  if (!result) throw new Error(`RPC ${name} was not handled`)
  return result
}

describe('deferred public compatibility RPCs', () => {
  it('creates a public booking and derives MotoDog fee on the server', async () => {
    const tenantId = 'tenant-public-booking'
    await seedTenant(tenantId)
    await testEnv.DB
      .prepare(`INSERT INTO petshop_growth_booking_settings(tenant_id,module_id,enabled,public_slug,allow_whatsapp_fallback,lead_expiration_hours,updated_at_ms) VALUES(?,'petshop',1,'quatro-patas-public',1,6,?)`)
      .bind(tenantId, now)
      .run()
    await testEnv.DB
      .prepare(`INSERT INTO transport_options(tenant_id,module_id,id,label,fee_cents,max_weight_grams,pickup_required,dropoff_required,outside_city,status,sort_order) VALUES(?,'petshop','buscar_e_levar','Buscar e levar',2300,10000,1,1,0,'active',1)`)
      .bind(tenantId)
      .run()

    const response = await rpc('create_petshop_booking_request', {
      p_slug: 'quatro-patas-public',
      p_customer_name: 'Cliente Publico',
      p_pet_name: 'Thor',
      p_phone: '32999999999',
      p_service_interest: 'Banho',
      p_preferred_date: '2026-08-10',
      p_preferred_period: '14:00',
      p_transport_mode: 'roundtrip',
      p_need_motodog: true,
      p_pickup_address: 'Rua Teste, 10',
      p_pickup_neighborhood: 'Centro',
      p_pickup_city: 'Muriae',
      p_channel: 'site',
    })
    const body = await response.json<{ data: string }>()

    expect(response.status).toBe(200)
    expect(body.data).toMatch(/^[0-9a-f-]{36}$/)

    const row = await testEnv.DB
      .prepare(`SELECT customer_name,pet_name,need_motodog,motodog_fee_cents,status FROM petshop_growth_booking_requests WHERE tenant_id=?1 AND module_id='petshop' AND id=?2`)
      .bind(tenantId, body.data)
      .first<Record<string, unknown>>()
    expect(row).toEqual(expect.objectContaining({
      customer_name: 'Cliente Publico',
      pet_name: 'Thor',
      need_motodog: 1,
      motodog_fee_cents: 2300,
      status: 'pending',
    }))
  })

  it('rejects an unknown portal token without leaking tenant data', async () => {
    const response = await rpc('get_petshop_portal_snapshot', { p_token: 'unknown-token' })
    const body = await response.json<{ code: string }>()

    expect(response.status).toBe(404)
    expect(body.code).toBe('PORTAL_NOT_FOUND')
  })

  it('returns the expected public portal snapshot for a valid token', async () => {
    const tenantId = 'tenant-public-portal'
    await seedTenant(tenantId)
    await testEnv.DB
      .prepare(`INSERT INTO clients(tenant_id,module_id,id,name,phone,email,status,created_at_ms,updated_at_ms) VALUES(?,'petshop','client','Gabriel','32988887777','portal@example.test','active',?,?)`)
      .bind(tenantId, now, now)
      .run()
    await testEnv.DB
      .prepare(`INSERT INTO pets(tenant_id,module_id,id,client_id,name,species,status,created_at_ms,updated_at_ms) VALUES(?,'petshop','pet','client','Thor','dog','active',?,?)`)
      .bind(tenantId, now, now)
      .run()
    await testEnv.DB
      .prepare(`INSERT INTO services(tenant_id,module_id,id,code,name,group_type,default_price_cents,default_duration_min,commission_type,commission_basis_points,status,created_at_ms,updated_at_ms) VALUES(?,'petshop','service','banho','Banho','banho_tosa',5500,60,'percentage',0,'active',?,?)`)
      .bind(tenantId, now, now)
      .run()

    const appointmentAt = Date.now() + 86_400_000
    await testEnv.DB
      .prepare(`INSERT INTO appointments(tenant_id,module_id,id,client_id,pet_id,scheduled_at_ms,duration_min,status,source,subtotal_cents,transport_fee_cents,version,created_at_ms,updated_at_ms) VALUES(?,'petshop','appt','client','pet',?,60,'scheduled','manual',5500,0,1,?,?)`)
      .bind(tenantId, appointmentAt, now, now)
      .run()
    await testEnv.DB
      .prepare(`INSERT INTO appointment_services(tenant_id,module_id,appointment_id,position,service_id,service_code,service_name,service_group,unit_price_cents,duration_min,benefit_used) VALUES(?,'petshop','appt',0,'service','banho','Banho','banho_tosa',5500,60,0)`)
      .bind(tenantId)
      .run()
    await testEnv.DB
      .prepare(`INSERT INTO loyalty_points(tenant_id,module_id,id,client_id,points_delta,balance_after,reason,created_at_ms) VALUES(?,'petshop','points','client',40,40,'fixture',?)`)
      .bind(tenantId, now)
      .run()
    await testEnv.DB
      .prepare(`INSERT INTO petshop_growth_portal_access(id,tenant_id,module_id,client_id,portal_token,status,created_at,updated_at) VALUES('portal-access',?,'petshop','client','valid-portal-token','active',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`)
      .bind(tenantId)
      .run()

    const response = await rpc('get_petshop_portal_snapshot', { p_token: 'valid-portal-token' })
    const body = await response.json<{ data: Record<string, any> }>()

    expect(response.status).toBe(200)
    expect(body.data).toMatchObject({
      tenant_id: tenantId,
      module_id: 'petshop',
      client_id: 'client',
      owner_name: 'Gabriel',
      pet_name: 'Thor',
      phone: '32988887777',
      email: 'portal@example.test',
      loyalty_balance: 40,
    })
    expect(body.data.next_appointments).toEqual([
      expect.objectContaining({ service_type: 'Banho', status: 'scheduled' }),
    ])

    const access = await testEnv.DB
      .prepare(`SELECT last_access_at FROM petshop_growth_portal_access WHERE id='portal-access'`)
      .first<{ last_access_at: string | null }>()
    expect(access?.last_access_at).toBeTruthy()
  })
})
