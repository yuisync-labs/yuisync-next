import { lunaNow } from './clock'
import { clientRegistrationStatements } from '../clientRegistrationCommand'
import type { LunaExecutionContext, LunaToolResult } from './contracts'
import { isConversationCustomer } from './customerIdentity'

type Payload = Record<string, unknown>
const phone = (ctx: LunaExecutionContext) => ctx.customerAddress.replace(/^\+/, '')
export async function proposalCustomerAuthorized(db: D1Database, ctx: LunaExecutionContext, kind: string, payload: Payload): Promise<boolean> {
  if (kind !== 'customer_registration') return isConversationCustomer(db, ctx, String(payload.customer_id ?? ''))
  // A newly prepared customer does not exist yet. This authorization is only
  // for the server-generated phone-bound proposal, never a model-supplied ID.
  return /^\d{8,15}$/.test(phone(ctx)) && payload.registration_phone === phone(ctx) && typeof payload.customer_id === 'string' && typeof payload.pet_id === 'string'
}

export async function prepareRegistration(db: D1Database, ctx: LunaExecutionContext, args: Payload, existingCustomer: boolean): Promise<LunaToolResult<Payload>> {
  const name = String(args.customer_name ?? '').trim(), petName = String(args.pet_name ?? '').trim()
  if (!petName || petName.length > 160 || (!existingCustomer && (!name || name.length > 160)) || !/^\d{8,15}$/.test(phone(ctx))) return { ok: false, code: 'REGISTRATION_FIELDS_INVALID', retryable: false }
  if (!['dog','cat','bird','rabbit','fish','other'].includes(String(args.species))) return { ok: false, code: 'PET_SPECIES_REQUIRED', retryable: false }
  if (args.weight_kg != null && (!Number.isFinite(args.weight_kg) || Number(args.weight_kg) <= 0 || Number(args.weight_kg) > 200)) return { ok: false, code: 'PET_WEIGHT_INVALID', retryable: false }
  let customerId = String(args.customer_id ?? '')
  if (existingCustomer) {
    if (!await isConversationCustomer(db, ctx, customerId)) return { ok: false, code: 'CUSTOMER_SCOPE_DENIED', retryable: false }
    const duplicate = await db.prepare(`SELECT id FROM pets WHERE tenant_id=?1 AND module_id=?2 AND client_id=?3 AND status='active' AND name=?4 COLLATE NOCASE LIMIT 1`).bind(ctx.tenantId,ctx.moduleId,customerId,petName).first()
    if (duplicate) return { ok: false, code: 'PET_REGISTRATION_AMBIGUOUS', retryable: false }
  } else {
    const duplicate = await db.prepare(`SELECT id FROM clients WHERE tenant_id=?1 AND module_id=?2 AND status='active' AND (phone=?3 OR phone=?4) LIMIT 1`).bind(ctx.tenantId,ctx.moduleId,phone(ctx),`+${phone(ctx)}`).first()
    if (duplicate) return { ok: false, code: 'CUSTOMER_REGISTRATION_AMBIGUOUS', retryable: false }
    customerId = crypto.randomUUID()
  }
  return { ok: true, data: { customer_id: customerId, customer_name: name || null, pet_id: crypto.randomUUID(), pet_name: petName, species: args.species, breed: args.breed ?? null, weight_kg: args.weight_kg ?? null, registration_phone: phone(ctx) } }
}

export async function commitRegistration(db: D1Database, ctx: LunaExecutionContext, proposalId: string, kind: string, payload: Payload): Promise<LunaToolResult> {
  const existing = await db.prepare(`SELECT customer_id,pet_id FROM luna_registration_receipts WHERE tenant_id=?1 AND module_id=?2 AND proposal_id=?3`).bind(ctx.tenantId,ctx.moduleId,proposalId).first<{ customer_id: string; pet_id: string }>()
  if (existing) return { ok: true, data: { ...existing, operation_id: existing.pet_id, operation_kind: kind, idempotent: true } }
  const now = lunaNow(ctx), customerId = String(payload.customer_id), petId = String(payload.pet_id)
  const statements = clientRegistrationStatements(db, { tenantId: ctx.tenantId, moduleId: ctx.moduleId, clientId: customerId, petId, existingClient: kind === 'pet_registration', now, uniquePhone: true, uniquePet: true, fields: { owner_name: payload.customer_name, pet_name: payload.pet_name, phone: payload.registration_phone, species: payload.species, breed: payload.breed, weight_kg: payload.weight_kg } })
  statements.push(db.prepare(`INSERT INTO luna_registration_receipts(tenant_id,module_id,proposal_id,customer_id,pet_id,created_at_ms) VALUES(?1,?2,?3,?4,?5,?6)`).bind(ctx.tenantId,ctx.moduleId,proposalId,customerId,petId,now))
  statements.push(db.prepare(`UPDATE luna_proposals SET status='completed',committed_operation_id=?5,updated_at_ms=?6 WHERE tenant_id=?1 AND module_id=?2 AND conversation_id=?3 AND id=?4 AND status='executing'`).bind(ctx.tenantId,ctx.moduleId,ctx.conversationId,proposalId,petId,now))
  try { await db.batch(statements) } catch {
    const receipt = await db.prepare(`SELECT customer_id,pet_id FROM luna_registration_receipts WHERE tenant_id=?1 AND module_id=?2 AND proposal_id=?3`).bind(ctx.tenantId,ctx.moduleId,proposalId).first<{ customer_id: string; pet_id: string }>()
    if (receipt) return { ok: true, data: { ...receipt, operation_id: receipt.pet_id, operation_kind: kind, idempotent: true } }
    return { ok: false, code: 'REGISTRATION_CONCURRENT_OR_AMBIGUOUS', retryable: false }
  }
  return { ok: true, data: { customer_id: customerId, pet_id: petId, operation_id: petId, operation_kind: kind, idempotent: false } }
}
