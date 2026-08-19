const PREVIEW_DATA_KEY = '@yuisync_visual_preview_data_v1'
const TENANT_ID = 'visual-preview-tenant'
const MODULE_ID = 'petshop'

const clone = (value) => JSON.parse(JSON.stringify(value))

function initialData() {
  const createdAt = new Date().toISOString()
  return {
    clients: [{
      id: 'preview-client-livia', tenant_id: TENANT_ID, module_id: MODULE_ID, type: 'pet',
      name: 'Lívia Martins', document: '123.456.789-00', phone: '(11) 98888-2468',
      email: 'livia@exemplo.local', address: 'Rua das Palmeiras', neighborhood: 'Centro', city: 'São Paulo',
      notes: 'Cliente demonstrativo do ambiente local.', active: true,
      details: {
        pet_name: 'Nina', species: 'dog', breed: 'Golden Retriever', birth_date: '2022-05-12',
        weight_kg: 24.5, color: 'Dourado', address_number: '120', registration_status: 'completo',
      },
      created_at: createdAt,
    }],
    pets: [{
      id: 'preview-client-livia', tenant_id: TENANT_ID, module_id: MODULE_ID,
      owner_name: 'Lívia Martins', owner_cpf: '123.456.789-00', phone: '(11) 98888-2468',
      email: 'livia@exemplo.local', owner_address: 'Rua das Palmeiras', owner_neighborhood: 'Centro',
      owner_city: 'São Paulo', pet_name: 'Nina', species: 'dog', breed: 'Golden Retriever',
      birth_date: '2022-05-12', weight_kg: 24.5, color: 'Dourado',
      notes: 'Pet demonstrativo do ambiente local.', created_at: createdAt, updated_at: createdAt,
    }],
    products: [{
      id: 'preview-product-shampoo', tenant_id: TENANT_ID, module_id: MODULE_ID,
      name: 'Shampoo Neutro 500 ml', category: 'Higiene',
      description: 'Produto demonstrativo para testar estoque e PDV.',
      price: 39.9, cost_price: 18, stock_quantity: 12, min_stock: 3, species_target: 'all',
      image_url: null, active: true, barcode: '7890000000017', upsell_link_id: null,
      bot_metadata: { product_type: 'produto' }, created_at: createdAt, updated_at: createdAt,
    }],
    petshop_services: [{
      id: 'preview-service-banho', tenant_id: TENANT_ID, module_id: MODULE_ID,
      code: 'banho-completo-demo', name: 'Banho completo', category: 'Banho e tosa',
      description: 'Serviço demonstrativo para testar a agenda.', group_type: 'banho_tosa',
      default_price: 70, default_duration_min: 60, min_weight_kg: null, max_weight_kg: null,
      species_target: 'dog', commission_type: 'percentage', commission_rate: 5,
      active: true, sort_order: 10, icon: 'droplets', source_product_id: null,
      created_at: createdAt, updated_at: createdAt,
    }],
    appointments: [],
  }
}

function loadData() {
  try {
    const stored = globalThis.localStorage?.getItem(PREVIEW_DATA_KEY)
    if (stored) return JSON.parse(stored)
  } catch { /* preview falls back to memory */ }
  return initialData()
}

let memoryData = loadData()

function persist() {
  try { globalThis.localStorage?.setItem(PREVIEW_DATA_KEY, JSON.stringify(memoryData)) } catch { /* memory remains available */ }
}

function tableRows(table) {
  if (!Array.isArray(memoryData[table])) memoryData[table] = []
  return memoryData[table]
}

function fieldValue(row, column) {
  return String(column || '').split(/\.|->>?/).filter(Boolean).reduce((value, key) => value?.[key], row)
}

function matchesFilter(row, filter = {}) {
  const current = fieldValue(row, filter.column)
  const expected = filter.value
  if (filter.op === 'eq') return String(current) === String(expected)
  if (filter.op === 'neq') return String(current) !== String(expected)
  if (filter.op === 'gt') return current > expected
  if (filter.op === 'gte') return current >= expected
  if (filter.op === 'lt') return current < expected
  if (filter.op === 'lte') return current <= expected
  if (filter.op === 'in') return (expected || []).map(String).includes(String(current))
  if (filter.op === 'is') return expected === null ? current == null : current === expected
  if (filter.op === 'not' && filter.operator === 'is') return expected === null ? current != null : current !== expected
  if (filter.op === 'ilike') {
    const term = String(expected || '').replaceAll('%', '').toLocaleLowerCase('pt-BR')
    return String(current || '').toLocaleLowerCase('pt-BR').includes(term)
  }
  if (filter.op === 'or') {
    const terms = [...String(filter.expression || '').matchAll(/ilike\.%(.*?)%(?:,|$)/gi)].map((match) => match[1])
    const haystack = JSON.stringify(row).toLocaleLowerCase('pt-BR')
    return terms.length === 0 || terms.some((term) => haystack.includes(String(term).toLocaleLowerCase('pt-BR')))
  }
  return true
}

function withRelations(table, row) {
  if (table !== 'appointments') return row
  const client = tableRows('clients').find((item) => String(item.id) === String(row.client_id))
  return { ...row, clients: client ? clone(client) : null }
}

function normalizeResult(rows, mode) {
  if (mode === 'single' || mode === 'maybeSingle') return rows[0] || null
  return rows
}

export function runVisualPreviewQuery(body = {}) {
  const table = String(body.table || '')
  const rows = tableRows(table)
  const filters = Array.isArray(body.filters) ? body.filters : []
  const matches = (row) => filters.every((filter) => matchesFilter(row, filter))
  let affected = []

  if (body.action === 'insert') {
    const incoming = Array.isArray(body.payload) ? body.payload : [body.payload || {}]
    affected = incoming.map((item) => ({
      id: item.id || `preview-${table}-${crypto.randomUUID()}`,
      created_at: item.created_at || new Date().toISOString(),
      ...clone(item),
    }))
    rows.push(...affected)
    persist()
  } else if (body.action === 'update') {
    rows.forEach((row, index) => {
      if (!matches(row)) return
      rows[index] = { ...row, ...clone(body.payload || {}), updated_at: new Date().toISOString() }
      affected.push(rows[index])
    })
    persist()
  } else if (body.action === 'upsert') {
    const incoming = Array.isArray(body.payload) ? body.payload : [body.payload || {}]
    const conflictColumns = String(body.conflict || 'id').split(',').map((item) => item.trim()).filter(Boolean)
    incoming.forEach((item) => {
      const index = rows.findIndex((row) => conflictColumns.every((column) => String(row[column]) === String(item[column])))
      if (index >= 0) {
        rows[index] = { ...rows[index], ...clone(item), updated_at: new Date().toISOString() }
        affected.push(rows[index])
      } else {
        const created = { id: item.id || `preview-${table}-${crypto.randomUUID()}`, created_at: new Date().toISOString(), ...clone(item) }
        rows.push(created)
        affected.push(created)
      }
    })
    persist()
  } else if (body.action === 'delete') {
    for (let index = rows.length - 1; index >= 0; index -= 1) {
      if (!matches(rows[index])) continue
      affected.unshift(rows[index])
      rows.splice(index, 1)
    }
    persist()
  } else {
    affected = rows.filter(matches)
  }

  for (const order of body.orders || []) {
    affected.sort((left, right) => {
      const a = fieldValue(left, order.column)
      const b = fieldValue(right, order.column)
      const comparison = String(a ?? '').localeCompare(String(b ?? ''), 'pt-BR', { numeric: true })
      return order.ascending === false ? -comparison : comparison
    })
  }

  if (body.range) affected = affected.slice(body.range.from, body.range.to + 1)
  if (body.limit != null) affected = affected.slice(0, body.limit)
  const hydrated = affected.map((row) => withRelations(table, clone(row)))
  return { data: normalizeResult(hydrated, body.mode), error: null, count: hydrated.length }
}

export function runVisualPreviewRpc(body = {}) {
  const name = String(body.name || '')
  const args = body.args || {}

  if (name === 'book_petshop_appointment_transaction') {
    const payload = clone(args.p_payload || {})
    const id = `preview-appointment-${crypto.randomUUID()}`
    tableRows('appointments').push({
      id,
      tenant_id: payload.tenant_id || TENANT_ID,
      module_id: payload.module_id || MODULE_ID,
      pet_id: payload.pet_id || payload.client_id,
      client_id: payload.client_id || payload.pet_id,
      service_type: payload.service_type || payload.services?.[0]?.code || 'banho-completo-demo',
      service_group: payload.service_group || 'banho_tosa',
      service_items: payload.service_items || payload.services || [],
      scheduled_at: payload.scheduled_at,
      duration_min: Number(payload.duration_min || 60),
      price: Number(payload.price || 0),
      status: payload.status || 'agendado',
      notes: payload.notes || '',
      source: payload.source || 'manual',
      created_at: new Date().toISOString(),
      ...payload,
    })
    persist()
    return { data: { appointment_id: id }, error: null, count: 1 }
  }

  if (name === 'update_petshop_appointment_transaction') {
    const id = args.p_appointment_id
    const index = tableRows('appointments').findIndex((row) => String(row.id) === String(id))
    if (index >= 0) {
      tableRows('appointments')[index] = {
        ...tableRows('appointments')[index],
        ...clone(args.p_payload || {}),
        updated_at: new Date().toISOString(),
      }
      persist()
    }
    return { data: { appointment_id: id }, error: null, count: index >= 0 ? 1 : 0 }
  }

  return { data: null, error: null, count: null }
}
