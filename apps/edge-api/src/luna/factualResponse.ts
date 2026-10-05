import type { LunaToolResult } from './contracts'
import { normalizeBusinessHours } from '../businessHours'

export type FactualEvidence = { callId: string; tool: string; result: LunaToolResult }
type Fact = { id: string; text: string }
// The model chooses relevant verified facts and a conversational next step;
// it never supplies the values or assertions rendered to the customer.
const openings: Record<string, string> = { none: '', welcome: 'Olá! Como posso ajudar?', acknowledge: 'Certo!', resume: 'Vamos continuar.', pause: 'Sem problema.', thanks: 'Por nada!' }
const questions: Record<string, string> = {
  none: '', date: 'Qual dia você prefere?', period: 'Você prefere de manhã ou à tarde?', pet: 'Para qual pet?',
  service: 'Qual serviço você gostaria?', product: 'Qual produto você procura?', quantity: 'Qual quantidade?',
  address: 'Qual é o endereço e uma referência?', city: 'Em qual cidade e bairro?', fulfillment: 'Você prefere retirar ou receber em casa?',
  choice: 'Qual das opções você prefere?', clarify: 'Pode me explicar qual opção você quis dizer?',
  machine: 'Qual número você prefere para a tosa na máquina?', name: 'Qual é o nome?', human: 'Você prefere falar com uma pessoa da equipe?',
}
const obj = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {}
const money = (v: unknown) => Number.isSafeInteger(v) && Number(v) >= 0 ? `R$ ${(Number(v) / 100).toFixed(2).replace('.', ',')}` : null
const safeText = (v: unknown) => typeof v === 'string' && v.trim() && v.length <= 1000 ? v.replace(/[\r\n\u0000-\u001f]/g, ' ').trim() : null

export function buildVerifiedFacts(evidence: readonly FactualEvidence[]): Fact[] {
  const facts: Fact[] = []
  const add = (e: FactualEvidence, suffix: string, text: string | null) => { if (text) facts.push({ id: `${e.callId}:${suffix}`, text }) }
  for (const e of evidence) {
    if (!e.result.ok) {
      // No code or argument supplied by the model becomes a customer claim.
      add(e, 'unavailable', e.result.code === 'COMMIT_STATE_UNCERTAIN'
        ? 'Não consegui verificar o resultado da operação. Não vou repetir a gravação sem conferência.'
        : 'Essa consulta ou ação não pôde ser concluída. Não tenho um resultado confirmado para informar.')
      continue
    }
    const data = obj(e.result.data)
    if (e.tool === 'search_products') {
      const rows = Array.isArray(data.products) ? data.products : []
      if (!rows.length) add(e, 'empty', 'Nenhum produto foi encontrado nessa consulta.')
      rows.forEach((raw, i) => {
        const p = obj(raw), name = safeText(p.name), price = money(p.price_cents), stock = p.available_milliunits
        if (name && price && Number.isSafeInteger(stock) && Number(stock) >= 0) add(e, `product.${i}`, `${name}: ${price}; estoque disponível nesta consulta: ${Number(stock) / 1000}.`)
      })
    } else if (e.tool === 'search_services') {
      const rows = Array.isArray(data.services) ? data.services : []
      if (!rows.length) add(e, 'empty', 'Nenhum serviço foi encontrado nessa consulta.')
      rows.forEach((raw, i) => {
        const s = obj(raw), name = safeText(s.name), price = money(s.default_price_cents), duration = s.default_duration_min
        if (name && price && Number.isSafeInteger(duration) && Number(duration) > 0) add(e, `service.${i}`, `${name}: ${price}; duração cadastrada: ${duration} minutos.`)
      })
    } else if (e.tool === 'get_customer_context') {
      const rows = Array.isArray(data.pets) ? data.pets : []
      rows.forEach((raw, i) => { const name = safeText(obj(raw).name); if (name) add(e, `pet.${i}`, `Pet cadastrado: ${name}.`) })
    } else if (e.tool === 'get_delivery_quote') {
      const fee = money(data.fee_cents), city = safeText(data.city), neighborhood = safeText(data.neighborhood)
      if (fee && city && neighborhood) add(e, 'delivery', `Entrega em ${neighborhood}, ${city}: taxa de ${fee}.`)
    } else if (e.tool === 'get_transport_quote') {
      const rows = Array.isArray(data.options) ? data.options : []
      if (!rows.length) add(e, 'empty', 'Nenhuma opção de transporte foi encontrada para essa consulta.')
      rows.forEach((raw, i) => { const r = obj(raw), label = safeText(r.label), fee = money(r.fee_cents); if (label && fee) add(e, `transport.${i}`, `${label}: ${fee}. A capacidade de transporte ainda precisa ser confirmada.`) })
    } else if (e.tool === 'get_store_information') {
      for (const [field, label] of [['store_name', 'Loja'], ['phone', 'Contato'], ['address', 'Endereço'], ['neighborhood', 'Bairro'], ['city', 'Cidade']] as const) {
        const value = safeText(data[field]); if (value) add(e, field, `${label}: ${value}.`)
      }
      const hours = normalizeBusinessHours(data.business_hours)
      if (hours) {
        const days = ['segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado', 'domingo']
        for (let day = 1; day <= 7; day += 1) add(e, `hours.${day}`, `${days[day - 1]}: ${hours[String(day)].length ? hours[String(day)].map(period => `${period.open}–${period.close}`).join(', ') : 'fechado'}.`)
      }
    } else if (e.tool === 'get_available_slots') {
      const slots = Array.isArray(data.slots) ? data.slots : [], timezone = safeText(data.timezone)
      if (!slots.length) add(e, 'empty', 'Nenhum horário disponível foi encontrado nessa janela da consulta.')
      if (timezone) slots.forEach((value, i) => {
        if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) return
        try {
          const formatted = new Intl.DateTimeFormat('pt-BR', { timeZone: timezone, dateStyle: 'short', timeStyle: 'short' }).format(new Date(value))
          add(e, `slot.${i}`, `Opção consultada: ${formatted} (${timezone}). Ainda não reservada; será revalidada na confirmação.`)
        } catch { /* invalid source timezone is not an operational fact */ }
      })
    } else if (e.tool === 'get_package_eligibility') {
      const rows = Array.isArray(data.benefits) ? data.benefits : []
      if (!rows.length) add(e, 'empty', 'Nenhum benefício disponível foi encontrado nessa consulta.')
      rows.forEach((raw, i) => { const r = obj(raw), name = safeText(r.plan_name); if (name && Number.isSafeInteger(r.available) && Number(r.available) >= 0) add(e, `benefit.${i}`, `${name}: ${r.available} benefício(s) disponível(is) nesta consulta. O uso será revalidado na confirmação.`) })
    } else if (e.tool === 'commit_confirmed_proposal' || e.tool === 'get_operation_status') {
      if (typeof data.operation_id === 'string') {
        const kind = data.operation_kind
        if (kind === 'product_order_create') add(e, 'result', 'Pedido registrado. Isso não significa que o pagamento foi recebido.')
        else if (kind === 'appointment_create') add(e, 'result', 'Agendamento registrado.')
        else if (kind === 'appointment_reschedule') add(e, 'result', 'Agendamento reagendado.')
        else if (kind === 'appointment_cancel') add(e, 'result', 'Agendamento cancelado.')
      }
    }
  }
  return facts
}

export function responseContractInstruction(facts: readonly Fact[]): string {
  return `RESPOSTA VERIFICADA: retorne somente JSON {"opening":"none","facts":["id"],"question":"none"}. Não escreva valores, fatos ou frases livres. Escolha IDs relevantes da lista abaixo; não confirme operação por conta própria. Opening permitido: ${Object.keys(openings).join(', ')}. Question permitido: ${Object.keys(questions).join(', ')}. Fatos verificados: ${JSON.stringify(facts)}. Os resumos comerciais serão anexados pelo servidor.`
}

export function validateFactualResponse(content: string | null, facts: readonly Fact[]): string | null {
  let value: unknown
  try { value = JSON.parse(content ?? '') } catch { return null }
  const r = obj(value)
  if (Object.keys(r).length !== 3 || !Object.hasOwn(openings, String(r.opening)) || !Object.hasOwn(questions, String(r.question)) || !Array.isArray(r.facts) || r.facts.length > 12) return null
  if (new Set(r.facts).size !== r.facts.length) return null
  const indexed = new Map(facts.map(f => [f.id, f.text]))
  if (r.facts.some(id => typeof id !== 'string' || !indexed.has(id))) return null
  const reply = [openings[String(r.opening)], ...r.facts.map(id => indexed.get(id)), questions[String(r.question)]].filter(Boolean).join('\n')
  return reply || null
}

export function safeFactualFallback(facts: readonly Fact[]): string {
  return facts.length ? facts.slice(-6).map(f => f.text).join('\n') : 'Não tenho dados verificados suficientes para responder a essa etapa. Pode esclarecer o que você precisa?'
}
