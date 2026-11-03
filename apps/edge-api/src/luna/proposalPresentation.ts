import { lunaNow } from './clock'
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
    if (payload.species) lines.push(`Espécie: ${({ dog: 'Cachorro', cat: 'Gato', bird: 'Ave', rabbit: 'Coelho', fish: 'Peixe', other: 'Outro' } as Record<string, string>)[String(payload.species)] ?? String(payload.species)}`)
    if (payload.breed) lines.push(`Raça: ${String(payload.breed)}`)
    if (payload.weight_kg != null) lines.push(`Peso: ${String(payload.weight_kg)} kg`)
    if (payload.tutor_birth_date) lines.push(`Nascimento do tutor: ${String(payload.tutor_birth_date).split('-').reverse().join('/')}`)
    // The summary is stored as a chat message: only the CPF's edges are shown.
    if (payload.cpf) lines.push(`CPF: ${String(payload.cpf).replace(/^(\d{3})\d{6}(\d{2})$/, '$1.***.***-$2')}`)
    if (payload.postal_code) lines.push(`CEP: ${String(payload.postal_code).replace(/^(\d{5})(\d{3})$/, '$1-$2')}`)
    if (payload.address_number) lines.push(`Endereço: ${payload.street ? String(payload.street) + ', ' : ''}nº ${String(payload.address_number)}${payload.neighborhood ? ' - ' + String(payload.neighborhood) : ''}${payload.city ? ', ' + String(payload.city) : ''}`)
    if (payload.address_reference) lines.push(`Referência: ${String(payload.address_reference)}`)
  }
  if (payload.scheduled_at_ms) lines.push(`Data/hora: ${new Date(Number(payload.scheduled_at_ms)).toISOString()}`)
  for (const raw of (Array.isArray(payload.items) ? payload.items : Array.isArray(payload.services) ? payload.services : [])) {
    const item = raw as Record<string, unknown>
    lines.push(`${String(item.name ?? item.code)}${item.quantity ? ` × ${String(item.quantity)}` : ''}${item.pet_name?' — '+String(item.pet_name):''}: ${money(item.subtotal_cents ?? item.price_cents ?? item.unit_price_cents ?? item.default_price_cents)}`)
  }
  if (payload.fulfillment_type) lines.push(`Modalidade: ${payload.fulfillment_type === 'counter' ? 'retirada' : 'entrega'}`)
  if(payload.pickup_reference)lines.push('Retirada: '+String(payload.pickup_reference))
  if(payload.payment_preference)lines.push('Pagamento: '+paymentLabel(String(payload.payment_preference))+' (ainda não recebido)')
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

// Same validated payload and proof, with customer-facing labels and store time.
export type SummaryStore={store_name?:string|null;address?:string|null;neighborhood?:string|null;city?:string|null}
export function renderThinkProposalSummary(row:PresentableProposal,timezone:string,store?:SummaryStore):string{
  if(row.operation_kind==='appointment_create')return renderBookingSummary(row,timezone,store)
  const link=JSON.parse(row.payload_json) as Record<string,unknown>
  if(row.operation_kind==='customer_registration'&&link.link_client_id)return ['Já temos seu cadastro aqui!',`Você é ${String(link.customer_name)}${link.on_file_address?', da '+String(link.on_file_address):''}?`,...(link.pet_exists?[]:[`Vou incluir ${String(link.pet_name)}${link.breed?' ('+String(link.breed)+')':''} no seu cadastro.`]),'Você confirma?'].join('\n')
  const labels:Record<string,string>={product_order_create:'seu pedido',appointment_create:'o agendamento',appointment_reschedule:'a mudança de horário',appointment_cancel:'o cancelamento',customer_registration:'o cadastro',pet_registration:'o cadastro do pet'}
  const legacy=renderProposalSummary(row).split('\n')
  const payload=JSON.parse(row.payload_json) as Record<string,unknown>
  const lines=legacy.map(line=>line.startsWith('Resumo para confirmação')?'Confira '+(labels[row.operation_kind]??'a operação')+':':line.startsWith('Data/hora:')?'Data e horário: '+new Intl.DateTimeFormat('pt-BR',{timeZone:timezone,dateStyle:'short',timeStyle:'short'}).format(Number(payload.scheduled_at_ms)):line)
  return lines.filter(line=>!line.startsWith('Cliente:')||Boolean(payload.customer_name)).join('\n')
}

export async function loadPresentableProposals(database: D1Database, context: LunaExecutionContext, ids: readonly string[]): Promise<PresentableProposal[]> {
  const rows: PresentableProposal[] = []
  for (const id of [...new Set(ids)].slice(0, 12)) {
    const row = await database.prepare(`SELECT id,version,fingerprint,operation_kind,payload_json FROM luna_proposals
      WHERE tenant_id=?1 AND module_id=?2 AND conversation_id=?3 AND id=?4 AND status='awaiting_confirmation' AND expires_at_ms>=?5`)
      .bind(context.tenantId, context.moduleId, context.conversationId, id, lunaNow(context)).first<PresentableProposal>()
    if (row) rows.push(row)
  }
  return rows
}

// Called ONLY after a persisted playground message or provider-accepted WhatsApp send.
export async function recordProposalPresentation(database: D1Database, context: LunaExecutionContext, ids: readonly string[], messageId: string,think?:{timezone:string;store?:SummaryStore}): Promise<void> {
  const message = await database.prepare(`SELECT content_text,created_at_ms FROM chat_messages WHERE tenant_id=?1 AND module_id=?2 AND thread_id=?3 AND id=?4 AND direction='outbound' AND actor_type='assistant'`)
    .bind(context.tenantId, context.moduleId, context.conversationId, messageId).first<{ content_text: string;created_at_ms:number }>()
  if (!message) throw new Error('PRESENTATION_MESSAGE_MISSING')
  const presentedAt=Math.max(lunaNow(context),message.created_at_ms)
  await acceptResponseMemory(database,context,messageId,message.content_text,presentedAt)
  const rows = await loadPresentableProposals(database, context, ids)
  for (const row of rows) {
    if (!message.content_text.includes(think?renderThinkProposalSummary(row,think.timezone,think.store):renderProposalSummary(row))) throw new Error('PRESENTATION_SUMMARY_MISSING')
    await database.prepare(`INSERT INTO luna_proposal_presentations(tenant_id,module_id,conversation_id,proposal_id,proposal_version,fingerprint,outbound_message_id,presented_at_ms)
      VALUES(?1,?2,?3,?4,?5,?6,?7,?8) ON CONFLICT(tenant_id,module_id,conversation_id,proposal_id) DO UPDATE SET
      proposal_version=excluded.proposal_version,fingerprint=excluded.fingerprint,outbound_message_id=excluded.outbound_message_id,presented_at_ms=excluded.presented_at_ms`)
      .bind(context.tenantId, context.moduleId, context.conversationId, row.id, row.version, row.fingerprint, messageId, presentedAt).run()
  }
}

// A booking summary in the layout the store already sends its customers:
// pet, value, place, address, date and time on their own lines.
function renderBookingSummary(row:PresentableProposal,timezone:string,store?:SummaryStore):string{
  const payload=JSON.parse(row.payload_json) as Record<string,unknown>,at=Number(payload.scheduled_at_ms)
  const part=(options:Intl.DateTimeFormatOptions)=>new Intl.DateTimeFormat('pt-BR',{timeZone:timezone,...options}).format(at)
  const lines=['Segue o resumo do seu agendamento:']
  if(payload.pet_name)lines.push(`Pet: ${String(payload.pet_name)}`)
  for(const raw of Array.isArray(payload.items)?payload.items:Array.isArray(payload.services)?payload.services:[]){const item=raw as Record<string,unknown>;lines.push(`Serviço: ${String(item.name??item.code)}${item.pet_name?' — '+String(item.pet_name):''}: ${money(item.subtotal_cents??item.price_cents??item.unit_price_cents??item.default_price_cents)}`)}
  if(payload.grooming_machine_no!=null)lines.push(`Número da máquina: ${String(payload.grooming_machine_no)}`)
  if(payload.transport){const t=payload.transport as Record<string,unknown>;lines.push(`Transporte: ${String(t.label)} — ${money(t.fee_cents)}`,`Endereço de busca/entrega: ${String(t.address)}, ${String(t.city)}`);if(t.reference)lines.push(`Referência: ${String(t.reference)}`)}
  const total=payload.total_cents??payload.subtotal_cents
  if(total!==undefined)lines.push(`Valor do agendamento: ${money(total)}`)
  if(store?.store_name)lines.push(`Local: ${store.store_name}${store.city?' - '+store.city:''}`)
  if(store?.address)lines.push(`Endereço: ${store.address}${store.neighborhood?' - '+store.neighborhood:''}${store.city?', '+store.city:''}`)
  if(Number.isFinite(at)&&at>0)lines.push(`Data: ${part({dateStyle:'short'})} (${part({weekday:'long'})})`,`Horário: ${part({hour:'2-digit',minute:'2-digit'})}`)
  if(payload.notes)lines.push(`Observações: ${String(payload.notes)}`)
  if(Array.isArray(payload.benefit_allocations))for(const raw of payload.benefit_allocations){const allocation=raw as Record<string,unknown>;lines.push(`Benefício de pacote: ${String(allocation.planName)} — ${String(allocation.serviceCode)}. Sujeito à revalidação na confirmação.`)}
  lines.push('Você confirma este resumo?')
  return lines.join('\n')
}

// The model saves the method as a code or in the customer's words.
const PAYMENT_LABELS: Record<string, string> = { pix: 'PIX', cash: 'dinheiro', money: 'dinheiro', dinheiro: 'dinheiro', card: 'cartão', credit_card: 'cartão de crédito', debit_card: 'cartão de débito', card_on_delivery: 'cartão na entrega', cash_on_delivery: 'dinheiro na entrega', pix_on_delivery: 'PIX na entrega', card_on_pickup: 'cartão na retirada', cash_on_pickup: 'dinheiro na retirada' }
export function paymentLabel(value: string): string {
  const key = value.trim().toLowerCase()
  if (PAYMENT_LABELS[key]) return PAYMENT_LABELS[key]
  return /^[a-z]+(?:_[a-z]+)+$/.test(key) ? key.replace(/_/g, ' ').replace(/\bcard\b/g, 'cartão').replace(/\bcash\b/g, 'dinheiro').replace(/\bon delivery\b/g, 'na entrega').replace(/\bon pickup\b/g, 'na retirada') : value.trim()
}
