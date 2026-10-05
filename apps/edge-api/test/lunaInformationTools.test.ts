import { env } from 'cloudflare:workers'
import { beforeAll, describe, expect, it } from 'vitest'
import { createLunaToolRegistry } from '../src/luna/toolRegistry'
import { buildVerifiedFacts } from '../src/luna/factualResponse'

const db = (env as EdgeEnv & { DB: D1Database }).DB
const ctx = { tenantId: 'luna-information-fixture', moduleId: 'petshop' as const, conversationId: 'information-thread', customerAddress: '5532999990092', phoneNumberId: 'fixture', sourceMessageId: 'information-inbound', traceId: 'information-trace', executionMode: 'fixture' as const }
const hours = Object.fromEntries(Array.from({ length: 7 }, (_, i) => [String(i + 1), i < 5 ? [{ open: '08:00', close: '18:00' }] : []]))
const settings = { petbot_timezone: 'America/Sao_Paulo', store_business_hours: hours, petbot_business_hours: hours, petbot_booking_capacity: 1, petbot_slot_interval_min: 30, delivery_coverage: [{ city: 'Cidade Teste', neighborhood: 'Centro', active: true, fee_cents: 1500 }] }
beforeAll(async () => {
  const now = Date.now()
  await db.batch([
    db.prepare(`INSERT INTO tenants(id,slug,name,status,created_at_ms,updated_at_ms) VALUES(?1,?1,'Information fixture','active',?2,?2)`).bind(ctx.tenantId, now),
    db.prepare(`INSERT INTO clients(tenant_id,module_id,id,name,phone,status,created_at_ms,updated_at_ms) VALUES(?1,'petshop','customer','Cliente teste',?2,'active',?3,?3)`).bind(ctx.tenantId, ctx.customerAddress, now),
    db.prepare(`INSERT INTO pets(tenant_id,module_id,id,client_id,name,species,weight_kg,status,created_at_ms,updated_at_ms) VALUES(?1,'petshop','pet','customer','Mel','dog',5,'active',?2,?2)`).bind(ctx.tenantId, now),
    db.prepare(`INSERT INTO tenant_module_settings(tenant_id,module_id,store_name,store_city,created_at_ms,updated_at_ms) VALUES(?1,'petshop','Loja teste','Cidade Teste',?2,?2)`).bind(ctx.tenantId, now),
    db.prepare(`INSERT INTO module_settings_extensions(tenant_id,module_id,data_json,updated_at_ms) VALUES(?1,'petshop',?2,?3)`).bind(ctx.tenantId, JSON.stringify(settings), now),
    db.prepare(`INSERT INTO transport_options(tenant_id,module_id,id,label,fee_cents,max_weight_grams,pickup_required,dropoff_required,outside_city,status,sort_order) VALUES(?1,'petshop','somente_buscar','Somente buscar',2000,10000,1,0,0,'active',1)`).bind(ctx.tenantId),
    db.prepare(`INSERT INTO services(tenant_id,module_id,id,code,name,group_type,default_price_cents,default_duration_min,status,created_at_ms,updated_at_ms) VALUES(?1,'petshop','bath','bath','Banho','banho_tosa',5500,60,'active',?2,?2)`).bind(ctx.tenantId, now),
  ])
})

describe('Luna native information tools', () => {
  it('consulta expediente configurado sem valores padrão inventados', async () => {
    const result = await createLunaToolRegistry(db).execute('get_store_information', {}, ctx)
    expect(result).toMatchObject({ ok: true, data: { store_name: 'Loja teste', phone: null, business_hours: hours } })
    expect(buildVerifiedFacts([{ callId: 'store', tool: 'get_store_information', result }]).some(f => f.text === 'domingo: fechado.')).toBe(true)
  })
  it('valida cobertura e taxa sem presumir entrega fora da área', async () => {
    const registry = createLunaToolRegistry(db)
    expect(await registry.execute('get_delivery_quote', { city: 'cidade teste', neighborhood: 'CENTRO' }, ctx)).toMatchObject({ ok: true, data: { fee_cents: 1500 } })
    expect(await registry.execute('get_delivery_quote', { city: 'Outra', neighborhood: 'Centro' }, ctx)).toMatchObject({ ok: false, code: 'DELIVERY_OUTSIDE_COVERAGE' })
    expect(await registry.execute('get_delivery_quote', { city: 'Cidade Teste', neighborhood: 'Centro', fee_cents: 0 }, ctx)).toMatchObject({ ok: false, code: 'TOOL_ARGUMENTS_INVALID' })
  })
  it('consulta MotoDog do catálogo, peso do pet e identidade do telefone', async () => {
    const registry = createLunaToolRegistry(db)
    expect(await registry.execute('get_transport_quote', { pet_id: 'pet', city: 'Cidade Teste' }, ctx)).toMatchObject({ ok: true, data: { options: [{ id: 'somente_buscar', fee_cents: 2000 }], capacity_checked: false } })
    expect(await registry.execute('get_transport_quote', { pet_id: 'pet', city: 'Cidade Teste' }, { ...ctx, customerAddress: '5532999990000' })).toMatchObject({ ok: false, code: 'CUSTOMER_SCOPE_DENIED' })
    expect(await registry.execute('get_transport_quote', { pet_id: 'pet', city: 'Outra' }, ctx)).toMatchObject({ ok: true, data: { options: [] } })
  })
  it('lista alternativas reais sem consultar cada slot ou truncar uma agenda densa silenciosamente', async () => {
    const start = new Date(Date.now() + 30 * 86400000)
    while (![1, 2, 3, 4, 5].includes(start.getUTCDay())) start.setUTCDate(start.getUTCDate() + 1)
    start.setUTCHours(11, 0, 0, 0)
    const result = await createLunaToolRegistry(db).execute('get_available_slots', { service_ids: ['bath'], starts_at: start.toISOString(), ends_at: new Date(start.getTime() + 10 * 3600000).toISOString() }, ctx)
    expect(result).toMatchObject({ ok: true, data: { duration_minutes: 60, reserved: false } })
    const slots = (result as { data: { slots: string[] } }).data.slots
    expect(slots).toHaveLength(12)
    expect(slots[0]).toBe(start.toISOString())
    await db.prepare(`INSERT INTO appointments(tenant_id,module_id,id,client_id,pet_id,scheduled_at_ms,duration_min,service_group,status,source,subtotal_cents,transport_fee_cents,version,created_at_ms,updated_at_ms) VALUES(?1,'petshop','occupied','customer','pet',?2,60,'banho_tosa','scheduled','manual',5500,0,1,?3,?3)`)
      .bind(ctx.tenantId, start.getTime(), Date.now()).run()
    const occupied = await createLunaToolRegistry(db).execute('get_available_slots', { service_ids: ['bath'], starts_at: start.toISOString(), ends_at: new Date(start.getTime() + 10 * 3600000).toISOString() }, ctx)
    expect(occupied).toMatchObject({ ok: true })
    const remaining = (occupied as { data: { slots: string[] } }).data.slots
    expect(remaining).not.toContain(start.toISOString())
    expect(remaining[0]).toBe(new Date(start.getTime() + 3600000).toISOString())
    expect(await createLunaToolRegistry(db).execute('get_available_slots', { service_ids: ['bath'], starts_at: start.toISOString(), ends_at: new Date(start.getTime() + 48 * 3600000).toISOString() }, ctx)).toMatchObject({ ok: false, code: 'SCHEDULE_WINDOW_INVALID' })
  })

  it('bloqueia agendamento fora do expediente e entrega ainda sem contrato de commit', async () => {
    const date = new Date(Date.now() + 30 * 86400000)
    while (date.getUTCDay() !== 0) date.setUTCDate(date.getUTCDate() + 1)
    date.setUTCHours(15, 0, 0, 0)
    const registry = createLunaToolRegistry(db)
    expect(await registry.execute('prepare_appointment', { customer_id: 'customer', pet_id: 'pet', service_ids: ['bath'], scheduled_at: date.toISOString(), notes: null }, ctx)).toMatchObject({ ok: false, code: 'OUTSIDE_BUSINESS_HOURS' })
    expect(await registry.execute('prepare_product_order', { customer_id: 'customer', items: [{ product_id: 'nonexistent', quantity: 1 }], fulfillment_type: 'delivery' }, ctx)).toMatchObject({ ok: false, code: 'DELIVERY_COMMIT_NOT_SUPPORTED' })
  })
})
