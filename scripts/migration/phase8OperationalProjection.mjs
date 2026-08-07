import { createHash } from 'node:crypto'

export const OPERATIONAL_PROJECTION = Object.freeze({ name: 'phase8-operational', version: 'v1' })
export const TRANSIENT_COLLECTIONS = Object.freeze(['financial_effects','operation_checkpoints','operation_effects','effect_outbox'])

const PAYMENT_METHODS = new Map([['pix','pix'],['dinheiro','cash'],['cash','cash'],['cartao','card'],['cartão','card'],['card','card']])
const APPOINTMENT_STATUS = new Map([
  ['agendado','scheduled'],['scheduled','scheduled'],['booked','scheduled'],['confirmado','confirmed'],['confirmed','confirmed'],
  ['em_andamento','in_progress'],['in_progress','in_progress'],['concluido','completed'],['concluído','completed'],['completed','completed'],
  ['cancelado','cancelled'],['cancelled','cancelled'],['bloqueado','blocked'],['blocked','blocked'],['disponivel','available'],['available','available'],['livre','available'],
])
const SALE_STATUS = new Map([
  ['pendente','pending'],['pending','pending'],['confirmado','confirmed'],['confirmed','confirmed'],['concluido','completed'],['concluído','completed'],
  ['completed','completed'],['cancelado','cancelled'],['cancelled','cancelled'],['reembolsado','refunded'],['refunded','refunded'],
])
const MOVEMENT_TYPES = new Map([
  ['sale','sale'],['venda','sale'],['purchase','purchase'],['compra','purchase'],['adjustment','adjustment'],['ajuste','adjustment'],
  ['return','return'],['devolucao','return'],['devolução','return'],['reservation','reservation'],['reserva','reservation'],
  ['release','release'],['liberacao','release'],['liberação','release'],
])

function arr(value) { return Array.isArray(value) ? value : [] }
function text(value, fallback = '') { const v = value == null ? '' : String(value).trim(); return v || fallback }
function nullable(value) { const v = text(value); return v || null }
function bool(value, fallback = false) { return value == null ? fallback : value === true || value === 1 || String(value).toLowerCase() === 'true' }
function finite(value, fallback = 0) { const n = Number(value); return Number.isFinite(n) ? n : fallback }
function cents(value) { return Math.max(0, Math.round((finite(value, 0) + Number.EPSILON) * 100)) }
function milli(value) { return Math.round((finite(value, 0) + Number.EPSILON) * 1000) }
function ms(value, fallback = 0) { const n = Date.parse(String(value || '')); return Number.isFinite(n) ? n : fallback }
function json(value, fallback) { try { return JSON.stringify(value ?? fallback) } catch { return JSON.stringify(fallback) } }
function stableId(prefix, key) { return `${prefix}_${createHash('sha256').update(String(key)).digest('hex').slice(0, 32)}` }
function normalizeModule(row, moduleId) { return text(row?.module_id, moduleId).toLowerCase() }
function inScope(row, tenantId, moduleId) { return text(row?.tenant_id) === tenantId && normalizeModule(row, moduleId) === moduleId }
function rows(source, name, tenantId, moduleId) { return arr(source?.tables?.[name]).filter((row) => inScope(row, tenantId, moduleId)) }
function first(source, name, tenantId, moduleId) { return rows(source, name, tenantId, moduleId)[0] || null }

function parseJson(value, fallback) {
  if (value == null) return fallback
  if (typeof value === 'object') return value
  try { return JSON.parse(String(value)) } catch { return fallback }
}

function timeMinutes(value) {
  const match = /^(\d{1,2}):(\d{2})/.exec(text(value))
  if (!match) return null
  const hours = Number(match[1]); const minutes = Number(match[2])
  return hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59 ? hours * 60 + minutes : null
}

function projectCatalog(source, scope) {
  const products = rows(source, 'products', scope.tenant_id, scope.module_id).map((row) => ({
    tenant_id: scope.tenant_id, module_id: scope.module_id, id: text(row.id), name: text(row.name, 'Produto'),
    barcode: nullable(row.barcode), category: nullable(row.category), description: nullable(row.description),
    price_cents: cents(row.price), cost_cents: cents(row.cost_price), species_target: nullable(row.species_target),
    upsell_product_id: nullable(row.upsell_product_id), image_url: nullable(row.image_url),
    bot_metadata_json: json(parseJson(row.bot_metadata, {}), {}), status: bool(row.active, true) ? 'active' : 'inactive',
    created_at_ms: ms(row.created_at, 0), updated_at_ms: ms(row.updated_at, ms(row.created_at, 0)),
  })).filter((row) => row.id)

  const services = rows(source, 'petshop_services', scope.tenant_id, scope.module_id).map((row) => ({
    tenant_id: scope.tenant_id, module_id: scope.module_id, id: text(row.id, stableId('service', row.code)),
    code: text(row.code), name: text(row.name, 'Servico'), category: nullable(row.category), description: nullable(row.description),
    group_type: ['banho_tosa','veterinaria','motoboy','outro'].includes(text(row.group_type)) ? text(row.group_type) : 'outro',
    default_price_cents: cents(row.default_price), default_duration_min: Math.min(1440, Math.max(15, Math.round(finite(row.default_duration_min, 60)))),
    commission_type: 'percentage', commission_basis_points: Math.min(10000, Math.max(0, Math.round(finite(row.commission_rate, 0) * 100))),
    sort_order: Math.round(finite(row.sort_order, 999)), icon: nullable(row.icon), source_product_id: nullable(row.source_product_id),
    status: bool(row.active, true) ? 'active' : 'inactive', created_at_ms: ms(row.created_at, 0), updated_at_ms: ms(row.updated_at, ms(row.created_at, 0)),
  })).filter((row) => row.id && row.code)
  return { catalog_products: products, services }
}

function projectInventory(source, scope, products) {
  const balances = products.map((product) => {
    const legacy = rows(source, 'products', scope.tenant_id, scope.module_id).find((row) => text(row.id) === product.id) || {}
    return { tenant_id: scope.tenant_id, module_id: scope.module_id, product_id: product.id,
      on_hand_milliunits: Math.max(0, milli(legacy.stock_quantity)), reserved_milliunits: 0,
      reorder_milliunits: Math.max(0, milli(legacy.min_stock)), version: 1, updated_at_ms: ms(legacy.updated_at, ms(legacy.created_at, 0)) }
  })
  const movements = rows(source, 'stock_movements', scope.tenant_id, scope.module_id).map((row) => {
    const before = milli(row.stock_before); const after = milli(row.stock_after)
    return { tenant_id: scope.tenant_id, module_id: scope.module_id, id: text(row.id),
      operation_key: text(row.operation_key, `legacy:${text(row.id)}`), product_id: text(row.product_id),
      movement_type: MOVEMENT_TYPES.get(text(row.movement_type).toLowerCase()) || 'adjustment', delta_milliunits: after - before,
      stock_before_milliunits: before, stock_after_milliunits: after, unit_cost_cents: cents(row.unit_cost),
      reference_type: nullable(row.reference_type || (row.sale_id ? 'sale' : null)), reference_id: nullable(row.reference_id || row.sale_id),
      reason: nullable(row.reason), created_at_ms: ms(row.created_at, 0) }
  }).filter((row) => row.id && row.product_id && row.stock_before_milliunits >= 0 && row.stock_after_milliunits >= 0)
  return { inventory_balances: balances, inventory_movements: movements }
}

function projectConfig(source, scope) {
  const setting = first(source, 'settings', scope.tenant_id, scope.module_id) || {}
  const config = [{ tenant_id: scope.tenant_id, module_id: scope.module_id,
    timezone: text(setting.petbot_timezone, 'America/Sao_Paulo'), booking_horizon_days: Math.max(1, Math.round(finite(setting.petbot_booking_horizon_days, 60))),
    booking_lead_time_min: Math.max(0, Math.round(finite(setting.petbot_booking_lead_time_min, 15))),
    default_service_duration_min: Math.max(15, Math.round(finite(setting.petbot_default_service_duration_min, 60))),
    max_services_per_appointment: Math.max(1, Math.min(10, Math.round(finite(setting.petbot_max_services_per_appointment, 10)))),
    autonomy_mode: ['manual','assisted','autonomous'].includes(text(setting.petbot_autonomy_mode)) ? text(setting.petbot_autonomy_mode) : 'assisted',
    version: 1, updated_at_ms: ms(setting.updated_at, ms(setting.created_at, 0)) }]

  const hours = parseJson(setting.petbot_business_hours, {})
  const booking_hours = []
  for (let weekday = 1; weekday <= 7; weekday += 1) {
    const periods = arr(hours?.[String(weekday)])
    if (!periods.length) continue
    const period = periods[0] || {}
    const open = timeMinutes(period.open); const close = timeMinutes(period.close)
    if (open == null || close == null || close <= open) continue
    booking_hours.push({ tenant_id: scope.tenant_id, module_id: scope.module_id, weekday, open_minute: open, close_minute: close, active: 1 })
  }
  const configuredPayments = arr(parseJson(setting.payment_methods || setting.sales_payment_methods, null))
  const methods = configuredPayments.length ? configuredPayments.map((item) => typeof item === 'string' ? item : item?.id || item?.method) : ['pix','dinheiro','cartao']
  const payment_method_settings = [...new Set(methods.map((m) => PAYMENT_METHODS.get(text(m).toLowerCase())).filter(Boolean))]
    .map((method, index) => ({ tenant_id: scope.tenant_id, module_id: scope.module_id, method, enabled: 1, sort_order: index }))
  return { module_operational_settings: config, booking_hours, payment_method_settings, setting }
}

function projectAppointments(source, scope) {
  const appointments = []
  const appointment_services = []
  for (const row of rows(source, 'appointments', scope.tenant_id, scope.module_id)) {
    const id = text(row.id); if (!id) continue
    const scheduled = ms(row.scheduled_at || (row.service_date && row.start_time ? `${row.service_date}T${row.start_time}` : null), 0)
    const status = APPOINTMENT_STATUS.get(text(row.status).toLowerCase()) || 'scheduled'
    const services = arr(parseJson(row.service_items, []))
    appointments.push({ tenant_id: scope.tenant_id, module_id: scope.module_id, id,
      operation_key: text(row.idempotency_key, `legacy:${id}`), client_id: nullable(row.client_id), pet_id: nullable(row.pet_id),
      scheduled_at_ms: scheduled, duration_min: Math.max(15, Math.round(finite(row.duration_min, 60))),
      service_group: ['banho_tosa','veterinaria'].includes(text(row.service_group)) ? text(row.service_group) : null,
      status, source: text(row.source, 'import').replace(/[^a-z0-9_:-]/gi, '_').toLowerCase().slice(0, 40) || 'import',
      subtotal_cents: cents(row.price), transport_fee_cents: cents(row.transport_fee || row.service_transport_fee),
      notes: nullable(row.notes || row.description), version: 1, created_at_ms: ms(row.created_at, scheduled), updated_at_ms: ms(row.updated_at, scheduled) })
    const normalized = services.length ? services : (row.service_type ? [{ code: row.service_type, name: row.service_type, group_type: row.service_group, unit_price: row.price, duration_min: row.duration_min }] : [])
    normalized.forEach((item, position) => appointment_services.push({ tenant_id: scope.tenant_id, module_id: scope.module_id, appointment_id: id, position,
      service_id: nullable(item.service_id || item.id), service_code: text(item.code, text(row.service_type, `legacy_${position}`)),
      service_name: text(item.name, text(row.service_type, 'Servico')), service_group: ['banho_tosa','veterinaria','motoboy','outro'].includes(text(item.group_type)) ? text(item.group_type) : 'outro',
      unit_price_cents: cents(item.unit_price ?? item.price ?? row.price), duration_min: Math.max(15, Math.round(finite(item.duration_min, row.duration_min || 60))), benefit_used: bool(item.benefit_used, false) ? 1 : 0 }))
  }
  return { appointments, appointment_services }
}

function projectTransport(source, scope, setting) {
  const configured = arr(parseJson(setting.pet_transport_options, []))
  const optionRows = configured.length ? configured : [
    { id:'cliente_leva', label:'Cliente leva e busca', fee:0 }, { id:'buscar_e_levar', label:'Buscar e levar', fee:setting.pet_transport_fee || 0 },
    { id:'somente_buscar', label:'Somente buscar', fee:setting.pet_transport_fee || 0 }, { id:'somente_levar', label:'Somente levar', fee:setting.pet_transport_fee || 0 },
  ]
  const transport_options = optionRows.map((item, index) => {
    const id = text(item.id)
    return { tenant_id: scope.tenant_id, module_id: scope.module_id, id, label: text(item.label, id), fee_cents: cents(item.fee),
      max_weight_grams: item.maxWeightKg == null ? null : Math.max(1, Math.round(finite(item.maxWeightKg) * 1000)),
      pickup_required: ['motodog','buscar_e_levar','buscar_e_levar_fora_muriae','somente_buscar'].includes(id) ? 1 : 0,
      dropoff_required: ['motodog','buscar_e_levar','buscar_e_levar_fora_muriae','somente_levar'].includes(id) ? 1 : 0,
      outside_city: id === 'buscar_e_levar_fora_muriae' ? 1 : 0, status: bool(item.active, true) ? 'active' : 'inactive', sort_order: index }
  }).filter((row) => ['cliente_leva','motodog','buscar_e_levar','buscar_e_levar_fora_muriae','somente_buscar','somente_levar'].includes(row.id))

  const appointment_transport = rows(source, 'appointments', scope.tenant_id, scope.module_id).flatMap((row) => {
    const option = nullable(row.transport_mode || row.motodog_option || row.pet_transport_option)
    if (!option || option === 'cliente_leva') return []
    return [{ tenant_id: scope.tenant_id, module_id: scope.module_id, appointment_id: text(row.id), option_id: option,
      fee_cents: cents(row.transport_fee || row.service_transport_fee), pickup_address: nullable(row.pickup_address || row.address),
      dropoff_address: nullable(row.dropoff_address || row.address), pickup_reference: nullable(row.pickup_reference || row.address_reference),
      dropoff_reference: nullable(row.dropoff_reference || row.address_reference), contact_phone: nullable(row.customer_phone || row.phone),
      status: ['pending','scheduled','picked_up','delivered','cancelled'].includes(text(row.transport_status)) ? text(row.transport_status) : 'scheduled',
      notes: nullable(row.transport_notes), updated_at_ms: ms(row.updated_at, ms(row.created_at, 0)) }]
  })
  return { transport_options, appointment_transport }
}

function projectSales(source, scope) {
  const legacySales = rows(source, 'sales', scope.tenant_id, scope.module_id)
  const sales = legacySales.map((row) => ({ tenant_id: scope.tenant_id, module_id: scope.module_id, id: text(row.id),
    operation_key: text(row.idempotency_key || row.operation_key, `legacy:${text(row.id)}`), client_id: nullable(row.client_id), appointment_id: nullable(row.appointment_id),
    source: ['manual','pos','whatsapp','import'].includes(text(row.source)) ? text(row.source) : 'import',
    fulfillment_type: ({ balcao:'counter',retirada:'counter',counter:'counter',entrega:'delivery',delivery:'delivery',servico:'service',service:'service' })[text(row.fulfillment_type).toLowerCase()] || 'counter',
    subtotal_cents: cents(row.subtotal), discount_cents: cents(row.discount), transport_fee_cents: cents(row.transport_fee || row.delivery_fee), total_cents: cents(row.total_price ?? row.total),
    status: SALE_STATUS.get(text(row.status).toLowerCase()) || 'pending', notes: nullable(row.notes), created_at_ms: ms(row.created_at, 0), updated_at_ms: ms(row.updated_at, ms(row.created_at, 0)) }))
    .filter((row) => row.id && row.total_cents === row.subtotal_cents - row.discount_cents + row.transport_fee_cents)

  const sale_items = rows(source, 'sale_items', scope.tenant_id, scope.module_id).map((row, index) => {
    const productId = nullable(row.product_id); const serviceId = nullable(row.service_id)
    return { tenant_id: scope.tenant_id, module_id: scope.module_id, sale_id: text(row.sale_id), position: Math.max(0, Math.round(finite(row.position, index))),
      item_type: serviceId && !productId ? 'service' : 'product', product_id: productId, service_id: serviceId,
      item_name: text(row.item_name || row.product_name || row.service_name, 'Item'), quantity_milliunits: Math.max(1, milli(row.quantity || 1)),
      unit_price_cents: cents(row.unit_price), subtotal_cents: cents(row.subtotal), upsell: bool(row.upsell, false) ? 1 : 0 }
  }).filter((row) => row.sale_id && ((row.item_type === 'product' && row.product_id) || (row.item_type === 'service' && row.service_id)))

  const splitRows = rows(source, 'sale_payment_splits', scope.tenant_id, scope.module_id)
  const payments = []
  const payment_splits = []
  for (const sale of legacySales) {
    const saleId = text(sale.id); if (!saleId) continue
    const splits = splitRows.filter((row) => text(row.sale_id) === saleId)
    if (splits.length) {
      splits.forEach((split, index) => {
        const id = stableId('payment', `${saleId}:${index}`); const amount = cents(split.amount || split.value)
        const method = PAYMENT_METHODS.get(text(split.payment_method || split.method).toLowerCase()) || 'cash'
        payments.push({ tenant_id: scope.tenant_id, module_id: scope.module_id, id, sale_id: saleId, operation_key: `legacy:${saleId}:payment:${index}`,
          method, amount_cents: amount, status: 'received', provider: nullable(split.provider), provider_reference: nullable(split.provider_reference),
          received_at_ms: ms(split.received_at || sale.created_at, null), created_at_ms: ms(split.created_at || sale.created_at, 0), updated_at_ms: ms(split.updated_at || sale.updated_at, ms(sale.created_at, 0)) })
        payment_splits.push({ tenant_id: scope.tenant_id, module_id: scope.module_id, payment_id: id, position: 0,
          recipient_type: 'store', recipient_id: scope.tenant_id, amount_cents: amount, status: 'paid', provider_reference: nullable(split.provider_reference), updated_at_ms: ms(split.updated_at || sale.updated_at, 0) })
      })
    } else if (sale.payment_method && cents(sale.total_price ?? sale.total) > 0) {
      const id = stableId('payment', saleId); const method = PAYMENT_METHODS.get(text(sale.payment_method).toLowerCase()) || 'cash'; const amount = cents(sale.total_price ?? sale.total)
      payments.push({ tenant_id: scope.tenant_id, module_id: scope.module_id, id, sale_id: saleId, operation_key: `legacy:${saleId}:payment`, method, amount_cents: amount,
        status: text(sale.payment_status).includes('aguardando') ? 'awaiting_proof' : 'received', provider: null, provider_reference: null,
        received_at_ms: ms(sale.created_at, null), created_at_ms: ms(sale.created_at, 0), updated_at_ms: ms(sale.updated_at, ms(sale.created_at, 0)) })
      payment_splits.push({ tenant_id: scope.tenant_id, module_id: scope.module_id, payment_id: id, position: 0, recipient_type: 'store', recipient_id: scope.tenant_id,
        amount_cents: amount, status: 'paid', provider_reference: null, updated_at_ms: ms(sale.updated_at, 0) })
    }
  }
  return { sales, sale_items, payments, payment_splits }
}

function projectChat(source, scope) {
  const sessions = rows(source, 'chat_sessions', scope.tenant_id, scope.module_id)
  const chat_threads = sessions.map((row) => ({ tenant_id: scope.tenant_id, module_id: scope.module_id, id: text(row.id), channel: 'whatsapp',
    external_thread_id: nullable(row.external_thread_id || row.phone || row.customer_phone), client_id: nullable(row.client_id), pet_id: nullable(row.pet_id),
    status: row.handoff_target ? 'handoff' : (text(row.status).toLowerCase() === 'closed' ? 'closed' : 'open'),
    last_message_at_ms: ms(row.last_message_at, null), created_at_ms: ms(row.created_at, 0), updated_at_ms: ms(row.updated_at || row.last_message_at, ms(row.created_at, 0)) })).filter((row) => row.id)
  const chat_messages = rows(source, 'chat_messages', scope.tenant_id, scope.module_id).map((row) => ({ tenant_id: scope.tenant_id, module_id: scope.module_id, id: text(row.id),
    thread_id: text(row.session_id || row.thread_id), external_message_id: nullable(row.external_message_id || row.message_id),
    direction: ['inbound','outbound'].includes(text(row.direction)) ? text(row.direction) : (text(row.role).toLowerCase() === 'user' ? 'inbound' : 'outbound'),
    actor_type: ({ user:'customer',customer:'customer',assistant:'assistant',human:'human',system:'system' })[text(row.actor_type || row.role).toLowerCase()] || 'system',
    content_text: text(row.content || row.message || row.text), content_json: row.content_json ? json(parseJson(row.content_json, {}), {}) : null,
    created_at_ms: ms(row.created_at, 0) })).filter((row) => row.id && row.thread_id)
  return { chat_threads, chat_messages }
}

function projectFiscal(source, scope) {
  const fiscal_documents = rows(source, 'fiscal_documents', scope.tenant_id, scope.module_id).map((row) => ({ tenant_id: scope.tenant_id, module_id: scope.module_id,
    id: text(row.id), sale_id: text(row.sale_id), operation_key: text(row.operation_key || row.idempotency_key, `legacy:${text(row.id)}`),
    document_type: ['nfe','nfce','nfse'].includes(text(row.document_type || row.type).toLowerCase()) ? text(row.document_type || row.type).toLowerCase() : 'nfe',
    status: ['pending','queued','processing','authorized','rejected','cancelled','failed'].includes(text(row.status).toLowerCase()) ? text(row.status).toLowerCase() : 'pending',
    issuer_reference: nullable(row.issuer_reference || row.provider_reference), access_key: nullable(row.access_key || row.chave),
    request_hash: text(row.request_hash, createHash('sha256').update(json(row.request_payload || row.payload || {}, {})).digest('hex')),
    authorized_at_ms: ms(row.authorized_at, null), cancelled_at_ms: ms(row.cancelled_at, null), created_at_ms: ms(row.created_at, 0), updated_at_ms: ms(row.updated_at, ms(row.created_at, 0)) }))
    .filter((row) => row.id && row.sale_id && /^[a-f0-9]{64}$/.test(row.request_hash))
  return { fiscal_documents }
}

export function projectOperationalSnapshot(source, { tenantId, moduleId = 'petshop' }) {
  const tenant_id = text(tenantId); const module_id = text(moduleId).toLowerCase()
  if (!tenant_id || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(module_id)) throw new Error('Invalid operational projection scope.')
  const scope = { tenant_id, module_id }
  const catalog = projectCatalog(source, scope)
  const config = projectConfig(source, scope)
  const projected = {
    catalog_products: catalog.catalog_products, services: catalog.services,
    ...projectInventory(source, scope, catalog.catalog_products),
    module_operational_settings: config.module_operational_settings, booking_hours: config.booking_hours, payment_method_settings: config.payment_method_settings,
    ...projectAppointments(source, scope), ...projectTransport(source, scope, config.setting), ...projectSales(source, scope), ...projectChat(source, scope), ...projectFiscal(source, scope),
  }
  for (const [name, collection] of Object.entries(projected)) collection.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
  return Object.freeze({ projection: `${OPERATIONAL_PROJECTION.name}/${OPERATIONAL_PROJECTION.version}`, source: 'supabase', scope, collections: projected,
    transient_policy: { collections: TRANSIENT_COLLECTIONS, strategy: 'start_clean_after_freeze_and_drain' } })
}
