import type { LunaExecutionContext, LunaToolDefinition, LunaToolResult } from './contracts'
import { isConversationCustomer } from './customerIdentity'
import { isWithinBusinessHours, normalizeBusinessHours } from '../businessHours'
import { loadSchedulePolicy } from './schedulePolicy'

type RecordValue = Record<string, unknown>
const schema = (properties: RecordValue, required: string[] = []) => ({ type: 'object', properties, required, additionalProperties: false })
const text = { type: 'string', minLength: 1, maxLength: 160 }
export const informationToolDefinitions: readonly LunaToolDefinition[] = [
  { name: 'get_store_information', description: 'Consulta nome, endereço, contato, fuso e expediente configurados. Campo ausente não autoriza uma suposição.', parameters: schema({}) },
  { name: 'get_transport_quote', description: 'Consulta opções reais de MotoDog para um pet do cliente identificado e cidade informada. Não reserva transporte nem garante capacidade.', parameters: schema({ pet_id: text, city: text }) },
  { name: 'get_delivery_quote', description: 'Consulta cobertura explicitamente configurada e taxa da entrega por cidade e bairro. Não presume cobertura apenas porque existe uma taxa.', parameters: schema({ city: text, neighborhood: text }) },
  { name: 'get_available_slots', description: 'Lista até 12 opções de horários numa janela de até 24 horas, usando duração do catálogo, expediente, capacidade e agenda reais. Não reserva a vaga.', parameters: schema({ service_ids: { type: 'array', minItems: 1, maxItems: 6, items: text }, starts_at: text, ends_at: text }) },
]

export async function loadInformationSettings(db: D1Database, ctx: LunaExecutionContext): Promise<RecordValue> {
  const row = await db.prepare(`SELECT data_json FROM module_settings_extensions WHERE tenant_id=?1 AND module_id=?2 LIMIT 1`)
    .bind(ctx.tenantId, ctx.moduleId).first<{ data_json: string }>()
  if (!row) return {}
  const data: unknown = JSON.parse(row.data_json)
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('STORE_SETTINGS_INVALID')
  return data as RecordValue
}

const normalized = (value: unknown) => typeof value === 'string' ? value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase() : ''
const optionalText = (value: unknown) => typeof value === 'string' && value.trim() ? value.trim() : null

export async function executeInformationTool(name: string, args: RecordValue, ctx: LunaExecutionContext, db: D1Database): Promise<LunaToolResult> {
  const settings = await loadInformationSettings(db, ctx)
  if (name === 'get_store_information') {
    const base = await db.prepare(`SELECT store_name,store_phone,store_address,store_neighborhood,store_city FROM tenant_module_settings WHERE tenant_id=?1 AND module_id=?2 LIMIT 1`)
      .bind(ctx.tenantId, ctx.moduleId).first<RecordValue>()
    if (!base) return { ok: false, code: 'STORE_INFORMATION_UNAVAILABLE', retryable: false }
    return { ok: true, data: {
      store_name: optionalText(base.store_name), phone: optionalText(base.store_phone), address: optionalText(base.store_address),
      neighborhood: optionalText(base.store_neighborhood), city: optionalText(base.store_city),
      timezone: optionalText(settings.petbot_timezone), business_hours: normalizeBusinessHours(settings.store_business_hours),
      observed_at_ms: Date.now(), source: 'tenant_module_settings',
    } }
  }
  if (name === 'get_available_slots') {
    const starts = Date.parse(String(args.starts_at)), ends = Date.parse(String(args.ends_at))
    if (![args.starts_at, args.ends_at].every(v => typeof v === 'string' && /(?:Z|[+-]\d\d:\d\d)$/.test(v)) || !Number.isFinite(starts) || !Number.isFinite(ends) || starts >= ends || ends - starts > 86400000) return { ok: false, code: 'SCHEDULE_WINDOW_INVALID', retryable: false }
    const hours = normalizeBusinessHours(settings.petbot_business_hours), timezone = optionalText(settings.petbot_timezone)
    if (!hours || !timezone) return { ok: false, code: 'SCHEDULE_CONFIGURATION_UNAVAILABLE', retryable: false }
    try { new Intl.DateTimeFormat('pt-BR', { timeZone: timezone }) } catch { return { ok: false, code: 'SCHEDULE_CONFIGURATION_UNAVAILABLE', retryable: false } }
    const ids = args.service_ids as string[]
    if (new Set(ids).size !== ids.length) return { ok: false, code: 'SERVICE_IDS_DUPLICATED', retryable: false }
    const rows = await db.prepare(`SELECT id,default_duration_min FROM services WHERE tenant_id=?1 AND module_id=?2 AND status='active' AND id IN (${ids.map((_, i) => `?${i + 3}`).join(',')})`)
      .bind(ctx.tenantId, ctx.moduleId, ...ids).all<{ id: string; default_duration_min: number }>()
    if (rows.results.length !== ids.length) return { ok: false, code: 'SERVICE_NOT_FOUND', retryable: false }
    const duration = rows.results.reduce((total, row) => total + row.default_duration_min, 0)
    if (!Number.isSafeInteger(duration) || duration <= 0 || duration > 1440) return { ok: false, code: 'SERVICE_DURATION_UNAVAILABLE', retryable: false }
    const policy = await loadSchedulePolicy(db, ctx.tenantId, ctx.moduleId)
    // One bounded read of the window rather than a query per candidate slot.
    const appointments = await db.prepare(`SELECT scheduled_at_ms,duration_min FROM appointments WHERE tenant_id=?1 AND module_id=?2 AND status IN ('scheduled','confirmed','in_progress','blocked') AND scheduled_at_ms>=?3-86400000 AND scheduled_at_ms<?4 AND scheduled_at_ms+duration_min*60000>?3 ORDER BY scheduled_at_ms,id LIMIT 501`)
      .bind(ctx.tenantId, ctx.moduleId, starts, ends).all<{ scheduled_at_ms: number; duration_min: number }>()
    if (appointments.results.length > 500) return { ok: false, code: 'SCHEDULE_WINDOW_TOO_DENSE', retryable: false }
    const slots: string[] = [], observed = Date.now(), min = observed + policy.leadTimeMinutes * 60000
    for (let time = starts; time + duration * 60000 <= ends && slots.length < 12; time += policy.slotIntervalMinutes * 60000) {
      if (time <= observed || time < min || !isWithinBusinessHours(hours, timezone, time, duration)) continue
      const overlaps = appointments.results.filter(row => row.scheduled_at_ms < time + duration * 60000 && row.scheduled_at_ms + row.duration_min * 60000 > time).length
      if (overlaps < policy.capacity) slots.push(new Date(time).toISOString())
    }
    return { ok: true, data: { slots, duration_minutes: duration, timezone, observed_at_ms: observed, reserved: false, source: 'appointments/services/module_settings_extensions' } }
  }
  if (name === 'get_transport_quote') {
    const pet = await db.prepare(`SELECT client_id,weight_kg FROM pets WHERE tenant_id=?1 AND module_id=?2 AND id=?3 AND status='active' LIMIT 1`)
      .bind(ctx.tenantId, ctx.moduleId, args.pet_id).first<{ client_id: string; weight_kg: number | null }>()
    if (!pet || !await isConversationCustomer(db, ctx, pet.client_id)) return { ok: false, code: 'CUSTOMER_SCOPE_DENIED', retryable: false }
    const store = await db.prepare(`SELECT store_city FROM tenant_module_settings WHERE tenant_id=?1 AND module_id=?2 LIMIT 1`)
      .bind(ctx.tenantId, ctx.moduleId).first<{ store_city: string | null }>()
    if (!normalized(store?.store_city)) return { ok: false, code: 'TRANSPORT_COVERAGE_UNAVAILABLE', retryable: false }
    const outside = normalized(store?.store_city) !== normalized(args.city)
    const options = await db.prepare(`SELECT id,label,fee_cents,max_weight_grams,pickup_required,dropoff_required,outside_city FROM transport_options WHERE tenant_id=?1 AND module_id=?2 AND status='active' AND outside_city=?3 AND (pickup_required=1 OR dropoff_required=1) ORDER BY sort_order,id LIMIT 12`)
      .bind(ctx.tenantId, ctx.moduleId, outside ? 1 : 0).all<{ id: string; label: string; fee_cents: number; max_weight_grams: number | null; pickup_required: number; dropoff_required: number; outside_city: number }>()
    const weight = pet.weight_kg == null ? null : Math.round(pet.weight_kg * 1000)
    if (options.results.some(option => option.max_weight_grams != null) && (weight == null || !Number.isFinite(weight) || weight <= 0)) {
      return { ok: false, code: 'PET_WEIGHT_REQUIRED', retryable: false, missing_fields: ['weight_kg'] }
    }
    return { ok: true, data: { options: options.results.filter(option => option.max_weight_grams == null || weight! <= option.max_weight_grams), city: args.city, pet_id: args.pet_id, capacity_checked: false, observed_at_ms: Date.now(), source: 'transport_options' } }
  }
  if (name === 'get_delivery_quote') {
    // New optional configuration contract. Existing global delivery_fee alone
    // is not evidence of service coverage; absent coverage fails closed.
    const areas = settings.delivery_coverage
    if (!Array.isArray(areas) || areas.length > 100) return { ok: false, code: 'DELIVERY_COVERAGE_UNAVAILABLE', retryable: false }
    const matches = areas.filter(raw => {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false
      const area = raw as RecordValue
      return area.active === true && normalized(area.city) === normalized(args.city) && normalized(area.neighborhood) === normalized(args.neighborhood)
    }) as RecordValue[]
    if (matches.length !== 1) return { ok: false, code: matches.length ? 'DELIVERY_COVERAGE_AMBIGUOUS' : 'DELIVERY_OUTSIDE_COVERAGE', retryable: false }
    const area = matches[0]
    if (!Number.isSafeInteger(area.fee_cents) || Number(area.fee_cents) < 0) return { ok: false, code: 'DELIVERY_FEE_UNAVAILABLE', retryable: false }
    return { ok: true, data: { city: area.city, neighborhood: area.neighborhood, fee_cents: area.fee_cents, coverage_snapshot_json: JSON.stringify(areas), observed_at_ms: Date.now(), source: 'module_settings_extensions.delivery_coverage' } }
  }
  return { ok: false, code: 'TOOL_NOT_ALLOWED', retryable: false }
}
