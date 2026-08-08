import { getBetterAuthSession, type BetterAuthRuntimeBindings } from './auth/betterAuthRuntime'

type CompatBindings = BetterAuthRuntimeBindings & { DB?: D1Database }
type JsonRecord = Record<string, unknown>
type CompatFilter = { op?: unknown; column?: unknown; value?: unknown; operator?: unknown; expression?: unknown }
type CompatOrder = { column?: unknown; ascending?: unknown; nullsFirst?: unknown }
type QueryBody = {
  table?: unknown
  action?: unknown
  columns?: unknown
  payload?: unknown
  filters?: unknown
  orders?: unknown
  limit?: unknown
  range?: unknown
  mode?: unknown
  conflict?: unknown
  returning?: unknown
  count?: unknown
}

type Scope = { tenantId: string; moduleId: string; principalId: string }
type TableConfig = { read: string; write?: string; id?: boolean; readOnly?: boolean }

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/
const SAFE_MODULE = /^[a-z0-9][a-z0-9_-]{0,63}$/
const MAX_ROWS = 1000

const TABLES: Readonly<Record<string, TableConfig>> = Object.freeze({
  clients: { read: 'compat_clients' },
  pets: { read: 'compat_pets', write: 'pets' },
  products: { read: 'compat_products' },
  petshop_services: { read: 'compat_petshop_services' },
  settings: { read: 'tenant_module_settings' },
  appointments: { read: 'compat_appointments' },
  service_delivery_orders: { read: 'compat_service_delivery_orders', write: 'service_delivery_orders' },
  sales: { read: 'compat_sales', readOnly: true },
  sale_items: { read: 'compat_sale_items', readOnly: true },
  sale_payment_splits: { read: 'compat_sale_payment_splits', readOnly: true },
  chat_sessions: { read: 'compat_chat_sessions', write: 'chat_threads' },
  chat_messages: { read: 'compat_chat_messages', write: 'chat_messages' },
  fiscal_documents: { read: 'fiscal_documents', readOnly: true },
  subscription_plans: { read: 'compat_subscription_plans', write: 'subscription_plans' },
  client_subscriptions: { read: 'compat_client_subscriptions', write: 'client_subscriptions' },
  loyalty_settings: { read: 'loyalty_settings', write: 'loyalty_settings', id: false },
  loyalty_points: { read: 'loyalty_points', write: 'loyalty_points' },
  commission_rules: { read: 'commission_rules', write: 'commission_rules' },
  cash_register: { read: 'compat_cash_register', write: 'cash_register' },
  invoices: { read: 'compat_invoices', write: 'invoices' },
  billing_settings: { read: 'billing_settings', write: 'billing_settings', id: false },
  accounting_services: { read: 'accounting_services', write: 'accounting_services' },
  tenant_fiscal_profiles: { read: 'tenant_fiscal_profiles', write: 'tenant_fiscal_profiles', id: false },
  fiscal_audit_logs: { read: 'fiscal_audit_logs', write: 'fiscal_audit_logs' },
  petshop_growth_booking_settings: { read: 'petshop_growth_booking_settings', write: 'petshop_growth_booking_settings', id: false },
  petshop_growth_leads: { read: 'petshop_growth_leads', write: 'petshop_growth_leads' },
  petshop_growth_booking_requests: { read: 'petshop_growth_booking_requests', write: 'petshop_growth_booking_requests' },
  petshop_growth_no_show_policy: { read: 'petshop_growth_no_show_policy', write: 'petshop_growth_no_show_policy', id: false },
  petshop_growth_no_show_events: { read: 'petshop_growth_no_show_events', write: 'petshop_growth_no_show_events' },
  petshop_campaign_logs: { read: 'petshop_campaign_logs', write: 'petshop_campaign_logs' },
  petshop_growth_report_cards: { read: 'petshop_growth_report_cards', write: 'petshop_growth_report_cards' },
  support_threads: { read: 'support_threads', write: 'support_threads' },
  support_messages: { read: 'support_messages', write: 'support_messages' },
  tenant_platform_subscriptions: { read: 'tenant_platform_subscriptions', write: 'tenant_platform_subscriptions' },
  tenant_ai_usage_monthly: { read: 'tenant_ai_usage_monthly', write: 'tenant_ai_usage_monthly', id: false },
})

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { 'cache-control': 'no-store' } })
}

function object(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {}
}

function text(value: unknown): string | null {
  if (value == null) return null
  const normalized = String(value).trim()
  return normalized || null
}

function number(value: unknown, fallback = 0): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function cents(value: unknown): number {
  return Math.max(0, Math.round(number(value) * 100))
}

function milliunits(value: unknown): number {
  return Math.round(number(value) * 1000)
}

function bool(value: unknown): number {
  return value === true || value === 1 || value === '1' ? 1 : 0
}

function epoch(value: unknown, fallback = Date.now()): number {
  if (value == null || value === '') return fallback
  if (typeof value === 'number' && Number.isFinite(value)) return value
  const parsed = Date.parse(String(value))
  return Number.isFinite(parsed) ? parsed : fallback
}

function nullableEpoch(value: unknown): number | null {
  if (value == null || value === '') return null
  const parsed = typeof value === 'number' ? value : Date.parse(String(value))
  return Number.isFinite(parsed) ? parsed : null
}

function jsonText(value: unknown, fallback: unknown): string {
  if (typeof value === 'string') {
    try { JSON.parse(value); return value } catch { return JSON.stringify(fallback) }
  }
  try { return JSON.stringify(value ?? fallback) } catch { return JSON.stringify(fallback) }
}

function parseJson(value: unknown, fallback: unknown): unknown {
  if (typeof value !== 'string') return value ?? fallback
  try { return JSON.parse(value) } catch { return fallback }
}

function iso(ms: unknown): string | null {
  const value = Number(ms)
  return Number.isFinite(value) ? new Date(value).toISOString() : null
}

function statusToCanonical(value: unknown, kind = 'generic'): string {
  const current = String(value ?? '').trim().toLowerCase()
  if (kind === 'appointment') {
    return ({ agendado: 'scheduled', confirmado: 'confirmed', em_andamento: 'in_progress', concluido: 'completed', cancelado: 'cancelled', bloqueado: 'blocked', disponivel: 'available' } as Record<string, string>)[current] || current || 'scheduled'
  }
  if (kind === 'sale') {
    return ({ pendente: 'pending', confirmado: 'confirmed', concluido: 'completed', cancelado: 'cancelled', reembolsado: 'refunded' } as Record<string, string>)[current] || current || 'pending'
  }
  return current || 'active'
}

function normalizeCompatRow(table: string, row: JsonRecord): JsonRecord {
  const next: JsonRecord = { ...row }
  for (const key of ['details', 'bot_metadata', 'service_items', 'subscription_benefits', 'services', 'services_used']) {
    if (key in next) next[key] = parseJson(next[key], key === 'services' || key === 'service_items' ? [] : {})
  }

  if (table === 'loyalty_settings') {
    const extra = object(parseJson(next.data_json, {}))
    return {
      tenant_id: next.tenant_id,
      module_id: next.module_id,
      enabled: Boolean(next.enabled),
      points_per_real: number(next.points_per_currency),
      points_per_service: number(extra.points_per_service),
      redemption_rate: number(next.redemption_rate_cents) / 100,
      expiry_days: number(extra.expiry_days, 365),
      updated_at: iso(next.updated_at_ms),
    }
  }
  if (table === 'loyalty_points') {
    return { ...next, points: number(next.points_delta), created_at: iso(next.created_at_ms), expires_at: null }
  }
  if (table === 'commission_rules') {
    const extra = object(parseJson(next.data_json, {}))
    return {
      ...next,
      ...extra,
      rate: number(next.rate_basis_points) / 100,
      fixed_amount: number(next.fixed_cents) / 100,
      active: next.status === 'active',
      updated_at: iso(next.updated_at_ms),
      created_at: extra.created_at ?? iso(next.updated_at_ms),
    }
  }
  if (table === 'billing_settings') return { ...object(parseJson(next.data_json, {})), tenant_id: next.tenant_id, module_id: next.module_id, updated_at: iso(next.updated_at_ms) }
  if (table === 'accounting_services') return { ...next, amount: number(next.amount_cents) / 100, active: next.status === 'active', data: parseJson(next.data_json, {}), created_at: iso(next.created_at_ms), updated_at: iso(next.updated_at_ms) }
  if (table === 'tenant_fiscal_profiles') return { ...next, auto_update: Boolean(next.auto_update), emit_nfce: Boolean(next.emit_nfce), emit_nfe: Boolean(next.emit_nfe), emit_nfse: Boolean(next.emit_nfse), settings: parseJson(next.settings_json, {}), updated_at: iso(next.updated_at_ms) }
  if (table === 'fiscal_audit_logs') return { ...next, metadata: parseJson(next.metadata_json, {}), created_at: iso(next.created_at_ms) }
  if (table === 'petshop_growth_booking_settings') return { ...next, enabled: Boolean(next.enabled), allow_whatsapp_fallback: Boolean(next.allow_whatsapp_fallback), updated_at: iso(next.updated_at_ms) }
  if (table === 'petshop_growth_booking_requests') return { ...next, need_motodog: Boolean(next.need_motodog), motodog_fee: number(next.motodog_fee_cents) / 100, created_at: iso(next.created_at_ms), updated_at: iso(next.updated_at_ms) }
  if (table === 'petshop_growth_leads') return { ...next, next_followup_at: iso(next.next_followup_at_ms), last_contact_at: iso(next.last_contact_at_ms), created_at: iso(next.created_at_ms), updated_at: iso(next.updated_at_ms) }
  if (table === 'petshop_growth_no_show_policy') return { ...next, require_prepayment: Boolean(next.require_prepayment), prepayment_amount: number(next.prepayment_cents) / 100, updated_at: iso(next.updated_at_ms) }
  if (table === 'petshop_growth_no_show_events') return { ...next, fee_amount: number(next.fee_cents) / 100, created_at: iso(next.created_at_ms) }
  if (table === 'petshop_campaign_logs') return { ...next, ...object(parseJson(next.payload_json, {})), created_at: iso(next.created_at_ms) }
  if (table === 'petshop_growth_report_cards') return { ...next, metrics: parseJson(next.metrics_json, {}), created_at: iso(next.created_at_ms), updated_at: iso(next.updated_at_ms) }
  if (table === 'support_threads') return { ...next, last_message_at: iso(next.last_message_at_ms), created_at: iso(next.created_at_ms), updated_at: iso(next.updated_at_ms) }
  if (table === 'support_messages') return { ...next, created_at: iso(next.created_at_ms) }
  if (table === 'tenant_platform_subscriptions') return { ...next, data: parseJson(next.data_json, {}), started_at: iso(next.started_at_ms), expires_at: iso(next.expires_at_ms), updated_at: iso(next.updated_at_ms) }
  if (table === 'tenant_ai_usage_monthly') return { ...next, updated_at: iso(next.updated_at_ms) }
  return next
}

function canonicalRecord(table: string, raw: JsonRecord, scope: Scope, now = Date.now()): JsonRecord {
  const id = text(raw.id) || crypto.randomUUID()
  const base = { tenant_id: scope.tenantId, module_id: scope.moduleId }

  if (table === 'subscription_plans') return { ...base, id, name: text(raw.name) || '', price_cents: cents(raw.price), billing_cycle: text(raw.billing_cycle) || 'monthly', services_json: jsonText(raw.services, []), status: raw.active === false ? 'inactive' : 'active', created_at_ms: epoch(raw.created_at, now), updated_at_ms: epoch(raw.updated_at, now) }
  if (table === 'client_subscriptions') return { ...base, id, plan_id: text(raw.plan_id), client_id: text(raw.client_id), status: text(raw.status) || 'pending_payment', started_at_ms: epoch(raw.started_at, now), next_billing_date: text(raw.next_billing_date), services_used_json: jsonText(raw.services_used, {}), cancelled_at_ms: nullableEpoch(raw.cancelled_at), created_at_ms: epoch(raw.created_at, now), updated_at_ms: epoch(raw.updated_at, now) }
  if (table === 'loyalty_settings') return { ...base, enabled: raw.enabled === false ? 0 : 1, points_per_currency: Math.max(0, Math.round(number(raw.points_per_real, 1))), redemption_rate_cents: cents(raw.redemption_rate), data_json: jsonText({ points_per_service: number(raw.points_per_service, 10), expiry_days: number(raw.expiry_days, 365) }, {}), updated_at_ms: epoch(raw.updated_at, now) }
  if (table === 'loyalty_points') return { ...base, id, client_id: text(raw.client_id), points_delta: Math.round(number(raw.points)), balance_after: Math.max(0, Math.round(number(raw.balance_after, raw.points))), reason: text(raw.reason), reference_type: text(raw.reference_type), reference_id: text(raw.reference_id), created_at_ms: epoch(raw.created_at, now) }
  if (table === 'commission_rules') {
    const extra = { scope: raw.scope, product_id: raw.product_id, category: raw.category, created_at: raw.created_at }
    return { ...base, id, staff_key: text(raw.staff_key ?? raw.profile_id), service_code: text(raw.service_code), rule_type: text(raw.rule_type) || (number(raw.fixed_amount) > 0 ? 'fixed' : 'percentage'), rate_basis_points: Math.max(0, Math.min(10000, Math.round(number(raw.rate ?? raw.percentage) * 100))), fixed_cents: cents(raw.fixed_amount), status: raw.active === false ? 'inactive' : 'active', data_json: jsonText(extra, {}), updated_at_ms: epoch(raw.updated_at, now) }
  }
  if (table === 'cash_register') return { ...base, id, opened_by: text(raw.opened_by), closed_by: text(raw.closed_by), opening_balance_cents: cents(raw.opening_balance), closing_balance_cents: raw.closing_balance == null ? null : cents(raw.closing_balance), expected_balance_cents: raw.expected_balance == null ? null : cents(raw.expected_balance), difference_cents: raw.difference == null ? null : Math.round(number(raw.difference) * 100), opened_at_ms: epoch(raw.opened_at, now), closed_at_ms: nullableEpoch(raw.closed_at), notes: text(raw.notes) }
  if (table === 'invoices') return { ...base, id, sale_id: text(raw.sale_id), client_id: text(raw.client_id), amount_cents: cents(raw.amount), status: text(raw.status) || 'pending', due_date: text(raw.due_date), paid_at_ms: nullableEpoch(raw.paid_at), customer_phone: text(raw.customer_phone), notes: text(raw.notes), invoice_nfe_url: text(raw.invoice_nfe_url), created_at_ms: epoch(raw.created_at, now), updated_at_ms: epoch(raw.updated_at, now) }
  if (table === 'billing_settings') return { ...base, data_json: jsonText(raw, {}), updated_at_ms: epoch(raw.updated_at, now) }
  if (table === 'accounting_services') return { ...base, id, name: text(raw.name) || '', amount_cents: cents(raw.amount), status: raw.active === false ? 'inactive' : 'active', data_json: jsonText(raw.data, {}), created_at_ms: epoch(raw.created_at, now), updated_at_ms: epoch(raw.updated_at, now) }
  if (table === 'tenant_fiscal_profiles') return { ...base, policy_version_id: text(raw.policy_version_id), mode: text(raw.mode) || 'manual', auto_update: bool(raw.auto_update), nfe_environment: text(raw.nfe_environment) || 'homologacao', fiscal_regime: text(raw.fiscal_regime), issue_series: Math.max(1, Math.round(number(raw.issue_series, 1))), next_invoice_number: Math.max(1, Math.round(number(raw.next_invoice_number, 1))), emit_nfce: bool(raw.emit_nfce), emit_nfe: bool(raw.emit_nfe), emit_nfse: bool(raw.emit_nfse), settings_json: jsonText(raw.settings, {}), updated_at_ms: epoch(raw.updated_at, now) }
  if (table === 'fiscal_audit_logs') return { ...base, id, invoice_id: text(raw.invoice_id), severity: text(raw.severity) || 'info', code: text(raw.code) || 'compat', message: text(raw.message) || '', metadata_json: jsonText(raw.metadata, {}), created_at_ms: epoch(raw.created_at, now) }
  if (table === 'petshop_growth_booking_settings') return { ...base, enabled: raw.enabled === false ? 0 : 1, public_slug: text(raw.public_slug) || `agenda-${scope.tenantId.slice(0, 8)}`, allow_whatsapp_fallback: raw.allow_whatsapp_fallback === false ? 0 : 1, lead_expiration_hours: Math.max(1, Math.round(number(raw.lead_expiration_hours, 6))), intake_message: text(raw.intake_message), updated_at_ms: epoch(raw.updated_at, now) }
  if (table === 'petshop_growth_booking_requests') return { ...base, id, client_id: text(raw.client_id), lead_id: text(raw.lead_id), channel: text(raw.channel) || 'manual', customer_name: text(raw.customer_name) || '', pet_name: text(raw.pet_name), phone: text(raw.phone), service_interest: text(raw.service_interest), preferred_date: text(raw.preferred_date), preferred_period: text(raw.preferred_period), transport_mode: text(raw.transport_mode) || 'dropoff', need_motodog: bool(raw.need_motodog), motodog_fee_cents: cents(raw.motodog_fee), pickup_address: text(raw.pickup_address), pickup_neighborhood: text(raw.pickup_neighborhood), pickup_city: text(raw.pickup_city), status: text(raw.status) || 'pending', notes: text(raw.notes), created_at_ms: epoch(raw.created_at, now), updated_at_ms: epoch(raw.updated_at, now) }
  if (table === 'petshop_growth_leads') return { ...base, id, client_id: text(raw.client_id), source: text(raw.source) || 'manual', stage: text(raw.stage) || 'new', priority: text(raw.priority) || 'normal', owner_name: text(raw.owner_name) || '', pet_name: text(raw.pet_name), phone: text(raw.phone), interest: text(raw.interest), notes: text(raw.notes), next_followup_at_ms: nullableEpoch(raw.next_followup_at), last_contact_at_ms: nullableEpoch(raw.last_contact_at), converted_sale_id: text(raw.converted_sale_id), created_at_ms: epoch(raw.created_at, now), updated_at_ms: epoch(raw.updated_at, now) }
  if (table === 'petshop_growth_no_show_policy') return { ...base, require_prepayment: bool(raw.require_prepayment), prepayment_cents: cents(raw.prepayment_amount), grace_minutes: Math.max(0, Math.round(number(raw.grace_minutes, 15))), max_strikes: Math.max(1, Math.round(number(raw.max_strikes, 2))), auto_block_days: Math.max(0, Math.round(number(raw.auto_block_days, 30))), reminder_minutes_before: Math.max(0, Math.round(number(raw.reminder_minutes_before, 90))), updated_at_ms: epoch(raw.updated_at, now) }
  if (table === 'petshop_growth_no_show_events') return { ...base, id, appointment_id: text(raw.appointment_id), client_id: text(raw.client_id), event_type: text(raw.event_type) || 'no_show', fee_cents: cents(raw.fee_amount), notes: text(raw.notes), created_at_ms: epoch(raw.created_at, now) }
  if (table === 'petshop_campaign_logs') {
    const payload = { audience_name: raw.audience_name, message: raw.message, sent_at: raw.sent_at }
    return { ...base, id, campaign_type: text(raw.campaign_type), client_id: text(raw.client_id), channel: text(raw.channel), status: text(raw.status), payload_json: jsonText(payload, {}), created_at_ms: epoch(raw.created_at ?? raw.sent_at, now) }
  }
  if (table === 'petshop_growth_report_cards') return { ...base, id, period_key: text(raw.period_key) || new Date(now).toISOString().slice(0, 7), metrics_json: jsonText(raw.metrics, {}), created_at_ms: epoch(raw.created_at, now), updated_at_ms: epoch(raw.updated_at, now) }
  if (table === 'support_threads') return { ...base, id, requester_profile_id: text(raw.requester_profile_id) || scope.principalId, status: text(raw.status) || 'pending', priority: text(raw.priority) || 'normal', source: text(raw.source) || 'widget', subject: text(raw.subject), last_message_at_ms: nullableEpoch(raw.last_message_at), created_at_ms: epoch(raw.created_at, now), updated_at_ms: epoch(raw.updated_at, now) }
  if (table === 'support_messages') return { ...base, id, thread_id: text(raw.thread_id), sender_profile_id: text(raw.sender_profile_id), sender_type: text(raw.sender_type) || 'user', body: text(raw.body ?? raw.message) || '', created_at_ms: epoch(raw.created_at, now) }
  if (table === 'tenant_platform_subscriptions') return { ...base, id, plan_id: text(raw.plan_id), status: text(raw.status) || 'active', started_at_ms: epoch(raw.started_at, now), expires_at_ms: nullableEpoch(raw.expires_at), data_json: jsonText(raw.data, {}), updated_at_ms: epoch(raw.updated_at, now) }
  if (table === 'tenant_ai_usage_monthly') return { ...base, month_key: text(raw.month_key) || new Date(now).toISOString().slice(0, 7), request_count: Math.max(0, Math.round(number(raw.request_count))), token_count: Math.max(0, Math.round(number(raw.token_count))), updated_at_ms: epoch(raw.updated_at, now) }
  if (table === 'service_delivery_orders') return { ...base, id, sale_id: text(raw.sale_id), appointment_id: text(raw.appointment_id), client_id: text(raw.client_id), session_id: text(raw.session_id), source: text(raw.source) || 'manual', order_type: text(raw.order_type) || 'servico', status: text(raw.status) || 'pendente', scheduled_for_ms: nullableEpoch(raw.scheduled_for), contact_phone: text(raw.contact_phone), payment_status: text(raw.payment_status), notes: text(raw.notes), delivery_address: text(raw.delivery_address), delivery_neighborhood: text(raw.delivery_neighborhood), delivery_city: text(raw.delivery_city), delivery_reference: text(raw.delivery_reference), transport_mode: text(raw.transport_mode), transport_label: text(raw.transport_label), assigned_staff_key: text(raw.assigned_staff_key), assigned_staff_name: text(raw.assigned_staff_name), delivery_value_cents: cents(raw.delivery_value), created_at_ms: epoch(raw.created_at, now), updated_at_ms: epoch(raw.updated_at, now) }
  if (table === 'chat_sessions') return { ...base, id, channel: text(raw.channel) || 'whatsapp', external_thread_id: text(raw.phone ?? raw.external_thread_id), client_id: text(raw.client_id), pet_id: text(raw.pet_id), status: raw.status === 'human' ? 'handoff' : (text(raw.status) || 'open'), last_message_at_ms: nullableEpoch(raw.last_message_at), created_at_ms: epoch(raw.created_at, now), updated_at_ms: epoch(raw.updated_at, now) }
  if (table === 'chat_messages') {
    const role = text(raw.role) || 'system'
    const actor = role === 'user' ? 'customer' : role === 'human_agent' ? 'human' : role === 'assistant' ? 'assistant' : 'system'
    return { ...base, id, thread_id: text(raw.session_id ?? raw.thread_id), external_message_id: text(raw.external_message_id), direction: actor === 'customer' ? 'inbound' : 'outbound', actor_type: actor, content_text: text(raw.content) || '', content_json: raw.content_json == null ? null : jsonText(raw.content_json, {}), created_at_ms: epoch(raw.created_at ?? raw.sent_at, now) }
  }
  if (table === 'pets') return { ...base, id, client_id: text(raw.client_id), name: text(raw.pet_name ?? raw.name) || '', species: text(raw.species) || 'other', breed: text(raw.breed), birth_date: text(raw.birth_date), weight_kg: raw.weight_kg == null ? null : number(raw.weight_kg), color: text(raw.color), notes: text(raw.notes), status: raw.active === false ? 'inactive' : 'active', created_at_ms: epoch(raw.created_at, now), updated_at_ms: epoch(raw.updated_at, now) }
  return { ...base, ...raw, id }
}

async function resolveScope(request: Request, bindings: CompatBindings): Promise<{ scope?: Scope; error?: Response }> {
  if (!bindings.DB) return { error: json({ code: 'DATABASE_NOT_CONFIGURED' }, 503) }
  const tenantId = String(request.headers.get('x-tenant-id') || '').trim()
  const moduleId = String(request.headers.get('x-module-id') || '').trim().toLowerCase()
  if (!SAFE_ID.test(tenantId) || !SAFE_MODULE.test(moduleId)) return { error: json({ code: 'INVALID_SCOPE' }, 400) }

  const session = await getBetterAuthSession(request, bindings)
  const userId = text(session?.user?.id)
  if (!userId) return { error: json({ code: 'UNAUTHENTICATED' }, 401) }

  const principal = await bindings.DB.prepare(`SELECT id FROM identity_principals WHERE provider='better-auth' AND subject=?1 AND status='active' LIMIT 1`).bind(userId).first<{ id: string }>()
  if (!principal?.id) return { error: json({ code: 'FORBIDDEN' }, 403) }

  const membership = await bindings.DB.prepare(`SELECT role,module_permissions_json FROM tenant_memberships WHERE tenant_id=?1 AND principal_id=?2 AND status='active' LIMIT 1`).bind(tenantId, principal.id).first<{ role: string; module_permissions_json: string }>()
  if (!membership) return { error: json({ code: 'FORBIDDEN' }, 403) }

  let allowed = membership.role === 'owner' || membership.role === 'admin'
  try {
    const permissions = object(JSON.parse(membership.module_permissions_json || '{}'))
    allowed ||= permissions['*'] === true || permissions[moduleId] === true || (permissions[moduleId] != null && typeof permissions[moduleId] === 'object')
  } catch { /* malformed permissions deny non-admin access */ }
  if (!allowed) return { error: json({ code: 'FORBIDDEN' }, 403) }
  return { scope: { tenantId, moduleId, principalId: principal.id } }
}

function filtersOf(raw: unknown): CompatFilter[] {
  return Array.isArray(raw) ? raw.filter((item) => item && typeof item === 'object') as CompatFilter[] : []
}

function ordersOf(raw: unknown): CompatOrder[] {
  return Array.isArray(raw) ? raw.filter((item) => item && typeof item === 'object') as CompatOrder[] : []
}

function assertScopeFilters(filters: CompatFilter[], scope: Scope): void {
  for (const filter of filters) {
    const column = String(filter.column || '')
    if (filter.op !== 'eq' || (column !== 'tenant_id' && column !== 'module_id')) continue
    const expected = column === 'tenant_id' ? scope.tenantId : scope.moduleId
    if (String(filter.value ?? '') !== expected) throw new Error('SCOPE_MISMATCH')
  }
}

function buildWhere(filters: CompatFilter[], scope: Scope): { sql: string; values: unknown[] } {
  assertScopeFilters(filters, scope)
  const clauses = ['tenant_id = ?', 'module_id = ?']
  const values: unknown[] = [scope.tenantId, scope.moduleId]
  for (const filter of filters) {
    const op = String(filter.op || '')
    const column = String(filter.column || '')
    if (column === 'tenant_id' || column === 'module_id') continue
    if (op === 'or') {
      const expression = String(filter.expression || '')
      const parts = expression.split(',').map((part) => part.trim()).filter(Boolean)
      const local: string[] = []
      for (const part of parts) {
        const match = /^([A-Za-z_][A-Za-z0-9_]*)\.(eq|neq|gt|gte|lt|lte|ilike|is)\.(.*)$/.exec(part)
        if (!match) throw new Error('INVALID_FILTER')
        const [, orColumn, orOp, rawValue] = match
        const built = simpleClause(orColumn, orOp, rawValue === 'null' ? null : rawValue, values)
        local.push(built)
      }
      if (local.length) clauses.push(`(${local.join(' OR ')})`)
      continue
    }
    if (!IDENTIFIER.test(column)) throw new Error('INVALID_FILTER')
    if (op === 'in') {
      const items = Array.isArray(filter.value) ? filter.value.slice(0, MAX_ROWS) : []
      if (!items.length) { clauses.push('1 = 0'); continue }
      clauses.push(`${column} IN (${items.map(() => '?').join(',')})`)
      values.push(...items.map((value) => scalar(value)))
      continue
    }
    if (op === 'contains') {
      clauses.push(`instr(CAST(${column} AS TEXT), ?) > 0`)
      values.push(typeof filter.value === 'string' ? filter.value : jsonText(filter.value, null))
      continue
    }
    if (op === 'not') {
      const nested = String(filter.operator || '')
      if (nested === 'is' && filter.value == null) { clauses.push(`${column} IS NOT NULL`); continue }
      const inner = simpleClause(column, nested, filter.value, values)
      clauses.push(`NOT (${inner})`)
      continue
    }
    clauses.push(simpleClause(column, op, filter.value, values))
  }
  return { sql: clauses.join(' AND '), values }
}

function scalar(value: unknown): string | number | null {
  if (value == null) return null
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0
  if (typeof value === 'boolean') return value ? 1 : 0
  return String(value)
}

function simpleClause(column: string, op: string, value: unknown, values: unknown[]): string {
  if (!IDENTIFIER.test(column)) throw new Error('INVALID_FILTER')
  if (op === 'is' && value == null) return `${column} IS NULL`
  const sqlOp = ({ eq: '=', neq: '<>', gt: '>', gte: '>=', lt: '<', lte: '<=', ilike: 'LIKE' } as Record<string, string>)[op]
  if (!sqlOp) throw new Error('INVALID_FILTER')
  if (op === 'ilike') {
    values.push(String(value ?? '').toLowerCase())
    return `LOWER(CAST(${column} AS TEXT)) LIKE ?`
  }
  values.push(scalar(value))
  return `${column} ${sqlOp} ?`
}

function buildOrder(orders: CompatOrder[]): string {
  const parts: string[] = []
  for (const order of orders.slice(0, 5)) {
    const column = String(order.column || '')
    if (!IDENTIFIER.test(column)) throw new Error('INVALID_ORDER')
    parts.push(`${column} ${order.ascending === false ? 'DESC' : 'ASC'}`)
  }
  return parts.length ? ` ORDER BY ${parts.join(', ')}` : ''
}

function pagination(body: QueryBody): { limit: number; offset: number } {
  const range = object(body.range)
  if (Object.keys(range).length) {
    const from = Math.max(0, Math.trunc(number(range.from)))
    const to = Math.max(from, Math.trunc(number(range.to, from)))
    return { limit: Math.min(MAX_ROWS, to - from + 1), offset: from }
  }
  return { limit: Math.min(MAX_ROWS, Math.max(0, Math.trunc(number(body.limit, 200))) || 200), offset: 0 }
}

async function readSettings(database: D1Database, scope: Scope): Promise<JsonRecord[]> {
  const core = await database.prepare(`SELECT * FROM tenant_module_settings WHERE tenant_id=?1 AND module_id=?2 LIMIT 1`).bind(scope.tenantId, scope.moduleId).first<JsonRecord>()
  if (!core) return []
  const ext = await database.prepare(`SELECT data_json FROM module_settings_extensions WHERE tenant_id=?1 AND module_id=?2 LIMIT 1`).bind(scope.tenantId, scope.moduleId).first<{ data_json: string }>()
  return [{ ...object(parseJson(ext?.data_json, {})), ...core, created_at: iso(core.created_at_ms), updated_at: iso(core.updated_at_ms) }]
}

async function selectRows(database: D1Database, table: string, config: TableConfig, body: QueryBody, scope: Scope): Promise<{ rows: JsonRecord[]; count: number }> {
  if (table === 'settings') {
    const all = await readSettings(database, scope)
    return { rows: all, count: all.length }
  }
  const filters = filtersOf(body.filters)
  const where = buildWhere(filters, scope)
  const order = buildOrder(ordersOf(body.orders))
  const page = pagination(body)
  const statement = database.prepare(`SELECT * FROM ${config.read} WHERE ${where.sql}${order} LIMIT ? OFFSET ?`).bind(...where.values, page.limit, page.offset)
  const result = await statement.all<JsonRecord>()
  const countResult = await database.prepare(`SELECT COUNT(*) AS count FROM ${config.read} WHERE ${where.sql}`).bind(...where.values).first<{ count: number }>()
  const rows = result.results.map((row) => normalizeCompatRow(table, row))
  await enrichRelations(database, table, String(body.columns || '*'), rows, scope)
  return { rows, count: Number(countResult?.count || 0) }
}

async function enrichRelations(database: D1Database, table: string, columns: string, rows: JsonRecord[], scope: Scope): Promise<void> {
  if (!rows.length) return
  const wantsClients = /(?:^|,)\s*clients\s*\(/.test(columns)
  if (wantsClients) {
    const ids = [...new Set(rows.map((row) => text(row.client_id)).filter((value): value is string => Boolean(value)))]
    if (ids.length) {
      const placeholders = ids.map(() => '?').join(',')
      const result = await database.prepare(`SELECT * FROM compat_clients WHERE tenant_id=? AND module_id=? AND id IN (${placeholders})`).bind(scope.tenantId, scope.moduleId, ...ids).all<JsonRecord>()
      const map = new Map(result.results.map((row) => [String(row.id), normalizeCompatRow('clients', row)]))
      for (const row of rows) row.clients = map.get(String(row.client_id || '')) || null
    }
  }
  if (table === 'clients' && /appointments\s*\(/.test(columns)) {
    const ids = rows.map((row) => String(row.id || '')).filter(Boolean)
    if (ids.length) {
      const placeholders = ids.map(() => '?').join(',')
      const result = await database.prepare(`SELECT * FROM compat_appointments WHERE tenant_id=? AND module_id=? AND pet_id IN (${placeholders}) ORDER BY scheduled_at DESC`).bind(scope.tenantId, scope.moduleId, ...ids).all<JsonRecord>()
      const grouped = new Map<string, JsonRecord[]>()
      for (const appointment of result.results) {
        const key = String(appointment.pet_id || '')
        grouped.set(key, [...(grouped.get(key) || []), normalizeCompatRow('appointments', appointment)])
      }
      for (const row of rows) row.appointments = grouped.get(String(row.id || '')) || []
    }
  }
  if (table === 'client_subscriptions' && /subscription_plans\s*\(/.test(columns)) {
    const ids = [...new Set(rows.map((row) => text(row.plan_id)).filter((value): value is string => Boolean(value)))]
    if (ids.length) {
      const placeholders = ids.map(() => '?').join(',')
      const result = await database.prepare(`SELECT * FROM compat_subscription_plans WHERE tenant_id=? AND module_id=? AND id IN (${placeholders})`).bind(scope.tenantId, scope.moduleId, ...ids).all<JsonRecord>()
      const map = new Map(result.results.map((row) => [String(row.id), normalizeCompatRow('subscription_plans', row)]))
      for (const row of rows) row.subscription_plans = map.get(String(row.plan_id || '')) || null
    }
  }
  if (table === 'service_delivery_orders' && /sales\s*\(/.test(columns)) {
    const ids = [...new Set(rows.map((row) => text(row.sale_id)).filter((value): value is string => Boolean(value)))]
    if (ids.length) {
      const placeholders = ids.map(() => '?').join(',')
      const result = await database.prepare(`SELECT * FROM compat_sales WHERE tenant_id=? AND module_id=? AND id IN (${placeholders})`).bind(scope.tenantId, scope.moduleId, ...ids).all<JsonRecord>()
      const map = new Map(result.results.map((row) => [String(row.id), normalizeCompatRow('sales', row)]))
      for (const row of rows) row.sales = map.get(String(row.sale_id || '')) || null
    }
  }
}

function canonicalUpdatePatch(table: string, raw: JsonRecord, scope: Scope): JsonRecord {
  const canonical = canonicalRecord(table, raw, scope)
  delete canonical.tenant_id
  delete canonical.module_id
  delete canonical.id
  for (const key of ['created_at_ms', 'opened_at_ms', 'started_at_ms']) {
    if (!(key.replace(/_ms$/, '') in raw) && !(`${key.replace(/_ms$/, '')}_at` in raw)) delete canonical[key]
  }
  return canonical
}

async function mutateSettings(database: D1Database, raw: JsonRecord, scope: Scope): Promise<void> {
  const now = Date.now()
  const coreKeys = new Set(['store_name', 'store_phone', 'store_address', 'store_neighborhood', 'store_city', 'bot_prompt'])
  const core: JsonRecord = {}
  const extension: JsonRecord = {}
  for (const [key, value] of Object.entries(raw)) {
    if (['tenant_id', 'module_id', 'created_at', 'updated_at', 'created_at_ms', 'updated_at_ms'].includes(key)) continue
    if (coreKeys.has(key)) core[key] = value == null ? '' : String(value)
    else extension[key] = value
  }
  const existing = await database.prepare(`SELECT data_json FROM module_settings_extensions WHERE tenant_id=?1 AND module_id=?2`).bind(scope.tenantId, scope.moduleId).first<{ data_json: string }>()
  const merged = { ...object(parseJson(existing?.data_json, {})), ...extension }
  const statements: D1PreparedStatement[] = []
  if (Object.keys(core).length) {
    const columns = Object.keys(core)
    const assignments = columns.map((key) => `${key}=?`).join(',')
    statements.push(database.prepare(`UPDATE tenant_module_settings SET ${assignments},version=version+1,updated_at_ms=? WHERE tenant_id=? AND module_id=?`).bind(...columns.map((key) => scalar(core[key])), now, scope.tenantId, scope.moduleId))
  }
  statements.push(database.prepare(`INSERT INTO module_settings_extensions(tenant_id,module_id,data_json,version,updated_at_ms) VALUES(?1,?2,?3,1,?4) ON CONFLICT(tenant_id,module_id) DO UPDATE SET data_json=excluded.data_json,version=module_settings_extensions.version+1,updated_at_ms=excluded.updated_at_ms`).bind(scope.tenantId, scope.moduleId, JSON.stringify(merged), now))
  await database.batch(statements)
}

async function mutateClients(database: D1Database, action: string, body: QueryBody, scope: Scope): Promise<void> {
  const rows = Array.isArray(body.payload) ? body.payload.map(object) : [object(body.payload)]
  const filters = filtersOf(body.filters)
  assertScopeFilters(filters, scope)
  const idFilter = filters.find((filter) => filter.op === 'eq' && filter.column === 'id')
  if (action === 'delete') {
    const petId = text(idFilter?.value)
    if (!petId) throw new Error('WRITE_REQUIRES_ID')
    await database.prepare(`UPDATE pets SET status='inactive',updated_at_ms=?1 WHERE tenant_id=?2 AND module_id=?3 AND id=?4`).bind(Date.now(), scope.tenantId, scope.moduleId, petId).run()
    return
  }
  for (const raw of rows) {
    const now = Date.now()
    const currentPetId = text(idFilter?.value) || text(raw.id) || crypto.randomUUID()
    const existing = await database.prepare(`SELECT client_id FROM pets WHERE tenant_id=?1 AND module_id=?2 AND id=?3`).bind(scope.tenantId, scope.moduleId, currentPetId).first<{ client_id: string }>()
    const details = object(raw.details)
    const clientId = text(details.tutor_group_id) || existing?.client_id || text(raw.client_id) || crypto.randomUUID()
    const clientValues = {
      name: text(raw.name) || 'Cliente', document: text(raw.document), phone: text(raw.phone), email: text(raw.email), birth_date: text(details.tutor_birth_date),
      address: text(raw.address), address_number: text(details.address_number), address_complement: text(details.address_complement), address_reference: text(details.address_reference), neighborhood: text(raw.neighborhood), city: text(raw.city), postal_code: text(details.zip_code), notes: text(raw.notes), status: raw.active === false ? 'inactive' : 'active',
    }
    await database.batch([
      database.prepare(`INSERT INTO clients(tenant_id,module_id,id,name,document,phone,email,birth_date,address,address_number,address_complement,address_reference,neighborhood,city,postal_code,notes,status,created_at_ms,updated_at_ms) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(tenant_id,module_id,id) DO UPDATE SET name=excluded.name,document=excluded.document,phone=excluded.phone,email=excluded.email,birth_date=excluded.birth_date,address=excluded.address,address_number=excluded.address_number,address_complement=excluded.address_complement,address_reference=excluded.address_reference,neighborhood=excluded.neighborhood,city=excluded.city,postal_code=excluded.postal_code,notes=excluded.notes,status=excluded.status,updated_at_ms=excluded.updated_at_ms`).bind(scope.tenantId, scope.moduleId, clientId, ...Object.values(clientValues), epoch(raw.created_at, now), now),
      database.prepare(`INSERT INTO pets(tenant_id,module_id,id,client_id,name,species,breed,birth_date,weight_kg,color,notes,status,created_at_ms,updated_at_ms) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(tenant_id,module_id,id) DO UPDATE SET client_id=excluded.client_id,name=excluded.name,species=excluded.species,breed=excluded.breed,birth_date=excluded.birth_date,weight_kg=excluded.weight_kg,color=excluded.color,notes=excluded.notes,status=excluded.status,updated_at_ms=excluded.updated_at_ms`).bind(scope.tenantId, scope.moduleId, currentPetId, clientId, text(details.pet_name) || '', text(details.species) || 'other', text(details.breed), text(details.birth_date), details.weight_kg == null ? null : number(details.weight_kg), text(details.color), text(details.pet_notes), raw.active === false ? 'inactive' : 'active', epoch(raw.created_at, now), now),
    ])
  }
}

async function mutateProducts(database: D1Database, action: string, body: QueryBody, scope: Scope): Promise<void> {
  const filters = filtersOf(body.filters); assertScopeFilters(filters, scope)
  const idFilter = filters.find((filter) => filter.op === 'eq' && filter.column === 'id')
  if (action === 'delete') {
    const id = text(idFilter?.value); if (!id) throw new Error('WRITE_REQUIRES_ID')
    await database.prepare(`UPDATE catalog_products SET status='inactive',updated_at_ms=? WHERE tenant_id=? AND module_id=? AND id=?`).bind(Date.now(), scope.tenantId, scope.moduleId, id).run(); return
  }
  const rows = Array.isArray(body.payload) ? body.payload.map(object) : [object(body.payload)]
  for (const raw of rows) {
    const now = Date.now(); const id = text(idFilter?.value) || text(raw.id) || crypto.randomUUID()
    const existing = await database.prepare(`SELECT * FROM catalog_products WHERE tenant_id=?1 AND module_id=?2 AND id=?3`).bind(scope.tenantId, scope.moduleId, id).first<JsonRecord>()
    const merged = { ...existing, ...raw }
    await database.batch([
      database.prepare(`INSERT INTO catalog_products(tenant_id,module_id,id,name,barcode,category,description,price_cents,cost_cents,species_target,upsell_product_id,image_url,bot_metadata_json,status,created_at_ms,updated_at_ms) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(tenant_id,module_id,id) DO UPDATE SET name=excluded.name,barcode=excluded.barcode,category=excluded.category,description=excluded.description,price_cents=excluded.price_cents,cost_cents=excluded.cost_cents,species_target=excluded.species_target,upsell_product_id=excluded.upsell_product_id,image_url=excluded.image_url,bot_metadata_json=excluded.bot_metadata_json,status=excluded.status,updated_at_ms=excluded.updated_at_ms`).bind(scope.tenantId, scope.moduleId, id, text(merged.name) || '', text(merged.barcode), text(merged.category), text(merged.description), cents(merged.price), cents(merged.cost_price), text(merged.species_target), text(merged.upsell_product_id), text(merged.image_url), jsonText(merged.bot_metadata, {}), merged.active === false ? 'inactive' : 'active', epoch(merged.created_at, now), now),
      database.prepare(`INSERT INTO inventory_balances(tenant_id,module_id,product_id,on_hand_milliunits,reorder_milliunits,updated_at_ms) VALUES(?,?,?,?,?,?) ON CONFLICT(tenant_id,module_id,product_id) DO UPDATE SET on_hand_milliunits=excluded.on_hand_milliunits,reorder_milliunits=excluded.reorder_milliunits,updated_at_ms=excluded.updated_at_ms`).bind(scope.tenantId, scope.moduleId, id, milliunits(merged.stock_quantity), milliunits(merged.min_stock), now),
    ])
  }
}

async function mutateServices(database: D1Database, action: string, body: QueryBody, scope: Scope): Promise<void> {
  const filters = filtersOf(body.filters); assertScopeFilters(filters, scope)
  const idFilter = filters.find((filter) => filter.op === 'eq' && filter.column === 'id')
  if (action === 'delete') {
    const id = text(idFilter?.value); if (!id) throw new Error('WRITE_REQUIRES_ID')
    await database.prepare(`UPDATE services SET status='inactive',updated_at_ms=? WHERE tenant_id=? AND module_id=? AND id=?`).bind(Date.now(), scope.tenantId, scope.moduleId, id).run(); return
  }
  const rows = Array.isArray(body.payload) ? body.payload.map(object) : [object(body.payload)]
  for (const raw of rows) {
    const now = Date.now(); const id = text(idFilter?.value) || text(raw.id) || crypto.randomUUID()
    const existing = await database.prepare(`SELECT * FROM services WHERE tenant_id=?1 AND module_id=?2 AND id=?3`).bind(scope.tenantId, scope.moduleId, id).first<JsonRecord>()
    const merged = { ...existing, ...raw }
    await database.prepare(`INSERT INTO services(tenant_id,module_id,id,code,name,category,description,group_type,default_price_cents,default_duration_min,commission_type,commission_basis_points,sort_order,icon,source_product_id,status,created_at_ms,updated_at_ms) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(tenant_id,module_id,id) DO UPDATE SET code=excluded.code,name=excluded.name,category=excluded.category,description=excluded.description,group_type=excluded.group_type,default_price_cents=excluded.default_price_cents,default_duration_min=excluded.default_duration_min,commission_type=excluded.commission_type,commission_basis_points=excluded.commission_basis_points,sort_order=excluded.sort_order,icon=excluded.icon,source_product_id=excluded.source_product_id,status=excluded.status,updated_at_ms=excluded.updated_at_ms`).bind(scope.tenantId, scope.moduleId, id, text(merged.code) || id, text(merged.name) || '', text(merged.category), text(merged.description), text(merged.group_type) || 'outro', cents(merged.default_price), Math.max(15, Math.round(number(merged.default_duration_min, 60))), 'percentage', Math.max(0, Math.min(10000, Math.round(number(merged.commission_rate) * 100))), Math.round(number(merged.sort_order, 999)), text(merged.icon), text(merged.source_product_id), merged.active === false ? 'inactive' : 'active', epoch(merged.created_at, now), now).run()
  }
}

async function genericMutation(database: D1Database, table: string, config: TableConfig, action: string, body: QueryBody, scope: Scope): Promise<void> {
  if (!config.write || config.readOnly) throw new Error('WRITE_NOT_SUPPORTED')
  const filters = filtersOf(body.filters); const where = buildWhere(filters, scope)
  if (action === 'delete') {
    await database.prepare(`DELETE FROM ${config.write} WHERE ${where.sql}`).bind(...where.values).run(); return
  }
  const rows = Array.isArray(body.payload) ? body.payload.map(object) : [object(body.payload)]
  if (action === 'update') {
    if (!filters.some((filter) => filter.column === 'id') && config.id !== false) throw new Error('WRITE_REQUIRES_ID')
    const patch = canonicalUpdatePatch(table, rows[0] || {}, scope)
    const entries = Object.entries(patch).filter(([key]) => IDENTIFIER.test(key))
    if (!entries.length) return
    await database.prepare(`UPDATE ${config.write} SET ${entries.map(([key]) => `${key}=?`).join(',')} WHERE ${where.sql}`).bind(...entries.map(([, value]) => scalarOrJson(value)), ...where.values).run(); return
  }
  for (const raw of rows) {
    const record = canonicalRecord(table, raw, scope)
    const entries = Object.entries(record).filter(([key]) => IDENTIFIER.test(key) && valueSupported(record[key]))
    const columns = entries.map(([key]) => key)
    const placeholders = entries.map(() => '?').join(',')
    let sql = `INSERT INTO ${config.write}(${columns.join(',')}) VALUES(${placeholders})`
    if (action === 'upsert') {
      const requested = String(body.conflict || '').split(',').map((value) => value.trim()).filter((value) => IDENTIFIER.test(value))
      const conflicts = [...new Set(['tenant_id', 'module_id', ...requested, ...(config.id === false ? [] : ['id'])])]
      const updateColumns = columns.filter((column) => !conflicts.includes(column))
      sql += ` ON CONFLICT(${conflicts.join(',')}) DO UPDATE SET ${updateColumns.map((column) => `${column}=excluded.${column}`).join(',')}`
    }
    await database.prepare(sql).bind(...entries.map(([, value]) => scalarOrJson(value))).run()
  }
}

function valueSupported(value: unknown): boolean {
  return value == null || ['string', 'number', 'boolean'].includes(typeof value) || typeof value === 'object'
}

function scalarOrJson(value: unknown): string | number | null {
  if (value == null) return null
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0
  if (typeof value === 'boolean') return value ? 1 : 0
  if (typeof value === 'string') return value
  return jsonText(value, {})
}

async function handleQuery(request: Request, bindings: CompatBindings): Promise<Response> {
  const resolved = await resolveScope(request, bindings)
  if (resolved.error || !resolved.scope) return resolved.error || json({ code: 'FORBIDDEN' }, 403)
  let body: QueryBody
  try { body = await request.json() as QueryBody } catch { return json({ code: 'INVALID_JSON' }, 400) }
  const table = String(body.table || '').trim()
  const config = TABLES[table]
  if (!config) return json({ code: 'COMPAT_TABLE_NOT_ALLOWED', table }, 400)
  const action = String(body.action || 'select').toLowerCase()
  if (!['select', 'insert', 'update', 'upsert', 'delete'].includes(action)) return json({ code: 'INVALID_ACTION' }, 400)

  try {
    if (action !== 'select') {
      if (table === 'settings') await mutateSettings(bindings.DB!, object(body.payload), resolved.scope)
      else if (table === 'clients') await mutateClients(bindings.DB!, action, body, resolved.scope)
      else if (table === 'products') await mutateProducts(bindings.DB!, action, body, resolved.scope)
      else if (table === 'petshop_services') await mutateServices(bindings.DB!, action, body, resolved.scope)
      else await genericMutation(bindings.DB!, table, config, action, body, resolved.scope)
    }
    const selected = await selectRows(bindings.DB!, table, config, body, resolved.scope)
    const mode = String(body.mode || 'many')
    if (mode === 'single') {
      if (selected.rows.length !== 1) return json({ code: 'ROW_NOT_SINGLE', count: selected.count }, 406)
      return json({ data: selected.rows[0], count: selected.count })
    }
    if (mode === 'maybeSingle') {
      if (selected.rows.length > 1) return json({ code: 'ROW_NOT_SINGLE', count: selected.count }, 406)
      return json({ data: selected.rows[0] || null, count: selected.count })
    }
    return json({ data: selected.rows, count: selected.count })
  } catch (error) {
    const code = error instanceof Error ? error.message : 'COMPAT_QUERY_FAILED'
    if (['SCOPE_MISMATCH', 'INVALID_FILTER', 'INVALID_ORDER', 'WRITE_REQUIRES_ID', 'WRITE_NOT_SUPPORTED'].includes(code)) return json({ code }, 400)
    console.error('compat.query.failed', { table, action, code })
    return json({ code: 'COMPAT_QUERY_FAILED' }, 500)
  }
}

async function handleRpc(request: Request, bindings: CompatBindings): Promise<Response> {
  const resolved = await resolveScope(request, bindings)
  if (resolved.error || !resolved.scope) return resolved.error || json({ code: 'FORBIDDEN' }, 403)
  let body: { name?: unknown; args?: unknown }
  try { body = await request.json() as { name?: unknown; args?: unknown } } catch { return json({ code: 'INVALID_JSON' }, 400) }
  const name = String(body.name || '').trim()
  const allowed = new Set(['calculate_petshop_operational_commissions', 'calculate_petshop_commissions_v2', 'calculate_commissions'])
  if (!allowed.has(name)) return json({ code: 'COMPAT_RPC_NOT_ALLOWED', name }, 400)
  const args = object(body.args)
  const tenantArg = text(args.p_tenant_id)
  const moduleArg = text(args.p_module_id)?.toLowerCase()
  if (tenantArg && tenantArg !== resolved.scope.tenantId) return json({ code: 'SCOPE_MISMATCH' }, 400)
  if (moduleArg && moduleArg !== resolved.scope.moduleId) return json({ code: 'SCOPE_MISMATCH' }, 400)
  const start = nullableEpoch(args.p_start) ?? 0
  const end = nullableEpoch(args.p_end) ?? Date.now()
  const result = await bindings.DB!.prepare(`
    SELECT
      COALESCE(a.responsible_staff_key,a.groomer_id,a.employee_id,'unassigned') AS staff_key,
      COALESCE(a.responsible_staff_name,a.responsible_staff_key,a.groomer_id,a.employee_id,'Nao atribuido') AS collaborator_name,
      COUNT(*) AS service_count,
      SUM(CASE WHEN a.service_group='banho_tosa' THEN 1 ELSE 0 END) AS grooming_count,
      SUM(CASE WHEN a.service_group<>'banho_tosa' OR a.service_group IS NULL THEN 1 ELSE 0 END) AS other_service_count,
      SUM(a.subtotal_cents)/100.0 AS service_revenue,
      SUM(CASE WHEN a.service_group='banho_tosa' THEN a.subtotal_cents ELSE 0 END)/100.0 AS grooming_revenue,
      SUM(CASE WHEN a.service_group<>'banho_tosa' OR a.service_group IS NULL THEN a.subtotal_cents ELSE 0 END)/100.0 AS other_service_revenue,
      0.0 AS grooming_commission,
      0.0 AS other_service_commission,
      0.0 AS total_commission,
      0 AS sales_count,
      0 AS motoboy_count,
      0.0 AS sales_revenue,
      0.0 AS motoboy_revenue,
      0.0 AS sales_commission,
      0.0 AS motoboy_commission
    FROM appointments a
    WHERE a.tenant_id=?1 AND a.module_id=?2 AND a.status='completed' AND a.scheduled_at_ms BETWEEN ?3 AND ?4
    GROUP BY 1,2 ORDER BY service_revenue DESC,collaborator_name
  `).bind(resolved.scope.tenantId, resolved.scope.moduleId, start, end).all<JsonRecord>()
  return json({ data: result.results })
}

export async function handleCompatApiRequest(request: Request, bindings: CompatBindings): Promise<Response | null> {
  const pathname = new URL(request.url).pathname
  if (pathname === '/api/compat/query' && request.method === 'POST') return handleQuery(request, bindings)
  if (pathname === '/api/compat/rpc' && request.method === 'POST') return handleRpc(request, bindings)
  if (pathname.startsWith('/api/compat/')) return json({ code: 'NOT_FOUND' }, 404)
  return null
}

export const COMPAT_TABLE_NAMES = Object.freeze(Object.keys(TABLES))
