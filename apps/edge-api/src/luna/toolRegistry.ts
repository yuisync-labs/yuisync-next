import type {
  LunaExecutionContext,
  LunaToolDefinition,
  LunaToolResult,
} from './contracts'
import { commitConfirmedProposal } from './commitProposal'
import { validateScheduleAvailability } from './schedulePolicy'
import { loadBenefitCandidates } from '../subscriptionBenefitCandidates'

type JsonRecord = Record<string, unknown>
type ToolHandler = (args: JsonRecord, context: LunaExecutionContext) => Promise<LunaToolResult>

export type LunaToolRegistry = Readonly<{
  definitions: readonly LunaToolDefinition[]
  execute(name: string, args: unknown, context: LunaExecutionContext): Promise<LunaToolResult>
}>

const objectSchema = (properties: JsonRecord, required: string[] = []) => ({
  type: 'object', properties, required, additionalProperties: false,
})

const stringProperty = (description: string) => ({ type: 'string', description })

const DEFINITIONS: readonly LunaToolDefinition[] = [
  {
    name: 'get_customer_context',
    description: 'Localiza o cliente pelo telefone verificado da conversa e retorna seus pets ativos.',
    parameters: objectSchema({}),
  },
  {
    name: 'search_services',
    description: 'Pesquisa serviços ativos e retorna preço e duração do catálogo real.',
    parameters: objectSchema({ query: stringProperty('Nome ou parte do nome do serviço.') }, ['query']),
  },
  {
    name: 'search_products',
    description: 'Pesquisa produtos ativos e retorna preço e estoque disponível.',
    parameters: objectSchema({ query: stringProperty('Nome, categoria ou código de barras.') }, ['query']),
  },
  {
    name: 'get_customer_appointments',
    description: 'Consulta próximos agendamentos ativos de um cliente identificado.',
    parameters: objectSchema({ customer_id: stringProperty('ID exato retornado por get_customer_context.') }, ['customer_id']),
  },
  {
    name: 'get_package_eligibility',
    description: 'Consulta benefícios de pacote ainda disponíveis para um serviço e cliente específicos.',
    parameters: objectSchema({
      customer_id: stringProperty('ID exato do cliente.'),
      service_id: stringProperty('ID exato do serviço.'),
    }, ['customer_id', 'service_id']),
  },
  {
    name: 'prepare_appointment',
    description: 'Valida pet, serviços, data e valores e cria uma proposta que ainda exige confirmação.',
    parameters: objectSchema({
      customer_id: stringProperty('ID exato do cliente.'),
      pet_id: stringProperty('ID exato do pet.'),
      service_ids: { type: 'array', minItems: 1, maxItems: 6, items: { type: 'string' } },
      scheduled_at: stringProperty('Data e hora ISO 8601 com fuso horário.'),
      notes: { type: ['string', 'null'] },
    }, ['customer_id', 'pet_id', 'service_ids', 'scheduled_at', 'notes']),
  },
  {
    name: 'prepare_product_order',
    description: 'Valida produtos, quantidades, estoque e preço e cria uma proposta que ainda exige confirmação.',
    parameters: objectSchema({
      customer_id: stringProperty('ID exato do cliente.'),
      items: {
        type: 'array', minItems: 1, maxItems: 12,
        items: objectSchema({
          product_id: stringProperty('ID exato do produto.'),
          quantity: { type: 'integer', minimum: 1, maximum: 100 },
        }, ['product_id', 'quantity']),
      },
      fulfillment_type: { type: 'string', enum: ['counter', 'delivery'] },
    }, ['customer_id', 'items', 'fulfillment_type']),
  },
  {
    name: 'prepare_appointment_reschedule',
    description: 'Valida uma nova data para um agendamento ativo e prepara a alteração para confirmação.',
    parameters: objectSchema({
      customer_id: stringProperty('ID exato do cliente.'),
      appointment_id: stringProperty('ID exato do agendamento retornado pela consulta.'),
      scheduled_at: stringProperty('Nova data e hora ISO 8601 com fuso horário.'),
    }, ['customer_id', 'appointment_id', 'scheduled_at']),
  },
  {
    name: 'prepare_appointment_cancellation',
    description: 'Prepara o cancelamento de um agendamento ativo para confirmação explícita do cliente.',
    parameters: objectSchema({
      customer_id: stringProperty('ID exato do cliente.'),
      appointment_id: stringProperty('ID exato do agendamento retornado pela consulta.'),
      reason: { type: ['string', 'null'] },
    }, ['customer_id', 'appointment_id', 'reason']),
  },
  {
    name: 'commit_confirmed_proposal',
    description: 'Executa uma proposta confirmada. Só use após confirmação explícita do resumo pelo cliente.',
    parameters: objectSchema({
      proposal_id: stringProperty('ID da proposta apresentada ao cliente.'),
      proposal_version: { type: 'integer', minimum: 1 },
    }, ['proposal_id', 'proposal_version']),
  },
  {
    name: 'handoff_to_human',
    description: 'Pausa a automação e transfere a conversa para atendimento humano.',
    parameters: objectSchema({ reason: stringProperty('Motivo curto e objetivo do encaminhamento.') }, ['reason']),
  },
]

const clean = (value: unknown, max = 300) => typeof value === 'string' ? value.trim().slice(0, max) : ''
const record = (value: unknown): JsonRecord => value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {}
const escapeLike = (value: string) => value.replace(/[\\%_]/g, '\\$&')

async function fingerprint(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(value))
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map((part) => part.toString(16).padStart(2, '0')).join('')
}

function proposalSummary(kind: string, data: JsonRecord): JsonRecord {
  return { kind, ...data }
}

async function createProposal(database: D1Database, context: LunaExecutionContext, kind: string, payload: JsonRecord): Promise<LunaToolResult> {
  const id = crypto.randomUUID()
  const now = Date.now()
  const expiresAt = now + 10 * 60_000
  const hash = await fingerprint(payload)
  await database.prepare(`
    INSERT OR IGNORE INTO luna_conversations(
      tenant_id,module_id,conversation_id,status,state_json,last_source_message_id,created_at_ms,updated_at_ms
    ) VALUES(?1,?2,?3,'active','{}',?4,?5,?5)
  `).bind(context.tenantId, context.moduleId, context.conversationId, context.sourceMessageId, now).run()
  await database.batch([
    database.prepare(`
      UPDATE luna_proposals SET status='invalidated',updated_at_ms=?4
      WHERE tenant_id=?1 AND module_id=?2 AND conversation_id=?3
        AND status IN ('collecting','awaiting_confirmation')
    `).bind(context.tenantId, context.moduleId, context.conversationId, now),
    database.prepare(`
      INSERT INTO luna_proposals(
        tenant_id,module_id,id,conversation_id,operation_kind,status,version,payload_json,
        fingerprint,source_message_id,expires_at_ms,created_at_ms,updated_at_ms
      ) VALUES(?1,?2,?3,?4,?5,'awaiting_confirmation',1,?6,?7,?8,?9,?10,?10)
    `).bind(
      context.tenantId, context.moduleId, id, context.conversationId, kind,
      JSON.stringify(payload), hash, context.sourceMessageId, expiresAt, now,
    ),
  ])
  return { ok: true, data: { proposal_id: id, proposal_version: 1, expires_at_ms: expiresAt, summary: proposalSummary(kind, payload) } }
}

export function createLunaToolRegistry(database: D1Database): LunaToolRegistry {
  const handlers = new Map<string, ToolHandler>()

  handlers.set('get_customer_context', async (_args, context) => {
    const phone = context.customerAddress
    const customer = await database.prepare(`
      SELECT id,name,phone,email FROM clients
      WHERE tenant_id=?1 AND module_id=?2 AND status='active' AND (phone=?3 OR phone=?4)
      ORDER BY updated_at_ms DESC LIMIT 2
    `).bind(context.tenantId, context.moduleId, phone, `+${phone}`).all<Record<string, unknown>>()
    if (customer.results.length === 0) return { ok: false, code: 'CUSTOMER_NOT_FOUND', retryable: false }
    if (customer.results.length > 1) return { ok: false, code: 'CUSTOMER_AMBIGUOUS', retryable: false }
    const selected = customer.results[0]
    const pets = await database.prepare(`
      SELECT id,name,species,breed,weight_kg FROM pets
      WHERE tenant_id=?1 AND module_id=?2 AND client_id=?3 AND status='active'
      ORDER BY name,id LIMIT 20
    `).bind(context.tenantId, context.moduleId, selected.id).all<Record<string, unknown>>()
    return { ok: true, data: { customer: selected, pets: pets.results } }
  })

  handlers.set('search_services', async (args, context) => {
    const query = clean(args.query, 120)
    if (!query) return { ok: false, code: 'QUERY_REQUIRED', retryable: false, missing_fields: ['query'] }
    const result = await database.prepare(`
      SELECT id,code,name,category,group_type,default_price_cents,default_duration_min
      FROM services WHERE tenant_id=?1 AND module_id=?2 AND status='active'
        AND (name LIKE ?3 ESCAPE '\\' OR code LIKE ?3 ESCAPE '\\' OR category LIKE ?3 ESCAPE '\\')
      ORDER BY sort_order,name,id LIMIT 12
    `).bind(context.tenantId, context.moduleId, `%${escapeLike(query)}%`).all<Record<string, unknown>>()
    return { ok: true, data: { services: result.results } }
  })

  handlers.set('search_products', async (args, context) => {
    const query = clean(args.query, 120)
    if (!query) return { ok: false, code: 'QUERY_REQUIRED', retryable: false, missing_fields: ['query'] }
    const result = await database.prepare(`
      SELECT p.id,p.name,p.category,p.price_cents,p.image_url,
             MAX(0,COALESCE(i.on_hand_milliunits,0)-COALESCE(i.reserved_milliunits,0)) AS available_milliunits
      FROM catalog_products p
      LEFT JOIN inventory_balances i ON i.tenant_id=p.tenant_id AND i.module_id=p.module_id AND i.product_id=p.id
      WHERE p.tenant_id=?1 AND p.module_id=?2 AND p.status='active'
        AND (p.name LIKE ?3 ESCAPE '\\' OR p.category LIKE ?3 ESCAPE '\\' OR p.barcode=?4)
      ORDER BY p.name,p.id LIMIT 12
    `).bind(context.tenantId, context.moduleId, `%${escapeLike(query)}%`, query).all<Record<string, unknown>>()
    return { ok: true, data: { products: result.results } }
  })

  handlers.set('get_customer_appointments', async (args, context) => {
    const customerId = clean(args.customer_id, 160)
    if (!customerId) return { ok: false, code: 'CUSTOMER_ID_REQUIRED', retryable: false, missing_fields: ['customer_id'] }
    const result = await database.prepare(`
      SELECT a.id,a.pet_id,p.name AS pet_name,a.scheduled_at_ms,a.duration_min,a.status,
             a.subtotal_cents,a.transport_fee_cents,a.notes
      FROM appointments a JOIN pets p ON p.tenant_id=a.tenant_id AND p.module_id=a.module_id AND p.id=a.pet_id
      WHERE a.tenant_id=?1 AND a.module_id=?2 AND a.client_id=?3
        AND a.status IN ('scheduled','confirmed','in_progress') AND a.scheduled_at_ms>=?4
      ORDER BY a.scheduled_at_ms,a.id LIMIT 20
    `).bind(context.tenantId, context.moduleId, customerId, Date.now() - 60_000).all<Record<string, unknown>>()
    return { ok: true, data: { appointments: result.results } }
  })

  handlers.set('get_package_eligibility', async (args, context) => {
    const customerId = clean(args.customer_id, 160)
    const serviceId = clean(args.service_id, 160)
    if (!customerId || !serviceId) return { ok: false, code: 'PACKAGE_QUERY_FIELDS_REQUIRED', retryable: false }
    const service = await database.prepare(`
      SELECT id,code,name FROM services
      WHERE tenant_id=?1 AND module_id=?2 AND id=?3 AND status='active' LIMIT 1
    `).bind(context.tenantId, context.moduleId, serviceId).first<{ id: string; code: string; name: string }>()
    if (!service) return { ok: false, code: 'SERVICE_NOT_FOUND', retryable: false }
    const candidates = await loadBenefitCandidates(database, {
      tenantId: context.tenantId,
      moduleId: context.moduleId,
      clientId: customerId,
      serviceCode: service.code,
    })
    const benefits = candidates.results.map((row) => {
      const capacity = Number(row.max_qty || 0)
      const used = Number(row.baseline_used || 0) + Number(row.active_qty || 0)
      return {
        subscription_id: row.subscription_id,
        plan_name: row.plan_name,
        benefit_key: row.benefit_key,
        capacity,
        used,
        available: Math.max(0, capacity - used),
      }
    }).filter((row) => row.available > 0)
    return { ok: true, data: { service, benefits } }
  })

  handlers.set('prepare_appointment', async (args, context) => {
    const customerId = clean(args.customer_id, 160)
    const petId = clean(args.pet_id, 160)
    const serviceIds = Array.isArray(args.service_ids) ? args.service_ids.map((item) => clean(item, 160)).filter(Boolean).slice(0, 6) : []
    const scheduledAt = Date.parse(clean(args.scheduled_at, 80))
    if (!customerId || !petId || !serviceIds.length || !Number.isFinite(scheduledAt)) {
      return { ok: false, code: 'APPOINTMENT_FIELDS_REQUIRED', retryable: false, missing_fields: ['customer_id', 'pet_id', 'service_ids', 'scheduled_at'] }
    }
    const pet = await database.prepare(`SELECT id,name FROM pets WHERE tenant_id=?1 AND module_id=?2 AND id=?3 AND client_id=?4 AND status='active' LIMIT 1`)
      .bind(context.tenantId, context.moduleId, petId, customerId).first<Record<string, unknown>>()
    if (!pet) return { ok: false, code: 'PET_NOT_FOUND', retryable: false }
    const placeholders = serviceIds.map((_, index) => `?${index + 3}`).join(',')
    const services = await database.prepare(`SELECT id,code,name,group_type,default_price_cents,default_duration_min FROM services WHERE tenant_id=?1 AND module_id=?2 AND status='active' AND id IN (${placeholders}) ORDER BY sort_order,id`)
      .bind(context.tenantId, context.moduleId, ...serviceIds).all<Record<string, unknown>>()
    if (services.results.length !== new Set(serviceIds).size) return { ok: false, code: 'SERVICE_NOT_FOUND', retryable: false }
    const durationMinutes = services.results.reduce((sum, service) => sum + Number(service.default_duration_min || 0), 0)
    const availability = await validateScheduleAvailability({
      database, tenantId: context.tenantId, moduleId: context.moduleId,
      scheduledAtMs: scheduledAt, durationMinutes,
    })
    if (!availability.ok) return { ok: false, code: availability.code, retryable: false }
    const payload = {
      customer_id: customerId,
      pet_id: petId,
      pet_name: pet.name,
      scheduled_at_ms: scheduledAt,
      duration_minutes: durationMinutes,
      services: services.results,
      subtotal_cents: services.results.reduce((sum, service) => sum + Number(service.default_price_cents || 0), 0),
      notes: clean(args.notes, 1000) || null,
    }
    return createProposal(database, context, 'appointment_create', payload)
  })

  handlers.set('prepare_product_order', async (args, context) => {
    const customerId = clean(args.customer_id, 160)
    const requested = Array.isArray(args.items) ? args.items.map(record).slice(0, 12) : []
    const fulfillmentType = args.fulfillment_type === 'delivery' ? 'delivery' : args.fulfillment_type === 'counter' ? 'counter' : ''
    if (!customerId || !requested.length || !fulfillmentType) return { ok: false, code: 'ORDER_FIELDS_REQUIRED', retryable: false }
    const customer = await database.prepare(`SELECT id,name FROM clients WHERE tenant_id=?1 AND module_id=?2 AND id=?3 AND status='active' LIMIT 1`)
      .bind(context.tenantId, context.moduleId, customerId).first<Record<string, unknown>>()
    if (!customer) return { ok: false, code: 'CUSTOMER_NOT_FOUND', retryable: false }
    const resolved = []
    for (const item of requested) {
      const productId = clean(item.product_id, 160)
      const quantity = Number(item.quantity)
      if (!productId || !Number.isInteger(quantity) || quantity < 1 || quantity > 100) return { ok: false, code: 'ORDER_ITEM_INVALID', retryable: false }
      const product = await database.prepare(`
        SELECT p.id,p.name,p.price_cents,MAX(0,COALESCE(i.on_hand_milliunits,0)-COALESCE(i.reserved_milliunits,0)) AS available_milliunits
        FROM catalog_products p LEFT JOIN inventory_balances i ON i.tenant_id=p.tenant_id AND i.module_id=p.module_id AND i.product_id=p.id
        WHERE p.tenant_id=?1 AND p.module_id=?2 AND p.id=?3 AND p.status='active' LIMIT 1
      `).bind(context.tenantId, context.moduleId, productId).first<Record<string, unknown>>()
      if (!product) return { ok: false, code: 'PRODUCT_NOT_FOUND', retryable: false }
      if (Number(product.available_milliunits || 0) < quantity * 1000) return { ok: false, code: 'INSUFFICIENT_STOCK', retryable: false }
      resolved.push({ product_id: productId, name: product.name, quantity, unit_price_cents: Number(product.price_cents || 0), subtotal_cents: Number(product.price_cents || 0) * quantity })
    }
    const payload = { customer_id: customerId, customer_name: customer.name, fulfillment_type: fulfillmentType, items: resolved, total_cents: resolved.reduce((sum, item) => sum + item.subtotal_cents, 0) }
    return createProposal(database, context, 'product_order_create', payload)
  })

  handlers.set('prepare_appointment_reschedule', async (args, context) => {
    const customerId = clean(args.customer_id, 160)
    const appointmentId = clean(args.appointment_id, 160)
    const scheduledAt = Date.parse(clean(args.scheduled_at, 80))
    if (!customerId || !appointmentId || !Number.isFinite(scheduledAt)) {
      return { ok: false, code: 'RESCHEDULE_FIELDS_REQUIRED', retryable: false }
    }
    const appointment = await database.prepare(`
      SELECT a.id,a.client_id,a.pet_id,p.name AS pet_name,a.scheduled_at_ms,a.duration_min,a.status,a.version
      FROM appointments a JOIN pets p ON p.tenant_id=a.tenant_id AND p.module_id=a.module_id AND p.id=a.pet_id
      WHERE a.tenant_id=?1 AND a.module_id=?2 AND a.id=?3 AND a.client_id=?4 LIMIT 1
    `).bind(context.tenantId, context.moduleId, appointmentId, customerId).first<Record<string, unknown>>()
    if (!appointment) return { ok: false, code: 'APPOINTMENT_NOT_FOUND', retryable: false }
    if (!['scheduled', 'confirmed'].includes(String(appointment.status))) return { ok: false, code: 'APPOINTMENT_NOT_RESCHEDULABLE', retryable: false }
    const availability = await validateScheduleAvailability({
      database, tenantId: context.tenantId, moduleId: context.moduleId,
      scheduledAtMs: scheduledAt, durationMinutes: Number(appointment.duration_min), ignoreAppointmentId: appointmentId,
    })
    if (!availability.ok) return { ok: false, code: availability.code, retryable: false }
    return createProposal(database, context, 'appointment_reschedule', {
      appointment_id: appointmentId,
      customer_id: customerId,
      pet_id: appointment.pet_id,
      pet_name: appointment.pet_name,
      previous_scheduled_at_ms: appointment.scheduled_at_ms,
      scheduled_at_ms: scheduledAt,
      duration_minutes: appointment.duration_min,
      appointment_version: appointment.version,
    })
  })

  handlers.set('prepare_appointment_cancellation', async (args, context) => {
    const customerId = clean(args.customer_id, 160)
    const appointmentId = clean(args.appointment_id, 160)
    if (!customerId || !appointmentId) return { ok: false, code: 'CANCELLATION_FIELDS_REQUIRED', retryable: false }
    const appointment = await database.prepare(`
      SELECT a.id,a.client_id,a.pet_id,p.name AS pet_name,a.scheduled_at_ms,a.status,a.version
      FROM appointments a JOIN pets p ON p.tenant_id=a.tenant_id AND p.module_id=a.module_id AND p.id=a.pet_id
      WHERE a.tenant_id=?1 AND a.module_id=?2 AND a.id=?3 AND a.client_id=?4 LIMIT 1
    `).bind(context.tenantId, context.moduleId, appointmentId, customerId).first<Record<string, unknown>>()
    if (!appointment) return { ok: false, code: 'APPOINTMENT_NOT_FOUND', retryable: false }
    if (!['scheduled', 'confirmed'].includes(String(appointment.status))) return { ok: false, code: 'APPOINTMENT_NOT_CANCELLABLE', retryable: false }
    return createProposal(database, context, 'appointment_cancel', {
      appointment_id: appointmentId,
      customer_id: customerId,
      pet_id: appointment.pet_id,
      pet_name: appointment.pet_name,
      scheduled_at_ms: appointment.scheduled_at_ms,
      appointment_version: appointment.version,
      reason: clean(args.reason, 500) || null,
    })
  })

  handlers.set('commit_confirmed_proposal', async (args, context) => {
    const proposalId = clean(args.proposal_id, 160)
    const proposalVersion = Number(args.proposal_version)
    if (!proposalId || !Number.isInteger(proposalVersion) || proposalVersion < 1) {
      return { ok: false, code: 'PROPOSAL_REFERENCE_INVALID', retryable: false }
    }
    return commitConfirmedProposal(database, context, proposalId, proposalVersion)
  })

  handlers.set('handoff_to_human', async (args, context) => {
    const reason = clean(args.reason, 500) || 'Solicitação de atendimento humano.'
    const now = Date.now()
    await database.batch([
      database.prepare(`UPDATE chat_threads SET status='handoff',updated_at_ms=?4 WHERE tenant_id=?1 AND module_id=?2 AND id=?3`).bind(context.tenantId, context.moduleId, context.conversationId, now),
      database.prepare(`UPDATE luna_conversations SET status='handoff',state_json=json_set(state_json,'$.handoff_reason',?4),updated_at_ms=?5,version=version+1 WHERE tenant_id=?1 AND module_id=?2 AND conversation_id=?3`).bind(context.tenantId, context.moduleId, context.conversationId, reason, now),
    ])
    return { ok: true, data: { status: 'handoff', reason } }
  })

  return {
    definitions: DEFINITIONS,
    async execute(name, args, context) {
      const handler = handlers.get(name)
      if (!handler) return { ok: false, code: 'TOOL_NOT_ALLOWED', retryable: false }
      return handler(record(args), context)
    },
  }
}
