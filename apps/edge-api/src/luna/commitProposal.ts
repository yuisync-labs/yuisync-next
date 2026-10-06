import { executeBillingBooking } from '../appointmentBillingBookingExecute'
import { resolveBillingCatalog, type BillingService } from '../appointmentBillingCatalog'
import { automaticAllocations } from '../subscriptionBenefitAuto'
import type { BillingIntent } from '../subscriptionBenefitLedger'
import type { LunaExecutionContext, LunaToolResult } from './contracts'
import { validateScheduleAvailability } from './schedulePolicy'
import { reservePendingOrderStock } from '../pendingOrderStockReservation'
import { LunaConversationRepository } from './conversationRepository'
import { canonicalJson } from './canonicalJson'
import { commitRegistration, proposalCustomerAuthorized } from './registrationCommands'
import { resolveDeliverySnapshot } from './deliveryContract'
import { saleDeliveryAddressStatement } from '../saleDeliveryAddress'
import { appointmentScheduleGuardStatement } from '../appointmentScheduleGuard'
import { validateGroomingMachine } from '../groomingMachinePolicy'
import { resolveTransportSnapshot } from './transportContract'

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

export function explicitConfirmation(value: string, operationKind: string): boolean {
  const normalized = value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase()
  if (/^(sim|confirmo|confirmado|ok|certo|fechado|pode confirmar|pode agendar|pode fechar)[.! ]*$/.test(normalized)) return true
  // This is a narrow authorization grammar, not a conversational classifier.
  // Named confirmations must match the operation actually presented. Any
  // correction, qualification or negation stays outside this grammar.
  const subjects: Record<string, string[]> = {
    appointment_create: ['o horario', 'o agendamento', 'o banho', 'o resumo do banho', 'o resumo do agendamento'],
    appointment_reschedule: ['a mudanca', 'o reagendamento'],
    appointment_cancel: ['o cancelamento'],
    product_order_create: ['o pedido', 'a compra', 'o resumo do pedido'],
    customer_registration: ['o cadastro'], pet_registration: ['o cadastro'],
  }
  const phrase = normalized.replace(/[.! ]+$/, '')
  return (subjects[operationKind] ?? []).some(subject => phrase === `confirmo ${subject}`)
}

async function latestConfirmation(database: D1Database, context: LunaExecutionContext, proposal: ProposalRow): Promise<boolean> {
  if (proposal.source_message_id === context.sourceMessageId) return false
  const message = await database.prepare(`
    SELECT id,content_text,created_at_ms FROM chat_messages
    WHERE tenant_id=?1 AND module_id=?2 AND thread_id=?3 AND external_message_id=?4
      AND direction='inbound' AND actor_type='customer' LIMIT 1
  `).bind(context.tenantId, context.moduleId, context.conversationId, context.sourceMessageId)
    .first<{ id: string; content_text: string; created_at_ms: number }>()
  if (!message || !explicitConfirmation(message.content_text, proposal.operation_kind)) return false
  const presentation = await database.prepare(`SELECT outbound_message_id,presented_at_ms FROM luna_proposal_presentations
    WHERE tenant_id=?1 AND module_id=?2 AND conversation_id=?3 AND proposal_id=?4 AND proposal_version=?5 AND fingerprint=?6`)
    .bind(context.tenantId, context.moduleId, context.conversationId, proposal.id, proposal.version, proposal.fingerprint)
    .first<{ outbound_message_id: string; presented_at_ms: number }>()
  if (!presentation || message.created_at_ms <= presentation.presented_at_ms) return false
  // Any intervening question/answer suspends the target. Multiple summaries in
  // one message are deliberately ambiguous: a bare "sim" cannot select one.
  const intervening = await database.prepare(`SELECT id FROM chat_messages WHERE tenant_id=?1 AND module_id=?2 AND thread_id=?3
    AND id<>?4 AND id<>?5 AND created_at_ms>=?6 AND created_at_ms<=?7 LIMIT 1`)
    .bind(context.tenantId, context.moduleId, context.conversationId, message.id, presentation.outbound_message_id, presentation.presented_at_ms, message.created_at_ms).first()
  const other = await database.prepare(`SELECT proposal_id FROM luna_proposal_presentations WHERE tenant_id=?1 AND module_id=?2 AND conversation_id=?3 AND outbound_message_id=?4 AND proposal_id<>?5 LIMIT 1`)
    .bind(context.tenantId, context.moduleId, context.conversationId, presentation.outbound_message_id, proposal.id).first()
  return !intervening && !other
}

async function markProposal(database: D1Database, context: LunaExecutionContext, proposalId: string, status: string, operationId: string | null = null): Promise<void> {
  await database.prepare(`
    UPDATE luna_proposals SET status=?5,committed_operation_id=?6,updated_at_ms=?7
    WHERE tenant_id=?1 AND module_id=?2 AND conversation_id=?3 AND id=?4
  `).bind(context.tenantId, context.moduleId, context.conversationId, proposalId, status, operationId, Date.now()).run()
}

// Reconcile before revalidating availability/price: the previous request may
// have committed and lost its response. Never issue a second write merely
// because the proposal's completion marker was not persisted.
export async function reconcileProposalOperation(database: D1Database, context: LunaExecutionContext, proposal: ProposalRow): Promise<LunaToolResult> {
  if (proposal.status === 'completed' && proposal.committed_operation_id) {
    return { ok: true, data: { operation_id: proposal.committed_operation_id, operation_kind: proposal.operation_kind, idempotent: true } }
  }
  if (proposal.status !== 'executing') return { ok: true, data: { proposal_id: proposal.id, status: proposal.status, committed: false } }
  const operationKey = `luna-proposal:${proposal.id}`
  let existing: { id: string } | null = null
  if (proposal.operation_kind === 'appointment_create') {
    existing = await database.prepare(`SELECT id FROM appointments WHERE tenant_id=?1 AND module_id=?2 AND operation_key=?3 AND operation_fingerprint=?4 LIMIT 1`)
      .bind(context.tenantId, context.moduleId, operationKey, proposal.fingerprint).first<{ id: string }>()
  } else if (proposal.operation_kind === 'product_order_create') {
    existing = await database.prepare(`SELECT id FROM sales WHERE tenant_id=?1 AND module_id=?2 AND operation_key=?3 LIMIT 1`)
      .bind(context.tenantId, context.moduleId, operationKey).first<{ id: string }>()
  } else if (proposal.operation_kind.endsWith('_registration')) {
    const receipt = await database.prepare(`SELECT pet_id AS id FROM luna_registration_receipts WHERE tenant_id=?1 AND module_id=?2 AND proposal_id=?3`).bind(context.tenantId,context.moduleId,proposal.id).first<{ id: string }>()
    existing = receipt
  }
  if (!existing) return { ok: false, code: 'COMMIT_STATE_UNCERTAIN', retryable: false }
  await markProposal(database, context, proposal.id, 'completed', existing.id)
  return { ok: true, data: { operation_id: existing.id, operation_kind: proposal.operation_kind, idempotent: true } }
}

export async function getProposalOperationStatus(database: D1Database, context: LunaExecutionContext, proposalId: string): Promise<LunaToolResult> {
  const proposal = await database.prepare(`SELECT id,operation_kind,status,version,payload_json,fingerprint,source_message_id,expires_at_ms,committed_operation_id FROM luna_proposals WHERE tenant_id=?1 AND module_id=?2 AND conversation_id=?3 AND id=?4 LIMIT 1`)
    .bind(context.tenantId, context.moduleId, context.conversationId, proposalId).first<ProposalRow>()
  if (!proposal) return { ok: false, code: 'PROPOSAL_NOT_FOUND', retryable: false }
  let payload: JsonRecord
  try { payload = record(JSON.parse(proposal.payload_json)) } catch { return { ok: false, code: 'PROPOSAL_PAYLOAD_INVALID', retryable: false } }
  if (!await proposalCustomerAuthorized(database, context, proposal.operation_kind, payload)) return { ok: false, code: 'CUSTOMER_SCOPE_DENIED', retryable: false }
  return reconcileProposalOperation(database, context, proposal)
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
    grooming_machine_no: payload.grooming_machine_no ?? null,
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
  const machine=validateGroomingMachine(catalog.items,payload.grooming_machine_no)
  if(!machine.ok)return{ok:false,code:machine.code,retryable:false}
  const currentSubtotal = catalog.items.reduce((sum, item) => sum + Math.round(Number(item.catalog_price || 0) * 100), 0)
  if (currentSubtotal !== Number(payload.subtotal_cents)) return { ok: false, code: 'PROPOSAL_STALE', retryable: false }
  const duration = catalog.items.reduce((sum, item) => sum + Number(item.duration_min || 0), 0)
  const availability = await validateScheduleAvailability({
    database, tenantId: context.tenantId, moduleId: context.moduleId,
    scheduledAtMs, durationMinutes: duration,
  })
  if (!availability.ok) return { ok: false, code: availability.code, retryable: false }
  const transport=payload.transport?await resolveTransportSnapshot(database,context,petId,scheduledAtMs,duration,payload.transport):null
  if(transport&&!transport.ok)return transport
  if(transport?.ok&&canonicalJson(transport.data)!==canonicalJson(payload.transport))return{ok:false,code:'TRANSPORT_QUOTE_CHANGED',retryable:false}
  const items = catalog.items as BillingService[]
  const allocations = await automaticAllocations(database, {
    tenantId: context.tenantId, moduleId: context.moduleId, clientId: customerId,
  }, items)
  if (canonicalJson(allocations) !== canonicalJson(payload.benefit_allocations ?? [])) return { ok: false, code: 'PACKAGE_BENEFITS_CHANGED', retryable: false }
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
    scheduleGuard: availability.policy,
    transport:transport?.ok?{snapshot:transport.data,phone:context.customerAddress}:undefined,
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
  const delivery = fulfillment==='delivery'?await resolveDeliverySnapshot(database,context,payload.delivery):null
  if(delivery && !delivery.ok)return delivery
  if(delivery?.ok && canonicalJson(delivery.data)!==canonicalJson(payload.delivery))return{ok:false,code:'DELIVERY_QUOTE_CHANGED',retryable:false}
  const subtotalCents = resolved.reduce((sum, item) => sum + item.subtotalCents, 0)
  const deliveryFeeCents = delivery?.ok?delivery.data.fee_cents:0
  const totalCents = subtotalCents+deliveryFeeCents
  if (totalCents !== Number(payload.total_cents)) return { ok: false, code: 'PROPOSAL_STALE', retryable: false }
  const saleId = crypto.randomUUID()
  const now = Date.now()
  const statements: D1PreparedStatement[] = [database.prepare(`
    INSERT INTO sales(
      tenant_id,module_id,id,operation_key,client_id,appointment_id,source,fulfillment_type,
      subtotal_cents,discount_cents,transport_fee_cents,total_cents,status,notes,created_at_ms,updated_at_ms
    ) VALUES(?1,?2,?3,?4,?5,NULL,'whatsapp',?6,?7,0,?8,?9,'pending',?10,?11,?11)
  `).bind(context.tenantId, context.moduleId, saleId, operationKey, customerId, fulfillment, subtotalCents,deliveryFeeCents,totalCents, 'Pedido criado pela Luna; pagamento ainda não recebido.', now)]
  if(delivery?.ok)statements.push(saleDeliveryAddressStatement(database,{tenantId:context.tenantId,moduleId:context.moduleId,saleId,address:delivery.data,now}))
  resolved.forEach((item, index) => statements.push(database.prepare(`
    INSERT INTO sale_items(
      tenant_id,module_id,sale_id,position,item_type,product_id,service_id,item_name,
      quantity_milliunits,unit_price_cents,subtotal_cents,upsell
    ) VALUES(?1,?2,?3,?4,'product',?5,NULL,?6,?7,?8,?9,0)
  `).bind(context.tenantId, context.moduleId, saleId, index + 1, item.productId, item.name, item.quantityMilliunits, item.priceCents, item.subtotalCents)))
  for (const item of resolved) statements.push(reservePendingOrderStock(database, {
    tenantId: context.tenantId, moduleId: context.moduleId, saleId,
    productId: item.productId, quantityMilliunits: item.quantityMilliunits,
    unitPriceCents: item.priceCents, now,
  }))
  try { await database.batch(statements) } catch (error) {
    const raced = await database.prepare(`SELECT id FROM sales WHERE tenant_id=?1 AND module_id=?2 AND operation_key=?3 LIMIT 1`)
      .bind(context.tenantId, context.moduleId, operationKey).first<{ id: string }>()
    if (!raced) {
      const known=String(error).includes('PENDING_ORDER_STOCK_CHANGED')?'ORDER_STOCK_OR_PRICE_CHANGED':String(error).includes('DELIVERY_QUOTE_CHANGED')?'DELIVERY_QUOTE_CHANGED':null
      return{ok:false,code:known??'ORDER_COMMIT_FAILED',retryable:!known}
    }
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
  try { await database.batch([
    appointmentScheduleGuardStatement(database,{tenantId:context.tenantId,moduleId:context.moduleId,appointmentId,guard:availability.policy}),
    database.prepare(`
      UPDATE appointments SET scheduled_at_ms=?4,version=version+1,updated_at_ms=?5
      WHERE tenant_id=?1 AND module_id=?2 AND id=?3 AND version=?6 AND status IN ('scheduled','confirmed')
    `).bind(context.tenantId, context.moduleId, appointmentId, scheduledAtMs, now, expectedVersion),
    database.prepare(`
      UPDATE luna_proposals SET status='completed',committed_operation_id=?5,updated_at_ms=?6
      WHERE tenant_id=?1 AND module_id=?2 AND conversation_id=?3 AND id=?4 AND status='executing'
        AND EXISTS(SELECT 1 FROM appointments a WHERE a.tenant_id=?1 AND a.module_id=?2 AND a.id=?5 AND a.version=?7 AND a.updated_at_ms=?6)
    `).bind(context.tenantId, context.moduleId, context.conversationId, proposal.id, appointmentId, now, expectedVersion + 1),
  ]) } catch(error) {
    const message=error instanceof Error?error.message:String(error)
    if(message.includes('SCHEDULE_CAPACITY_EXCEEDED'))return {ok:false,code:'SLOT_UNAVAILABLE',retryable:false}
    if(message.includes('SCHEDULE_POLICY_CHANGED'))return {ok:false,code:'SCHEDULE_POLICY_CHANGED',retryable:false}
    // An ambiguous database failure is reconciled by operation ID, never retried here.
    throw error
  }
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
  let identityPayload: JsonRecord
  try { identityPayload = record(JSON.parse(proposal.payload_json)) }
  catch { return { ok: false, code: 'PROPOSAL_PAYLOAD_INVALID', retryable: false } }
  if (!await proposalCustomerAuthorized(database, context, proposal.operation_kind, identityPayload)) return { ok: false, code: 'CUSTOMER_SCOPE_DENIED', retryable: false }
  if (proposal.version !== proposalVersion) return { ok: false, code: 'PROPOSAL_STALE', retryable: false }
  if (proposal.status === 'executing' || proposal.status === 'completed') return reconcileProposalOperation(database, context, proposal)
  if (identityPayload.draft_operation_id) {
    const { state } = await new LunaConversationRepository(database).loadState(context)
    const draft = state.operations[text(identityPayload.draft_operation_id)]
    if (!draft || draft.version !== identityPayload.draft_version || draft.status !== 'active') return { ok: false, code: 'PROPOSAL_STALE', retryable: false }
  }
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
  const claimed = await database.prepare(`UPDATE luna_proposals SET status='executing',updated_at_ms=?6 WHERE tenant_id=?1 AND module_id=?2 AND conversation_id=?3 AND id=?4 AND version=?5 AND status='awaiting_confirmation' RETURNING id`)
    .bind(context.tenantId, context.moduleId, context.conversationId, proposal.id, proposalVersion, Date.now()).first()
  if (!claimed) return getProposalOperationStatus(database, context, proposal.id)
  let payload: JsonRecord
  try { payload = record(JSON.parse(proposal.payload_json)) }
  catch {
    await markProposal(database, context, proposal.id, 'failed')
    return { ok: false, code: 'PROPOSAL_PAYLOAD_INVALID', retryable: false }
  }
  const result = proposal.operation_kind.endsWith('_registration')
    ? await commitRegistration(database, context, proposal.id, proposal.operation_kind, payload)
    : proposal.operation_kind === 'appointment_create'
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
