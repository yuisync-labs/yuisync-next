import { executeBillingBooking } from '../appointmentBillingBookingExecute'
import { resolveBillingCatalog, type BillingService } from '../appointmentBillingCatalog'
import { automaticAllocations } from '../subscriptionBenefitAuto'
import type { BillingIntent } from '../subscriptionBenefitLedger'
import type { LunaExecutionContext, LunaToolResult } from './contracts'
import { validateScheduleAvailability } from './schedulePolicy'

type ProposalRow = {
  id: string
  operation_kind: string
  status: string
  version: number
  payload_json: string
  fingerprint: string
  source_message_id: string
  expires_at_ms: number
  committed_operation_id: string | null
}

type JsonRecord = Record<string, unknown>
const record = (value: unknown): JsonRecord => value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {}
const text = (value: unknown) => String(value ?? '').trim()

function explicitConfirmation(value: string): boolean {
  const normalized = value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase()
  return /^(sim|confirmo|confirmado|ok|certo|fechado|pode confirmar|pode agendar|pode fechar)[.! ]*$/.test(normalized)
}

async function latestConfirmation(database: D1Database, context: LunaExecutionContext, proposal: ProposalRow): Promise<boolean> {
  if (proposal.source_message_id === context.sourceMessageId) return false
  const message = await database.prepare(`
    SELECT content_text FROM chat_messages
    WHERE tenant_id=?1 AND module_id=?2 AND thread_id=?3 AND external_message_id=?4
      AND direction='inbound' AND actor_type='customer' LIMIT 1
  `).bind(context.tenantId, context.moduleId, context.conversationId, context.sourceMessageId)
    .first<{ content_text: string }>()
  return Boolean(message && explicitConfirmation(message.content_text))
}

async function markProposal(database: D1Database, context: LunaExecutionContext, proposalId: string, status: string, operationId: string | null = null): Promise<void> {
  await database.prepare(`
    UPDATE luna_proposals SET status=?5,committed_operation_id=?6,updated_at_ms=?7
    WHERE tenant_id=?1 AND module_id=?2 AND conversation_id=?3 AND id=?4
  `).bind(context.tenantId, context.moduleId, context.conversationId, proposalId, status, operationId, Date.now()).run()
}

async function commitAppointment(database: D1Database, context: LunaExecutionContext, proposal: ProposalRow, payload: JsonRecord): Promise<LunaToolResult> {
  const customerId = text(payload.customer_id)
  const petId = text(payload.pet_id)
  const scheduledAtMs = Number(payload.scheduled_at_ms)
  const requestedServices = Array.isArray(payload.services) ? payload.services.map(record) : []
  const serviceCodes = requestedServices.map((service) => text(service.code || service.service_code)).filter(Boolean)
  const pet = await database.prepare(`SELECT client_id,species,weight_kg,status FROM pets WHERE tenant_id=?1 AND module_id=?2 AND id=?3 LIMIT 1`)
    .bind(context.tenantId, context.moduleId, petId).first<{ client_id: string; species: string; weight_kg: number | null; status: string }>()
  if (!pet || pet.status !== 'active' || pet.client_id !== customerId) return { ok: false, code: 'PROPOSAL_STALE', retryable: false }
  const commandPayload: JsonRecord = {
    client_id: customerId,
    pet_id: petId,
    scheduled_at: new Date(scheduledAtMs).toISOString(),
    services: serviceCodes.map((code) => ({ code })),
    source: 'whatsapp',
    status: 'scheduled',
    notes: text(payload.notes) || null,
    billing_intent: { type: 'auto', allocations: [] },
    idempotency_key: `luna-proposal:${proposal.id}`,
  }
  const catalog = await resolveBillingCatalog({
    db: database,
    tenantId: context.tenantId,
    moduleId: context.moduleId,
    species: pet.species,
    weightGrams: pet.weight_kg == null ? null : Math.round(Number(pet.weight_kg) * 1000),
    payload: commandPayload,
  })
  if (catalog.code || !catalog.items?.length) return { ok: false, code: catalog.code || 'PROPOSAL_STALE', retryable: false }
  const currentSubtotal = catalog.items.reduce((sum, item) => sum + Math.round(Number(item.catalog_price || 0) * 100), 0)
  if (currentSubtotal !== Number(payload.subtotal_cents)) return { ok: false, code: 'PROPOSAL_STALE', retryable: false }
  const duration = catalog.items.reduce((sum, item) => sum + Number(item.duration_min || 0), 0)
  const availability = await validateScheduleAvailability({
    database, tenantId: context.tenantId, moduleId: context.moduleId,
    scheduledAtMs, durationMinutes: duration,
  })
  if (!availability.ok) return { ok: false, code: availability.code, retryable: false }

  const items = catalog.items as BillingService[]
  const allocations = await automaticAllocations(database, {
    tenantId: context.tenantId, moduleId: context.moduleId, clientId: customerId,
  }, items)
  const intent: BillingIntent = { type: 'auto', allocations: [] }
  const appointmentId = crypto.randomUUID()
  const response = await executeBillingBooking({ DB: database }, commandPayload, {
    party: {
      tenantId: context.tenantId, moduleId: context.moduleId, petId, clientId: customerId,
      species: pet.species, weightGrams: pet.weight_kg == null ? null : Math.round(Number(pet.weight_kg) * 1000),
    },
    items,
    allocations,
    intent,
    identity: { operationKey: `luna-proposal:${proposal.id}`, appointmentId, fingerprint: proposal.fingerprint },
  })
  const body = await response.json() as { data?: { appointment_id?: string; idempotent?: boolean }; code?: string }
  if (!response.ok || !body.data?.appointment_id) return { ok: false, code: body.code || 'APPOINTMENT_COMMIT_FAILED', retryable: response.status >= 500 }
  await markProposal(database, context, proposal.id, 'completed', body.data.appointment_id)
  return { ok: true, data: { operation_id: body.data.appointment_id, operation_kind: 'appointment_create', idempotent: Boolean(body.data.idempotent) } }
}

async function commitProductOrder(database: D1Database, context: LunaExecutionContext, proposal: ProposalRow, payload: JsonRecord): Promise<LunaToolResult> {
  const customerId = text(payload.customer_id)
  const items = Array.isArray(payload.items) ? payload.items.map(record) : []
  const fulfillment = payload.fulfillment_type === 'delivery' ? 'delivery' : 'counter'
  const operationKey = `luna-proposal:${proposal.id}`
  const existing = await database.prepare(`SELECT id FROM sales WHERE tenant_id=?1 AND module_id=?2 AND operation_key=?3 LIMIT 1`)
    .bind(context.tenantId, context.moduleId, operationKey).first<{ id: string }>()
  if (existing) {
    await markProposal(database, context, proposal.id, 'completed', existing.id)
    return { ok: true, data: { operation_id: existing.id, operation_kind: 'product_order_create', idempotent: true, status: 'pending' } }
  }

  const resolved: Array<{ productId: string; name: string; quantity: number; quantityMilliunits: number; priceCents: number; subtotalCents: number }> = []
  for (const proposed of items) {
    const productId = text(proposed.product_id)
    const quantity = Number(proposed.quantity)
    const product = await database.prepare(`
      SELECT p.id,p.name,p.price_cents,p.status,
        MAX(0,COALESCE(i.on_hand_milliunits,0)-COALESCE(i.reserved_milliunits,0)) AS available_milliunits
      FROM catalog_products p LEFT JOIN inventory_balances i
        ON i.tenant_id=p.tenant_id AND i.module_id=p.module_id AND i.product_id=p.id
      WHERE p.tenant_id=?1 AND p.module_id=?2 AND p.id=?3 LIMIT 1
    `).bind(context.tenantId, context.moduleId, productId).first<{ id: string; name: string; price_cents: number; status: string; available_milliunits: number }>()
    const quantityMilliunits = quantity * 1000
    const available = Number(product?.available_milliunits || 0)
    if (!product || product.status !== 'active' || !Number.isInteger(quantity) || quantity < 1 || available < quantityMilliunits) {
      return { ok: false, code: product && available < quantityMilliunits ? 'INSUFFICIENT_STOCK' : 'PROPOSAL_STALE', retryable: false }
    }
    if (product.price_cents !== Number(proposed.unit_price_cents)) return { ok: false, code: 'PROPOSAL_STALE', retryable: false }
    resolved.push({ productId, name: product.name, quantity, quantityMilliunits, priceCents: product.price_cents, subtotalCents: product.price_cents * quantity })
  }
  const totalCents = resolved.reduce((sum, item) => sum + item.subtotalCents, 0)
  if (totalCents !== Number(payload.total_cents)) return { ok: false, code: 'PROPOSAL_STALE', retryable: false }
  const saleId = crypto.randomUUID()
  const now = Date.now()
  const statements: D1PreparedStatement[] = [database.prepare(`
    INSERT INTO sales(
      tenant_id,module_id,id,operation_key,client_id,appointment_id,source,fulfillment_type,
      subtotal_cents,discount_cents,transport_fee_cents,total_cents,status,notes,created_at_ms,updated_at_ms
    ) VALUES(?1,?2,?3,?4,?5,NULL,'whatsapp',?6,?7,0,0,?7,'pending',?8,?9,?9)
  `).bind(context.tenantId, context.moduleId, saleId, operationKey, customerId, fulfillment, totalCents, 'Pedido criado pela Luna; pagamento ainda não recebido.', now)]
  resolved.forEach((item, index) => statements.push(database.prepare(`
    INSERT INTO sale_items(
      tenant_id,module_id,sale_id,position,item_type,product_id,service_id,item_name,
      quantity_milliunits,unit_price_cents,subtotal_cents,upsell
    ) VALUES(?1,?2,?3,?4,'product',?5,NULL,?6,?7,?8,?9,0)
  `).bind(context.tenantId, context.moduleId, saleId, index + 1, item.productId, item.name, item.quantityMilliunits, item.priceCents, item.subtotalCents)))
  try { await database.batch(statements) } catch {
    const raced = await database.prepare(`SELECT id FROM sales WHERE tenant_id=?1 AND module_id=?2 AND operation_key=?3 LIMIT 1`)
      .bind(context.tenantId, context.moduleId, operationKey).first<{ id: string }>()
    if (!raced) return { ok: false, code: 'ORDER_COMMIT_FAILED', retryable: true }
    await markProposal(database, context, proposal.id, 'completed', raced.id)
    return { ok: true, data: { operation_id: raced.id, operation_kind: 'product_order_create', idempotent: true, status: 'pending' } }
  }
  await markProposal(database, context, proposal.id, 'completed', saleId)
  return { ok: true, data: { operation_id: saleId, operation_kind: 'product_order_create', idempotent: false, status: 'pending' } }
}

async function commitAppointmentReschedule(database: D1Database, context: LunaExecutionContext, proposal: ProposalRow, payload: JsonRecord): Promise<LunaToolResult> {
  const appointmentId = text(payload.appointment_id)
  const customerId = text(payload.customer_id)
  const scheduledAtMs = Number(payload.scheduled_at_ms)
  const expectedVersion = Number(payload.appointment_version)
  const current = await database.prepare(`
    SELECT client_id,status,version,duration_min FROM appointments
    WHERE tenant_id=?1 AND module_id=?2 AND id=?3 LIMIT 1
  `).bind(context.tenantId, context.moduleId, appointmentId)
    .first<{ client_id: string; status: string; version: number; duration_min: number }>()
  if (!current || current.client_id !== customerId || !['scheduled', 'confirmed'].includes(current.status)) {
    return { ok: false, code: 'PROPOSAL_STALE', retryable: false }
  }
  if (current.version !== expectedVersion) return { ok: false, code: 'APPOINTMENT_CONCURRENT_CHANGE', retryable: false }
  const availability = await validateScheduleAvailability({
    database, tenantId: context.tenantId, moduleId: context.moduleId,
    scheduledAtMs, durationMinutes: current.duration_min, ignoreAppointmentId: appointmentId,
  })
  if (!availability.ok) return { ok: false, code: availability.code, retryable: false }
  const now = Date.now()
  await database.batch([
    database.prepare(`
      UPDATE appointments SET scheduled_at_ms=?4,version=version+1,updated_at_ms=?5
      WHERE tenant_id=?1 AND module_id=?2 AND id=?3 AND version=?6 AND status IN ('scheduled','confirmed')
    `).bind(context.tenantId, context.moduleId, appointmentId, scheduledAtMs, now, expectedVersion),
    database.prepare(`
      UPDATE luna_proposals SET status='completed',committed_operation_id=?5,updated_at_ms=?6
      WHERE tenant_id=?1 AND module_id=?2 AND conversation_id=?3 AND id=?4 AND status='executing'
        AND EXISTS(SELECT 1 FROM appointments a WHERE a.tenant_id=?1 AND a.module_id=?2 AND a.id=?5 AND a.version=?7 AND a.updated_at_ms=?6)
    `).bind(context.tenantId, context.moduleId, context.conversationId, proposal.id, appointmentId, now, expectedVersion + 1),
  ])
  const completed = await database.prepare(`
    SELECT status,committed_operation_id FROM luna_proposals
    WHERE tenant_id=?1 AND module_id=?2 AND id=?3 LIMIT 1
  `).bind(context.tenantId, context.moduleId, proposal.id).first<{ status: string; committed_operation_id: string | null }>()
  if (completed?.status !== 'completed') return { ok: false, code: 'APPOINTMENT_CONCURRENT_CHANGE', retryable: false }
  return { ok: true, data: { operation_id: appointmentId, operation_kind: 'appointment_reschedule', idempotent: false, scheduled_at_ms: scheduledAtMs } }
}

async function commitAppointmentCancellation(database: D1Database, context: LunaExecutionContext, proposal: ProposalRow, payload: JsonRecord): Promise<LunaToolResult> {
  const appointmentId = text(payload.appointment_id)
  const customerId = text(payload.customer_id)
  const expectedVersion = Number(payload.appointment_version)
  const current = await database.prepare(`
    SELECT client_id,status,version FROM appointments
    WHERE tenant_id=?1 AND module_id=?2 AND id=?3 LIMIT 1
  `).bind(context.tenantId, context.moduleId, appointmentId)
    .first<{ client_id: string; status: string; version: number }>()
  if (!current || current.client_id !== customerId || !['scheduled', 'confirmed'].includes(current.status)) {
    return { ok: false, code: 'PROPOSAL_STALE', retryable: false }
  }
  if (current.version !== expectedVersion) return { ok: false, code: 'APPOINTMENT_CONCURRENT_CHANGE', retryable: false }
  const reason = text(payload.reason)
  const auditNote = reason ? `Cancelado pela Luna: ${reason}` : 'Cancelado pela Luna mediante confirmação do cliente.'
  const now = Date.now()
  await database.batch([
    database.prepare(`
      UPDATE appointments SET status='cancelled',notes=CASE WHEN notes IS NULL OR trim(notes)='' THEN ?4 ELSE notes || ' | ' || ?4 END,
        version=version+1,updated_at_ms=?5
      WHERE tenant_id=?1 AND module_id=?2 AND id=?3 AND version=?6 AND status IN ('scheduled','confirmed')
    `).bind(context.tenantId, context.moduleId, appointmentId, auditNote, now, expectedVersion),
    database.prepare(`
      UPDATE luna_proposals SET status='completed',committed_operation_id=?5,updated_at_ms=?6
      WHERE tenant_id=?1 AND module_id=?2 AND conversation_id=?3 AND id=?4 AND status='executing'
        AND EXISTS(SELECT 1 FROM appointments a WHERE a.tenant_id=?1 AND a.module_id=?2 AND a.id=?5 AND a.status='cancelled' AND a.version=?7 AND a.updated_at_ms=?6)
    `).bind(context.tenantId, context.moduleId, context.conversationId, proposal.id, appointmentId, now, expectedVersion + 1),
  ])
  const completed = await database.prepare(`
    SELECT status FROM luna_proposals WHERE tenant_id=?1 AND module_id=?2 AND id=?3 LIMIT 1
  `).bind(context.tenantId, context.moduleId, proposal.id).first<{ status: string }>()
  if (completed?.status !== 'completed') return { ok: false, code: 'APPOINTMENT_CONCURRENT_CHANGE', retryable: false }
  return { ok: true, data: { operation_id: appointmentId, operation_kind: 'appointment_cancel', idempotent: false, status: 'cancelled' } }
}

export async function commitConfirmedProposal(database: D1Database, context: LunaExecutionContext, proposalId: string, proposalVersion: number): Promise<LunaToolResult> {
  const proposal = await database.prepare(`
    SELECT id,operation_kind,status,version,payload_json,fingerprint,source_message_id,expires_at_ms,committed_operation_id
    FROM luna_proposals WHERE tenant_id=?1 AND module_id=?2 AND conversation_id=?3 AND id=?4 LIMIT 1
  `).bind(context.tenantId, context.moduleId, context.conversationId, proposalId).first<ProposalRow>()
  if (!proposal) return { ok: false, code: 'PROPOSAL_NOT_FOUND', retryable: false }
  if (proposal.version !== proposalVersion) return { ok: false, code: 'PROPOSAL_STALE', retryable: false }
  if (proposal.status === 'completed' && proposal.committed_operation_id) {
    return { ok: true, data: { operation_id: proposal.committed_operation_id, operation_kind: proposal.operation_kind, idempotent: true } }
  }
  if (!['awaiting_confirmation', 'executing'].includes(proposal.status)) return { ok: false, code: 'PROPOSAL_NOT_EXECUTABLE', retryable: false }
  if (proposal.expires_at_ms < Date.now()) {
    await markProposal(database, context, proposal.id, 'invalidated')
    return { ok: false, code: 'PROPOSAL_EXPIRED', retryable: false }
  }
  if (!await latestConfirmation(database, context, proposal)) return { ok: false, code: 'CONFIRMATION_REQUIRED', retryable: false }
  await markProposal(database, context, proposal.id, 'executing')
  let payload: JsonRecord
  try { payload = record(JSON.parse(proposal.payload_json)) }
  catch {
    await markProposal(database, context, proposal.id, 'failed')
    return { ok: false, code: 'PROPOSAL_PAYLOAD_INVALID', retryable: false }
  }
  const result = proposal.operation_kind === 'appointment_create'
    ? await commitAppointment(database, context, proposal, payload)
    : proposal.operation_kind === 'product_order_create'
      ? await commitProductOrder(database, context, proposal, payload)
      : proposal.operation_kind === 'appointment_reschedule'
        ? await commitAppointmentReschedule(database, context, proposal, payload)
        : proposal.operation_kind === 'appointment_cancel'
          ? await commitAppointmentCancellation(database, context, proposal, payload)
          : { ok: false as const, code: 'OPERATION_NOT_SUPPORTED', retryable: false }
  if (!result.ok && !['CONFIRMATION_REQUIRED', 'PROPOSAL_EXPIRED'].includes(result.code)) {
    await markProposal(database, context, proposal.id, result.retryable ? 'executing' : 'invalidated')
  }
  return result
}
