import { createHash } from 'node:crypto'

import { projectOperationalSnapshot } from './phase8OperationalProjection.mjs'

export const LEGACY_CANONICAL_PROJECTION = Object.freeze({ name: 'legacy-canonical', version: 'v2' })

// Tables covered by this projection itself. Foundation, clients/pets, Better Auth
// and AI Lab have their own dedicated projection paths and are intentionally not
// duplicated here.
export const LEGACY_CANONICAL_SOURCE_TABLES = Object.freeze([
  'products','petshop_services','stock_movements','settings','appointments','service_delivery_orders',
  'sales','sale_items','sale_payment_splits','chat_sessions','chat_messages','fiscal_documents',
  'subscription_plans','client_subscriptions','loyalty_settings','loyalty_points','commission_rules',
  'cash_register','invoices','billing_settings','accounting_services','fiscal_audit_logs',
  'tenant_fiscal_profiles','petshop_campaign_logs','petshop_growth_booking_settings',
  'petshop_growth_booking_requests','petshop_growth_leads','petshop_growth_no_show_events',
  'petshop_growth_no_show_policy','petshop_growth_report_cards','support_threads','support_messages',
  'tenant_ai_usage_monthly','tenant_governance_alerts','tenant_onboarding','tenant_subscriptions',
])

const SECRET_KEY = /(?:^|_)(?:password|passwd|secret|service_role|service_role_key|access_token|refresh_token|authorization|api_key|apikey|private_key|client_secret|app_secret|verify_token)(?:$|_)/i
const OPEN_APPOINTMENT = new Set(['agendado','scheduled','booked','confirmado','confirmed','em_andamento','in_progress','bloqueado','blocked'])
const COMPLETED_APPOINTMENT = new Set(['concluido','concluído','completed','finalizado','finished'])
const CANCELLED_APPOINTMENT = new Set(['cancelado','cancelled','no_show'])

function arr(value) { return Array.isArray(value) ? value : [] }
function text(value, fallback = '') { const normalized = value == null ? '' : String(value).trim(); return normalized || fallback }
function nullable(value) { const normalized = text(value); return normalized || null }
function finite(value, fallback = 0) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : fallback }
function integer(value, fallback = 0) { return Math.round(finite(value, fallback)) }
function bool(value, fallback = false) { return value == null ? fallback : value === true || value === 1 || String(value).toLowerCase() === 'true' }
function cents(value) { return Math.max(0, Math.round((finite(value, 0) + Number.EPSILON) * 100)) }
function grams(value) { return value == null || value === '' ? null : Math.max(0, Math.round(finite(value) * 1000)) }
function ms(value, fallback = null) { if (value == null || value === '') return fallback; const parsed = typeof value === 'number' ? value : Date.parse(String(value)); return Number.isFinite(parsed) ? parsed : fallback }
function stableId(prefix, key) { return `${prefix}_${createHash('sha256').update(String(key)).digest('hex').slice(0, 32)}` }
function parseJson(value, fallback) { if (value == null || value === '') return fallback; if (typeof value === 'object') return value; try { return JSON.parse(String(value)) } catch { return fallback } }
function json(value, fallback = {}) { try { return JSON.stringify(value ?? fallback) } catch { return JSON.stringify(fallback) } }
function normalizeModule(row, moduleId) { return text(row?.module_id, moduleId).toLowerCase() }
function inScope(row, scope) { return text(row?.tenant_id) === scope.tenant_id && normalizeModule(row, scope.module_id) === scope.module_id }
function rows(source, name, scope) { return arr(source?.tables?.[name]).filter((row) => inScope(row, scope)) }
function first(source, name, scope) { return rows(source, name, scope)[0] || null }
function byId(source, name, scope) { return new Map(rows(source, name, scope).map((row) => [text(row.id), row]).filter(([id]) => id)) }
function safePayload(value) {
  if (Array.isArray(value)) return value.map(safePayload)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value).filter(([key]) => !SECRET_KEY.test(key)).map(([key, nested]) => [key, safePayload(nested)]))
}
function canonicalJson(value, fallback = {}) { return json(safePayload(parseJson(value, fallback)), fallback) }
function sortCollections(collections) {
  for (const collection of Object.values(collections)) {
    if (Array.isArray(collection)) collection.sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right), 'en'))
  }
  return collections
}
function singleton(source, name, scope) {
  const scoped = rows(source, name, scope)
  if (scoped.length > 1) throw new Error(`LEGACY_CANONICAL_DUPLICATE_SINGLETON:${name}:${scoped.length}`)
  return scoped[0] || null
}

function enrichCatalog(base, source, scope) {
  const legacyServices = byId(source, 'petshop_services', scope)
  const legacyByCode = new Map(rows(source, 'petshop_services', scope).map((row) => [text(row.code), row]).filter(([code]) => code))
  const services = base.services.map((service) => {
    const legacy = legacyServices.get(service.id) || legacyByCode.get(service.code) || {}
    const minKg = legacy.min_weight_kg == null ? null : Math.max(0, finite(legacy.min_weight_kg))
    const maxKg = legacy.max_weight_kg == null ? null : Math.max(0, finite(legacy.max_weight_kg))
    const species = ['dog','cat'].includes(text(legacy.species_target).toLowerCase()) ? text(legacy.species_target).toLowerCase() : null
    return {
      ...service,
      min_weight_kg: minKg,
      max_weight_kg: maxKg,
      min_weight_grams: minKg == null ? null : grams(minKg),
      max_weight_grams: maxKg == null ? null : grams(maxKg),
      species_target: species,
    }
  })
  return { ...base, services }
}

function projectSettingsExtension(source, scope) {
  const setting = first(source, 'settings', scope)
  if (!setting) return []
  const storeHours = parseJson(setting.store_business_hours, null)
  if (storeHours == null) return []
  return [{
    tenant_id: scope.tenant_id,
    module_id: scope.module_id,
    data_json: json({ store_business_hours: storeHours }),
    version: 1,
    updated_at_ms: ms(setting.updated_at, ms(setting.created_at, 0)) ?? 0,
  }]
}

function normalizeBenefitState(row) {
  const explicit = text(row.subscription_benefit_status).toLowerCase()
  if (['reserved','consumed','released'].includes(explicit)) return explicit
  const status = text(row.status).toLowerCase()
  if (COMPLETED_APPOINTMENT.has(status)) return 'consumed'
  if (CANCELLED_APPOINTMENT.has(status)) return 'released'
  return 'reserved'
}

function legacyBenefits(row) {
  const explicit = parseJson(row.subscription_benefits, parseJson(row.subscription_benefits_json, []))
  if (Array.isArray(explicit) && explicit.length) return explicit
  const serviceItems = arr(parseJson(row.service_items, []))
    .filter((item) => bool(item?.benefit_used, false))
    .map((item, position) => ({
      kind: 'service',
      key: nullable(item.benefit_key) || nullable(item.code) || nullable(item.service_type),
      service_code: nullable(item.code) || nullable(item.service_type),
      catalog_price: item.catalog_price ?? item.unit_price ?? item.price ?? 0,
      position,
      status: nullable(item.benefit_status),
    }))
  return serviceItems
}

function projectAppointmentsV2(base, source, scope) {
  const legacyAppointments = byId(source, 'appointments', scope)
  const appointments = base.appointments.map((appointment) => {
    const legacy = legacyAppointments.get(appointment.id) || {}
    const benefits = legacyBenefits(legacy)
    const benefitState = normalizeBenefitState(legacy)
    const machine = legacy.grooming_machine_no == null ? null : integer(legacy.grooming_machine_no)
    if (machine != null && ![4,7,10].includes(machine)) throw new Error(`LEGACY_GROOMING_MACHINE_INVALID:${appointment.id}:${machine}`)
    const billingIntent = ['auto','standalone','subscription'].includes(text(legacy.billing_intent_type).toLowerCase())
      ? text(legacy.billing_intent_type).toLowerCase()
      : (legacy.subscription_id ? 'subscription' : 'auto')
    return {
      ...appointment,
      subscription_id: nullable(legacy.subscription_id),
      subscription_benefit_used: bool(legacy.subscription_benefit_used, benefits.length > 0) ? 1 : 0,
      subscription_benefit_status: benefits.length ? benefitState : nullable(legacy.subscription_benefit_status),
      subscription_benefits_json: json(benefits),
      subscription_label: nullable(legacy.subscription_label || legacy.subscription_plan_name),
      subscription_discount_cents: cents(legacy.subscription_discount || legacy.subscription_discount_amount || 0),
      employee_id: nullable(legacy.employee_id),
      groomer_id: nullable(legacy.groomer_id),
      grooming_machine_no: machine,
      responsible_staff_key: nullable(legacy.responsible_staff_key),
      responsible_staff_name: nullable(legacy.responsible_staff_name),
      delivery_staff_key: nullable(legacy.delivery_staff_key),
      delivery_staff_name: nullable(legacy.delivery_staff_name),
      live_status: nullable(legacy.live_status),
      checkin_at_ms: ms(legacy.checkin_at, null),
      ready_at_ms: ms(legacy.ready_at, null),
      billing_intent_type: billingIntent,
      billing_intent_subscription_id: nullable(legacy.billing_intent_subscription_id || (billingIntent === 'subscription' ? legacy.subscription_id : null)),
    }
  })

  const appointmentServices = base.appointment_services.map((service) => {
    const legacy = legacyAppointments.get(service.appointment_id) || {}
    const items = arr(parseJson(legacy.service_items, []))
    const item = items[service.position] || {}
    const minKg = item.min_weight_kg == null ? null : Math.max(0, finite(item.min_weight_kg))
    const maxKg = item.max_weight_kg == null ? null : Math.max(0, finite(item.max_weight_kg))
    const species = ['dog','cat'].includes(text(item.species_target).toLowerCase()) ? text(item.species_target).toLowerCase() : null
    return {
      ...service,
      catalog_price_cents: cents(item.catalog_price ?? item.unit_price ?? item.price ?? legacy.price),
      commission_basis_points: item.commission_rate == null ? null : Math.min(10000, Math.max(0, Math.round(finite(item.commission_rate) * 100))),
      min_weight_kg: minKg,
      max_weight_kg: maxKg,
      min_weight_grams: minKg == null ? null : grams(minKg),
      max_weight_grams: maxKg == null ? null : grams(maxKg),
      species_target: species,
    }
  })
  return { appointments, appointment_services: appointmentServices }
}

function projectPackageLedger(source, scope) {
  const plans = rows(source, 'subscription_plans', scope).map((row) => ({
    tenant_id: scope.tenant_id,
    module_id: scope.module_id,
    id: text(row.id),
    name: text(row.name, 'Pacote'),
    price_cents: cents(row.price),
    billing_cycle: ['monthly','quarterly','annual','custom'].includes(text(row.billing_cycle).toLowerCase()) ? text(row.billing_cycle).toLowerCase() : 'monthly',
    services_json: json(parseJson(row.services, []), []),
    status: bool(row.active, true) ? 'active' : 'inactive',
    created_at_ms: ms(row.created_at, 0) ?? 0,
    updated_at_ms: ms(row.updated_at, ms(row.created_at, 0)) ?? 0,
  })).filter((row) => row.id)

  const allocationRows = []
  for (const appointment of rows(source, 'appointments', scope)) {
    const subscriptionId = nullable(appointment.subscription_id)
    if (!subscriptionId) continue
    const stateDefault = normalizeBenefitState(appointment)
    const benefits = legacyBenefits(appointment)
    benefits.forEach((benefit, index) => {
      const kind = text(benefit.kind || benefit.benefit_kind, 'service').toLowerCase() === 'transport' ? 'transport' : 'service'
      const key = nullable(benefit.key || benefit.benefit_key || benefit.service_code || (kind === 'transport' ? 'motodog' : null))
      if (!key) throw new Error(`LEGACY_PACKAGE_BENEFIT_KEY_MISSING:${appointment.id}:${index}`)
      const state = ['reserved','consumed','released'].includes(text(benefit.status).toLowerCase()) ? text(benefit.status).toLowerCase() : stateDefault
      const position = kind === 'transport' ? -1 : Math.max(0, integer(benefit.position, index))
      const createdAt = ms(appointment.created_at, ms(appointment.scheduled_at, 0)) ?? 0
      const updatedAt = ms(appointment.updated_at, createdAt) ?? createdAt
      allocationRows.push({
        tenant_id: scope.tenant_id,
        module_id: scope.module_id,
        id: stableId('benefit', `${subscriptionId}:${appointment.id}:${kind}:${position}:${key}`),
        subscription_id: subscriptionId,
        appointment_id: text(appointment.id),
        appointment_service_position: position,
        benefit_kind: kind,
        benefit_key: key,
        service_code: kind === 'service' ? nullable(benefit.service_code || benefit.code || key) : null,
        state,
        operation_key: `legacy-benefit:${appointment.id}:${kind}:${position}:${key}`,
        catalog_price_cents: cents(benefit.catalog_price ?? benefit.unit_price ?? benefit.price ?? 0),
        version: 1,
        reserved_at_ms: state === 'reserved' || state === 'consumed' ? createdAt : null,
        consumed_at_ms: state === 'consumed' ? updatedAt : null,
        released_at_ms: state === 'released' ? updatedAt : null,
        created_at_ms: createdAt,
        updated_at_ms: updatedAt,
      })
    })
  }

  const consumedBySubscription = new Map()
  for (const allocation of allocationRows) {
    if (allocation.state !== 'consumed') continue
    const key = `${allocation.subscription_id}\u0000${allocation.benefit_key}`
    consumedBySubscription.set(key, (consumedBySubscription.get(key) || 0) + 1)
  }

  const subscriptions = rows(source, 'client_subscriptions', scope).map((row) => {
    const usage = parseJson(row.services_used, {}) || {}
    const baseUsage = {}
    for (const [benefitKey, raw] of Object.entries(usage)) {
      const total = Math.max(0, integer(raw, 0))
      const allocated = consumedBySubscription.get(`${text(row.id)}\u0000${benefitKey}`) || 0
      if (allocated > total) throw new Error(`LEGACY_PACKAGE_USAGE_UNDERFLOW:${row.id}:${benefitKey}:${total}:${allocated}`)
      baseUsage[benefitKey] = total - allocated
    }
    const statusRaw = text(row.status, 'active').toLowerCase()
    const status = ['pending_payment','active','paused','cancelled','expired'].includes(statusRaw) ? statusRaw : 'active'
    const legacyMetadata = {
      services_reserved: parseJson(row.services_reserved, {}),
      first_appointment_at: nullable(row.first_appointment_at),
      recurring_appointments_created_at: nullable(row.recurring_appointments_created_at),
    }
    return {
      tenant_id: scope.tenant_id,
      module_id: scope.module_id,
      id: text(row.id),
      plan_id: text(row.plan_id),
      client_id: text(row.client_id),
      status,
      started_at_ms: ms(row.started_at, ms(row.created_at, 0)) ?? 0,
      next_billing_date: nullable(row.next_billing_date),
      services_used_json: json(usage),
      benefit_ledger_base_used_json: json(baseUsage),
      cancelled_at_ms: ms(row.cancelled_at, null),
      legacy_metadata_json: json(legacyMetadata),
      created_at_ms: ms(row.created_at, 0) ?? 0,
      updated_at_ms: ms(row.updated_at, ms(row.created_at, 0)) ?? 0,
    }
  }).filter((row) => row.id && row.plan_id && row.client_id)

  return { subscription_plans: plans, client_subscriptions: subscriptions, subscription_benefit_allocations: allocationRows }
}

function projectLoyalty(source, scope) {
  const setting = singleton(source, 'loyalty_settings', scope)
  const loyalty_settings = setting ? [{
    tenant_id: scope.tenant_id,
    module_id: scope.module_id,
    enabled: setting.enabled == null ? 1 : (bool(setting.enabled, true) ? 1 : 0),
    points_per_currency: Math.max(0, integer(setting.points_per_real ?? setting.points_per_currency, 1)),
    redemption_rate_cents: Math.max(0, integer(setting.redemption_rate_cents, setting.redemption_rate ? 100 / Math.max(1, finite(setting.redemption_rate)) : 0)),
    data_json: json({
      points_per_real: finite(setting.points_per_real, 1),
      points_per_service: integer(setting.points_per_service, 0),
      redemption_rate: finite(setting.redemption_rate, 0),
      expiry_days: integer(setting.expiry_days, 0),
    }),
    updated_at_ms: ms(setting.updated_at, ms(setting.created_at, 0)) ?? 0,
  }] : []

  const ordered = rows(source, 'loyalty_points', scope).sort((a, b) => (ms(a.created_at, 0) ?? 0) - (ms(b.created_at, 0) ?? 0) || text(a.id).localeCompare(text(b.id), 'en'))
  const balance = new Map()
  const loyalty_points = ordered.map((row) => {
    const clientId = text(row.client_id)
    const delta = integer(row.points ?? row.points_delta, 0)
    const next = Math.max(0, (balance.get(clientId) || 0) + delta)
    balance.set(clientId, next)
    return {
      tenant_id: scope.tenant_id,
      module_id: scope.module_id,
      id: text(row.id),
      client_id: clientId,
      points_delta: delta,
      balance_after: next,
      reason: nullable(row.reason),
      reference_type: nullable(row.reference_type || (row.reference_id ? 'legacy' : null)),
      reference_id: nullable(row.reference_id),
      expires_at_ms: ms(row.expires_at, null),
      created_at_ms: ms(row.created_at, 0) ?? 0,
    }
  }).filter((row) => row.id && row.client_id)
  return { loyalty_settings, loyalty_points }
}

function projectCommercialAdmin(source, scope) {
  const commission_rules = rows(source, 'commission_rules', scope).map((row) => {
    const type = text(row.type || row.rule_type, 'percentage').toLowerCase() === 'fixed' ? 'fixed' : 'percentage'
    return {
      tenant_id: scope.tenant_id,module_id: scope.module_id,id: text(row.id),staff_key: nullable(row.profile_id || row.staff_key),
      service_code: nullable(row.service_code),rule_type: type,
      rate_basis_points: type === 'percentage' ? Math.min(10000, Math.max(0, Math.round(finite(row.rate ?? row.commission_rate, 0) * 100))) : 0,
      fixed_cents: type === 'fixed' ? cents(row.rate ?? row.fixed_amount) : 0,
      status: row.active === false ? 'inactive' : 'active',
      data_json: json({ applies_to: nullable(row.applies_to) }),updated_at_ms: ms(row.updated_at, ms(row.created_at, 0)) ?? 0,
    }
  }).filter((row) => row.id)

  const cash_register = rows(source, 'cash_register', scope).map((row) => ({
    tenant_id: scope.tenant_id,module_id: scope.module_id,id: text(row.id),opened_by: nullable(row.opened_by),closed_by: nullable(row.closed_by),
    opening_balance_cents: cents(row.opening_balance),closing_balance_cents: row.closing_balance == null ? null : cents(row.closing_balance),
    expected_balance_cents: row.expected_balance == null ? null : cents(row.expected_balance),difference_cents: row.difference == null ? null : Math.round(finite(row.difference) * 100),
    opened_at_ms: ms(row.opened_at, 0) ?? 0,closed_at_ms: ms(row.closed_at, null),notes: nullable(row.notes),
  })).filter((row) => row.id)

  const invoices = rows(source, 'invoices', scope).map((row) => ({
    tenant_id: scope.tenant_id,module_id: scope.module_id,id: text(row.id),sale_id: nullable(row.sale_id),client_id: nullable(row.client_id),
    amount_cents: cents(row.amount),status: ['pending','paid','cancelled','overdue','refunded'].includes(text(row.status).toLowerCase()) ? text(row.status).toLowerCase() : 'pending',
    due_date: nullable(row.due_date),paid_at_ms: ms(row.paid_at, null),customer_phone: nullable(row.customer_phone),notes: nullable(row.notes),invoice_nfe_url: nullable(row.invoice_nfe_url),
    created_at_ms: ms(row.created_at, 0) ?? 0,updated_at_ms: ms(row.updated_at, ms(row.created_at, 0)) ?? 0,
  })).filter((row) => row.id)

  const billing = singleton(source, 'billing_settings', scope)
  const billing_settings = billing ? [{ tenant_id: scope.tenant_id,module_id: scope.module_id,data_json: canonicalJson(billing, {}),updated_at_ms: ms(billing.updated_at, ms(billing.created_at, 0)) ?? 0 }] : []

  const accounting_services = rows(source, 'accounting_services', scope).map((row) => ({
    tenant_id: scope.tenant_id,module_id: scope.module_id,id: text(row.id),name: text(row.name, 'Servico'),amount_cents: cents(row.amount ?? row.price),
    status: row.active === false ? 'inactive' : 'active',data_json: canonicalJson(row.details ?? row.metadata, {}),created_at_ms: ms(row.created_at, 0) ?? 0,updated_at_ms: ms(row.updated_at, ms(row.created_at, 0)) ?? 0,
  })).filter((row) => row.id)

  return { commission_rules, cash_register, invoices, billing_settings, accounting_services }
}

function projectGrowth(source, scope) {
  const setting = singleton(source, 'petshop_growth_booking_settings', scope)
  const petshop_growth_booking_settings = setting ? [{
    tenant_id: scope.tenant_id,module_id: scope.module_id,enabled: bool(setting.enabled, true) ? 1 : 0,public_slug: text(setting.public_slug),
    allow_whatsapp_fallback: bool(setting.allow_whatsapp_fallback, true) ? 1 : 0,lead_expiration_hours: Math.max(1, integer(setting.lead_expiration_hours, 6)),
    intake_message: nullable(setting.intake_message),updated_at_ms: ms(setting.updated_at, ms(setting.created_at, 0)) ?? 0,
  }] : []
  const petshop_growth_leads = rows(source, 'petshop_growth_leads', scope).map((row) => ({
    tenant_id: scope.tenant_id,module_id: scope.module_id,id: text(row.id),client_id: nullable(row.client_id),source: text(row.source, 'manual'),stage: text(row.stage, 'new'),priority: text(row.priority, 'normal'),
    owner_name: text(row.owner_name, 'Cliente'),pet_name: nullable(row.pet_name),phone: nullable(row.phone),interest: nullable(row.interest),notes: nullable(row.notes),
    next_followup_at_ms: ms(row.next_followup_at, null),last_contact_at_ms: ms(row.last_contact_at, null),converted_sale_id: nullable(row.converted_sale_id),created_at_ms: ms(row.created_at, 0) ?? 0,updated_at_ms: ms(row.updated_at, ms(row.created_at, 0)) ?? 0,
  })).filter((row) => row.id)
  const petshop_growth_booking_requests = rows(source, 'petshop_growth_booking_requests', scope).map((row) => ({
    tenant_id: scope.tenant_id,module_id: scope.module_id,id: text(row.id),client_id: nullable(row.client_id),lead_id: nullable(row.lead_id),channel: text(row.channel, 'manual'),customer_name: text(row.customer_name, 'Cliente'),pet_name: nullable(row.pet_name),phone: nullable(row.phone),service_interest: nullable(row.service_interest),
    preferred_date: nullable(row.preferred_date),preferred_period: nullable(row.preferred_period),transport_mode: text(row.transport_mode, 'dropoff'),need_motodog: bool(row.need_motodog, false) ? 1 : 0,motodog_fee_cents: cents(row.motodog_fee ?? row.motodog_fee_amount),
    pickup_address: nullable(row.pickup_address),pickup_neighborhood: nullable(row.pickup_neighborhood),pickup_city: nullable(row.pickup_city),status: text(row.status, 'pending'),notes: nullable(row.notes),created_at_ms: ms(row.created_at, 0) ?? 0,updated_at_ms: ms(row.updated_at, ms(row.created_at, 0)) ?? 0,
  })).filter((row) => row.id)
  const policy = singleton(source, 'petshop_growth_no_show_policy', scope)
  const petshop_growth_no_show_policy = policy ? [{
    tenant_id: scope.tenant_id,module_id: scope.module_id,require_prepayment: bool(policy.require_prepayment, false) ? 1 : 0,prepayment_cents: cents(policy.prepayment_amount ?? policy.prepayment),
    grace_minutes: Math.max(0, integer(policy.grace_minutes, 15)),max_strikes: Math.max(1, integer(policy.max_strikes, 2)),auto_block_days: Math.max(0, integer(policy.auto_block_days, 30)),reminder_minutes_before: Math.max(0, integer(policy.reminder_minutes_before, 90)),updated_at_ms: ms(policy.updated_at, ms(policy.created_at, 0)) ?? 0,
  }] : []
  const petshop_growth_no_show_events = rows(source, 'petshop_growth_no_show_events', scope).map((row) => ({
    tenant_id: scope.tenant_id,module_id: scope.module_id,id: text(row.id),appointment_id: nullable(row.appointment_id),client_id: nullable(row.client_id),event_type: text(row.event_type, 'no_show'),fee_cents: cents(row.fee_amount ?? row.fee),notes: nullable(row.notes),created_at_ms: ms(row.created_at, 0) ?? 0,
  })).filter((row) => row.id)
  const petshop_campaign_logs = rows(source, 'petshop_campaign_logs', scope).map((row) => ({
    tenant_id: scope.tenant_id,module_id: scope.module_id,id: text(row.id),campaign_type: nullable(row.campaign_type),client_id: nullable(row.client_id),channel: nullable(row.channel),status: nullable(row.status),
    payload_json: json(safePayload({ audience_name: row.audience_name, message: row.message, sent_at: row.sent_at, payload: parseJson(row.payload, null) })),created_at_ms: ms(row.created_at, 0) ?? 0,
  })).filter((row) => row.id)
  const petshop_growth_report_cards = rows(source, 'petshop_growth_report_cards', scope).map((row) => ({
    tenant_id: scope.tenant_id,module_id: scope.module_id,id: text(row.id),period_key: text(row.period_key, nullable(row.appointment_id) || new Date(ms(row.created_at, 0) ?? 0).toISOString().slice(0,10)),
    metrics_json: json(safePayload({ appointment_id: row.appointment_id,client_id: row.client_id,pet_name: row.pet_name,summary: row.summary,care_tips: row.care_tips,recommended_services: parseJson(row.recommended_services, []),next_visit_date: row.next_visit_date,delivery_channel: row.delivery_channel,delivered: row.delivered,created_by: row.created_by })),
    created_at_ms: ms(row.created_at, 0) ?? 0,updated_at_ms: ms(row.updated_at, ms(row.created_at, 0)) ?? 0,
  })).filter((row) => row.id)
  return { petshop_growth_booking_settings,petshop_growth_leads,petshop_growth_booking_requests,petshop_growth_no_show_policy,petshop_growth_no_show_events,petshop_campaign_logs,petshop_growth_report_cards }
}

function projectSupport(source, scope) {
  const support_threads = rows(source, 'support_threads', scope).map((row) => ({
    tenant_id: scope.tenant_id,module_id: scope.module_id,id: text(row.id),requester_profile_id: text(row.requester_profile_id),
    assigned_to: nullable(row.assigned_to),status: text(row.status).toLowerCase() === 'finalized' ? 'closed' : (['open','pending','closed'].includes(text(row.status).toLowerCase()) ? text(row.status).toLowerCase() : 'pending'),
    priority: ['low','normal','high','urgent'].includes(text(row.priority).toLowerCase()) ? text(row.priority).toLowerCase() : 'normal',source: text(row.source, 'widget'),subject: nullable(row.subject),last_message_preview: nullable(row.last_message_preview),last_message_at_ms: ms(row.last_message_at, null),created_at_ms: ms(row.created_at, 0) ?? 0,updated_at_ms: ms(row.updated_at, ms(row.created_at, 0)) ?? 0,
  })).filter((row) => row.id && row.requester_profile_id)
  const support_messages = rows(source, 'support_messages', scope).map((row) => ({
    tenant_id: scope.tenant_id,module_id: scope.module_id,id: text(row.id),thread_id: text(row.thread_id),sender_profile_id: nullable(row.sender_profile_id),sender_type: ['customer','agent','system'].includes(text(row.sender_type).toLowerCase()) ? text(row.sender_type).toLowerCase() : 'system',body: text(row.body),created_at_ms: ms(row.created_at, 0) ?? 0,
  })).filter((row) => row.id && row.thread_id)
  return { support_threads, support_messages }
}

function projectGovernanceAndFiscal(source, scope) {
  const fiscal_audit_logs = rows(source, 'fiscal_audit_logs', scope).map((row) => ({
    tenant_id: scope.tenant_id,module_id: scope.module_id,id: text(row.id),invoice_id: nullable(row.invoice_id),severity: ['info','warning','error'].includes(text(row.severity).toLowerCase()) ? text(row.severity).toLowerCase() : 'info',code: text(row.code, 'LEGACY'),message: text(row.message, 'Legacy fiscal audit'),metadata_json: canonicalJson(row.metadata, {}),created_at_ms: ms(row.created_at, 0) ?? 0,
  })).filter((row) => row.id)
  const fiscalProfile = singleton(source, 'tenant_fiscal_profiles', scope)
  const tenant_fiscal_profiles = fiscalProfile ? [{
    tenant_id: scope.tenant_id,module_id: scope.module_id,policy_version_id: nullable(fiscalProfile.policy_version_id),mode: ['manual','assisted','automatic'].includes(text(fiscalProfile.mode).toLowerCase()) ? text(fiscalProfile.mode).toLowerCase() : 'manual',auto_update: bool(fiscalProfile.auto_update, false) ? 1 : 0,nfe_environment: ['homologacao','producao'].includes(text(fiscalProfile.nfe_environment).toLowerCase()) ? text(fiscalProfile.nfe_environment).toLowerCase() : 'homologacao',fiscal_regime: nullable(fiscalProfile.fiscal_regime),issue_series: Math.max(1, integer(fiscalProfile.issue_series, 1)),next_invoice_number: Math.max(1, integer(fiscalProfile.next_invoice_number, 1)),emit_nfce: bool(fiscalProfile.emit_nfce, false) ? 1 : 0,emit_nfe: bool(fiscalProfile.emit_nfe, false) ? 1 : 0,emit_nfse: bool(fiscalProfile.emit_nfse, false) ? 1 : 0,settings_json: canonicalJson(fiscalProfile.settings, {}),updated_at_ms: ms(fiscalProfile.updated_at, ms(fiscalProfile.created_at, 0)) ?? 0,
  }] : []
  const tenant_ai_usage_monthly = rows(source, 'tenant_ai_usage_monthly', scope).map((row) => ({
    tenant_id: scope.tenant_id,module_id: scope.module_id,month_key: text(row.month_key || row.period_month),request_count: Math.max(0, integer(row.request_count, 0)),token_count: Math.max(0, integer(row.token_count ?? row.tokens_used, 0)),updated_at_ms: ms(row.updated_at, ms(row.created_at, 0)) ?? 0,
  })).filter((row) => row.month_key)
  const tenant_governance_alerts = rows(source, 'tenant_governance_alerts', scope).map((row) => ({
    id: text(row.id),tenant_id: scope.tenant_id,module_id: scope.module_id,alert_type: text(row.alert_type, 'legacy'),severity: ['info','warning','high','critical'].includes(text(row.severity).toLowerCase()) ? text(row.severity).toLowerCase() : 'warning',status: ['open','acknowledged','resolved'].includes(text(row.status).toLowerCase()) ? text(row.status).toLowerCase() : 'open',title: text(row.title, 'Legacy alert'),description: nullable(row.description),payload: canonicalJson(row.payload, {}),fingerprint: text(row.fingerprint, stableId('legacy-alert', row.id)),acknowledged_by: nullable(row.acknowledged_by),acknowledged_at: nullable(row.acknowledged_at),resolved_at: nullable(row.resolved_at),created_at: nullable(row.created_at),updated_at: nullable(row.updated_at),
  })).filter((row) => row.id)
  const onboarding = singleton(source, 'tenant_onboarding', scope)
  const tenant_onboarding = onboarding ? [{
    tenant_id: scope.tenant_id,module_id: scope.module_id,status: ['pending','in_progress','blocked','completed'].includes(text(onboarding.status).toLowerCase()) ? text(onboarding.status).toLowerCase() : 'in_progress',stage: text(onboarding.stage, 'empresa'),progress: Math.min(100, Math.max(0, integer(onboarding.progress, 0))),checklist: canonicalJson(onboarding.checklist, {}),owner_profile_id: nullable(onboarding.owner_profile_id),updated_by: nullable(onboarding.updated_by),started_at: nullable(onboarding.started_at),completed_at: nullable(onboarding.completed_at),updated_at: nullable(onboarding.updated_at),
  }] : []
  const tenant_subscriptions = rows(source, 'tenant_subscriptions', scope).map((row) => ({
    tenant_id: scope.tenant_id,module_id: scope.module_id,id: text(row.id),plan_id: text(row.plan_id),status: ['active','trial','past_due','cancelled','expired'].includes(text(row.status).toLowerCase()) ? text(row.status).toLowerCase() : 'active',started_at_ms: ms(row.started_at, ms(row.created_at, 0)) ?? 0,expires_at_ms: ms(row.expires_at, null),data_json: canonicalJson(row.data, {}),updated_at_ms: ms(row.updated_at, ms(row.created_at, 0)) ?? 0,
    billing_cycle: text(row.billing_cycle, 'monthly'),contracted_price: row.contracted_price == null ? null : finite(row.contracted_price),currency: text(row.currency, 'BRL'),trial_ends_at: nullable(row.trial_ends_at),current_period_start: nullable(row.current_period_start),next_billing_at: nullable(row.next_billing_at),auto_charge_enabled: bool(row.auto_charge_enabled, false) ? 1 : 0,payment_provider: nullable(row.payment_provider),provider_customer_id: nullable(row.provider_customer_id),provider_subscription_id: nullable(row.provider_subscription_id),notes: nullable(row.notes),managed_by: nullable(row.managed_by),
  })).filter((row) => row.id && row.plan_id)
  return { fiscal_audit_logs,tenant_fiscal_profiles,tenant_ai_usage_monthly,tenant_governance_alerts,tenant_onboarding,tenant_subscriptions }
}

export function projectLegacyCanonicalSnapshot(source, { tenantId, moduleId = 'petshop' } = {}) {
  const tenant_id = text(tenantId)
  const module_id = text(moduleId).toLowerCase()
  if (!tenant_id || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(module_id)) throw new Error('Invalid legacy canonical projection scope.')
  const scope = { tenant_id, module_id }
  const base = projectOperationalSnapshot(source, { tenantId: tenant_id, moduleId: module_id })
  const enriched = enrichCatalog(base.collections, source, scope)
  const appointments = projectAppointmentsV2(enriched, source, scope)
  const collections = {
    ...enriched,
    ...appointments,
    module_settings_extensions: projectSettingsExtension(source, scope),
    ...projectPackageLedger(source, scope),
    ...projectLoyalty(source, scope),
    ...projectCommercialAdmin(source, scope),
    ...projectGrowth(source, scope),
    ...projectSupport(source, scope),
    ...projectGovernanceAndFiscal(source, scope),
  }
  return Object.freeze({
    projection: `${LEGACY_CANONICAL_PROJECTION.name}/${LEGACY_CANONICAL_PROJECTION.version}`,
    source: 'supabase',
    scope,
    collections: sortCollections(collections),
    transient_policy: base.transient_policy,
  })
}
