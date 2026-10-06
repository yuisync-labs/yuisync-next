import type { LunaExecutionContext } from './contracts'
import { acceptResponseMemory } from './conversationalMemory'
export type PresentableProposal = { id: string; version: number; fingerprint: string; operation_kind: string; payload_json: string }
const money = (value: unknown) => Number.isSafeInteger(value) ? `R$ ${(Number(value) / 100).toFixed(2).replace('.', ',')}` : 'valor indisponível'
export function renderProposalSummary(row: PresentableProposal): string {
  const payload = JSON.parse(row.payload_json) as Record<string, unknown>
  const lines = [`Resumo para confirmação — ${row.operation_kind}`, `Cliente: ${String(payload.customer_name ?? payload.customer_id)}`]
  if (payload.pet_name) lines.push(`Pet: ${String(payload.pet_name)}`)
  if(payload.grooming_machine_no!=null)lines.push(`Número da máquina: ${String(payload.grooming_machine_no)}`)
  if(payload.transport){const t=payload.transport as Record<string,unknown>;lines.push(`Transporte: ${String(t.label)} — ${money(t.fee_cents)}`,`Endereço: ${String(t.address)}, ${String(t.city)}`);if(t.reference)lines.push(`Referência: ${String(t.reference)}`)}
  if (row.operation_kind.endsWith('_registration')) {
    lines.push(`Espécie: ${String(payload.species)}`)
    if (payload.breed) lines.push(`Raça: ${String(payload.breed)}`)
    if (payload.weight_kg != null) lines.push(`Peso: ${String(payload.weight_kg)} kg`)
  }
  if (payload.scheduled_at_ms) lines.push(`Data/hora: ${new Date(Number(payload.scheduled_at_ms)).toISOString()}`)
  for (const raw of (Array.isArray(payload.items) ? payload.items : Array.isArray(payload.services) ? payload.services : [])) {
    const item = raw as Record<string, unknown>
    lines.push(`${String(item.name ?? item.code)}${item.quantity ? ` × ${String(item.quantity)}` : ''}: ${money(item.subtotal_cents ?? item.price_cents ?? item.unit_price_cents ?? item.default_price_cents)}`)
  }
  if (payload.fulfillment_type) lines.push(`Modalidade: ${payload.fulfillment_type === 'counter' ? 'retirada' : 'entrega'}`)
  if(payload.fulfillment_type==='delivery' && payload.delivery){const a=payload.delivery as Record<string,unknown>;lines.push(`Entrega: ${String(a.street)}, ${String(a.number)} — ${String(a.neighborhood)}, ${String(a.city)}`);if(a.reference)lines.push(`Referência: ${String(a.reference)}`);if(a.complement)lines.push(`Complemento: ${String(a.complement)}`);lines.push(`Taxa de entrega: ${money(a.fee_cents)}`)}
  if (payload.notes) lines.push(`Observações: ${String(payload.notes)}`)
  if (payload.reason) lines.push(`Motivo: ${String(payload.reason)}`)
  if (Array.isArray(payload.benefit_allocations)) for (const raw of payload.benefit_allocations) {
    const allocation = raw as Record<string, unknown>
    lines.push(`Benefício de pacote: ${String(allocation.planName)} — ${String(allocation.serviceCode)}. Sujeito à revalidação na confirmação.`)
  }
  if (payload.total_cents !== undefined) lines.push(`Total: ${money(payload.total_cents)}`)
  else if (payload.subtotal_cents !== undefined) lines.push(`Serviços: ${money(payload.subtotal_cents)}`)
  if (payload.operation_kind === 'product_order_create' || row.operation_kind === 'product_order_create') lines.push('O pedido ficará pendente; isto não confirma pagamento.')
  lines.push('Você confirma este resumo?')
  return lines.join('\n')
}

export async function loadPresentableProposals(database: D1Database, context: LunaExecutionContext, ids: readonly string[]): Promise<PresentableProposal[]> {
  const rows: PresentableProposal[] = []
  for (const id of [...new Set(ids)].slice(0, 12)) {
    const row = await database.prepare(`SELECT id,version,fingerprint,operation_kind,payload_json FROM luna_proposals
      WHERE tenant_id=?1 AND module_id=?2 AND conversation_id=?3 AND id=?4 AND status='awaiting_confirmation' AND expires_at_ms>=?5`)
      .bind(context.tenantId, context.moduleId, context.conversationId, id, Date.now()).first<PresentableProposal>()
    if (row) rows.push(row)
  }
  return rows
}

// Called ONLY after a persisted playground message or provider-accepted WhatsApp send.
export async function recordProposalPresentation(database: D1Database, context: LunaExecutionContext, ids: readonly string[], messageId: string): Promise<void> {
  const message = await database.prepare(`SELECT content_text,created_at_ms FROM chat_messages WHERE tenant_id=?1 AND module_id=?2 AND thread_id=?3 AND id=?4 AND direction='outbound' AND actor_type='assistant'`)
    .bind(context.tenantId, context.moduleId, context.conversationId, messageId).first<{ content_text: string;created_at_ms:number }>()
  if (!message) throw new Error('PRESENTATION_MESSAGE_MISSING')
  const presentedAt=Math.max(Date.now(),message.created_at_ms)
  await acceptResponseMemory(database,context,messageId,message.content_text,presentedAt)
  const rows = await loadPresentableProposals(database, context, ids)
  for (const row of rows) {
    if (!message.content_text.includes(renderProposalSummary(row))) throw new Error('PRESENTATION_SUMMARY_MISSING')
    await database.prepare(`INSERT INTO luna_proposal_presentations(tenant_id,module_id,conversation_id,proposal_id,proposal_version,fingerprint,outbound_message_id,presented_at_ms)
      VALUES(?1,?2,?3,?4,?5,?6,?7,?8) ON CONFLICT(tenant_id,module_id,conversation_id,proposal_id) DO UPDATE SET
      proposal_version=excluded.proposal_version,fingerprint=excluded.fingerprint,outbound_message_id=excluded.outbound_message_id,presented_at_ms=excluded.presented_at_ms`)
      .bind(context.tenantId, context.moduleId, context.conversationId, row.id, row.version, row.fingerprint, messageId, presentedAt).run()
  }
}
