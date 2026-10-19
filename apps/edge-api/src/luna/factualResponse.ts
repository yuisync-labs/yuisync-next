import type { LunaToolResult } from './contracts'
import { normalizeBusinessHours } from '../businessHours'
import { loadOperationalState } from './operationalState'

export type FactualEvidence = { callId: string; tool: string; result: LunaToolResult }
export type Fact = { id: string; text: string; reference?:import('./conversationalMemory').PresentedOption }
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
// Free discourse is deliberately non-commercial. The model composes its own
// connective language; it cannot use that channel to negate a fact, invent a
// value, promise availability or assert a payment. Operational clauses always
// reference verified atoms and are rendered by the server. This is a lexical
// boundary, not a collection of scenario-specific phrases.
const discourseVocabulary = new Set(('oi olá ola tudo bem certo claro combinado obrigada obrigado por nada entendi vamos continuar seguir retomar pausar conversar com calma aqui estou para pra te você voce ajudar ajudar-lhe pode podemos por partes primeiro depois agora então entao ótimo otimo perfeito sem problema tranquilamente tranquilo tranquila até ate breve bom boa dia tarde noite novamente seja bem-vindo bem-vinda bem-vindos bem-vindas atenção atencao valeu beleza pois e à a o os as um uma de do da dos das em no na nos nas ao aos seu sua seus suas nosso nossa nossos nossas isso este esta essa esse contigo comigo nós nos eu quer quiser precisar obrigadaço').split(' '))
function verifiedDiscourse(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim() || value.length > 240 || !/^[\p{L}\s,.!;:\-]+$/u.test(value)) return null
  const words = value.toLocaleLowerCase('pt-BR').match(/[\p{L}]+(?:-[\p{L}]+)*/gu) ?? []
  return words.length <= 40 && words.every(word => discourseVocabulary.has(word)) ? value.trim() : null
}
const money = (v: unknown) => Number.isSafeInteger(v) && Number(v) >= 0 ? `R$ ${(Number(v) / 100).toFixed(2).replace('.', ',')}` : null
const safeText = (v: unknown) => typeof v === 'string' && v.trim() && v.length <= 1000 ? v.replace(/[\r\n\u0000-\u001f]/g, ' ').trim() : null

export function buildVerifiedFacts(evidence: readonly FactualEvidence[]): Fact[] {
  const facts: Fact[] = []
  const add = (e: FactualEvidence, suffix: string, text: string | null,reference?:Fact['reference']) => { if (text) facts.push({ id: `${e.callId}:${suffix}`, text,...(reference?{reference}:{}) }) }
  for (const e of evidence) {
    if (!e.result.ok) {
      // A deduplicated attempt did not undo the earlier successful action.
      // It remains in the execution trace, not a claim that the cart failed.
      if (e.result.code === 'TOOL_CALL_REPEATED') continue
      // No code or argument supplied by the model becomes a customer claim.
      add(e, 'unavailable', e.result.code === 'COMMIT_STATE_UNCERTAIN'
        ? 'Não consegui verificar o resultado da operação. Não vou repetir a gravação sem conferência.'
        : 'Essa consulta ou ação não pôde ser concluída. Não tenho um resultado confirmado para informar.')
      continue
    }
    const data = obj(e.result.data)
    if (e.tool.startsWith('draft_') && data.state) {
      try {
        const state = loadOperationalState(JSON.stringify(data.state))
        const draft = state.focus ? state.operations[state.focus] : null
        if (draft?.kind === 'cart' && draft.status === 'active') add(e, 'draft', 'Seu carrinho foi atualizado. Ainda não é um pedido nem um pagamento.')
        else if (draft?.kind === 'booking' && draft.status === 'active') add(e, 'draft', 'O rascunho do agendamento foi atualizado. O horário ainda não foi reservado.')
        else if (draft?.kind === 'registration' && draft.status === 'active') add(e, 'draft', 'O rascunho do cadastro foi atualizado. O cadastro ainda precisa de confirmação.')
      } catch { /* Unknown states are not evidence of a successful draft. */ }
    } else if (e.tool === 'search_products') {
      const rows = Array.isArray(data.products) ? data.products : []
      if (!rows.length) add(e, 'empty', 'Nenhum produto foi encontrado nessa consulta.')
      rows.forEach((raw, i) => {
        const p = obj(raw), name = safeText(p.name), price = money(p.price_cents), stock = p.available_milliunits
        if (name && price && Number.isSafeInteger(stock) && Number(stock) >= 0) add(e, `product.${i}`, `${name}: ${price}; estoque disponível nesta consulta: ${Number(stock) / 1000}.`,typeof p.id==='string'?{id:p.id,kind:'product',label:name,observedAtMs:Date.now()}:undefined)
      })
    } else if (e.tool === 'search_services') {
      const rows = Array.isArray(data.services) ? data.services : []
      if (!rows.length) add(e, 'empty', 'Nenhum serviço foi encontrado nessa consulta.')
      rows.forEach((raw, i) => {
        const s = obj(raw), name = safeText(s.name), price = money(s.default_price_cents), duration = s.default_duration_min
        if (name && price && Number.isSafeInteger(duration) && Number(duration) > 0) add(e, `service.${i}`, `${name}: ${price}; duração cadastrada: ${duration} minutos.`,typeof s.id==='string'?{id:s.id,kind:'service',label:name,observedAtMs:Date.now()}:undefined)
      })
    } else if (e.tool === 'get_customer_context') {
      const rows = Array.isArray(data.pets) ? data.pets : []
      rows.forEach((raw, i) => { const p=obj(raw),name = safeText(p.name); if (name) add(e, `pet.${i}`, `Pet cadastrado: ${name}.`,typeof p.id==='string'?{id:p.id,kind:'pet',label:name,observedAtMs:Date.now()}:undefined) })
    } else if (e.tool === 'get_customer_appointments') {
      const rows = Array.isArray(data.appointments) ? data.appointments : []
      if (!rows.length) add(e, 'empty', 'Nenhum próximo agendamento ativo foi encontrado nessa consulta.')
      const statuses: Record<string,string> = {scheduled:'agendado',confirmed:'confirmado',in_progress:'em atendimento'}
      rows.forEach((raw,i)=>{
        const a=obj(raw),pet=safeText(a.pet_name),status=statuses[String(a.status)]
        const at=a.scheduled_at_ms,duration=a.duration_min
        if(!pet||!status||!Number.isSafeInteger(at)||!Number.isSafeInteger(duration)||Number(duration)<=0)return
        const date=new Date(Number(at));if(!Number.isFinite(date.getTime()))return
        add(e,`appointment.${i}`,`Agendamento de ${pet}: ${date.toISOString()} (UTC); duração cadastrada: ${duration} minutos; status: ${status}. Esse status não confirma pagamento.`)
      })
    } else if (e.tool === 'get_delivery_quote') {
      const fee = money(data.fee_cents), city = safeText(data.city), neighborhood = safeText(data.neighborhood)
      if (fee && city && neighborhood) add(e, 'delivery', `Entrega em ${neighborhood}, ${city}: taxa de ${fee}.`)
    } else if (e.tool === 'get_transport_quote') {
      const rows = Array.isArray(data.options) ? data.options : []
      if (!rows.length) add(e, 'empty', 'Nenhuma opção de transporte foi encontrada para essa consulta.')
      rows.forEach((raw, i) => { const r = obj(raw), label = safeText(r.label), fee = money(r.fee_cents); if (label && fee) add(e, `transport.${i}`, `${label}: ${fee}. A capacidade de transporte ainda precisa ser confirmada.`,typeof r.id==='string'?{id:r.id,kind:'transport',label,observedAtMs:Date.now()}:undefined) })
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
          add(e, `slot.${i}`, `Opção consultada: ${formatted} (${timezone}). Ainda não reservada; será revalidada na confirmação.`,{id:value,kind:'slot',label:formatted,observedAtMs:Date.now()})
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
        else if (kind === 'customer_registration' || kind === 'pet_registration') add(e, 'result', 'Cadastro registrado.')
      }
    }
  }
  return facts
}

export function responseContractInstruction(facts: readonly Fact[]): string {
  return `ESCOLHA OPERACIONAL: se precisar consultar dados ou alterar um rascunho, use chamadas NATIVAS das ferramentas fornecidas, com seus nomes e parâmetros exatos. Não simule chamadas em texto, JSON de resposta ou ferramenta inventada. O formato blocks NÃO é uma ferramenta; aplica-se somente ao conteúdo da resposta FINAL, depois das consultas necessárias. Execute ferramentas silenciosamente, como no ciclo de atendimento da Luna; não diga que vai consultar sem consultar.
RESPOSTA FINAL VERIFICADA: somente quando não houver outra ferramenta necessária, retorne o conteúdo JSON {"blocks":[{"kind":"social","text":"Claro, vamos por partes."},{"kind":"fact","id":"id"},{"kind":"question","field":"quantity"}]}. Componha livremente a linguagem social com as palavras de ligação permitidas: ${[...discourseVocabulary].join(', ')}. Varie blocos e ordem conforme a conversa; omita social/pergunta desnecessários e não repita fatos. Toda afirmação operacional deve ser um bloco fact, nunca texto social. Não crie valores, promessas, pagamento ou resultado. Pergunta opcional única: ${Object.keys(questions).filter(k=>k!=='none').join(', ')}. Fatos verificados: ${JSON.stringify(facts)}. Resumos comerciais serão anexados pelo servidor. O contrato antigo opening/facts/question é aceito somente por compatibilidade.`
}

export function validateFactualResponse(content: string | null, facts: readonly Fact[]): string | null {
  let value: unknown
  try { value = JSON.parse(content ?? '') } catch { return null }
  const r = obj(value)
  if (Object.keys(r).length === 1 && Array.isArray(r.blocks) && r.blocks.length > 0 && r.blocks.length <= 16) {
    const indexed = new Map(facts.map(f => [f.id, f.text]))
    const used = new Set<string>(), rendered: string[] = []
    let questionSeen = false, socialCount = 0
    for (const raw of r.blocks) {
      const block = obj(raw)
      if (Object.keys(block).length !== 2) return null
      if (block.kind === 'social' && Object.hasOwn(block, 'text')) {
        const text = verifiedDiscourse(block.text)
        if (!text || ++socialCount > 2) return null
        rendered.push(text)
      } else if (block.kind === 'fact' && typeof block.id === 'string' && indexed.has(block.id) && !used.has(block.id)) {
        used.add(block.id); rendered.push(indexed.get(block.id)!)
      } else if (block.kind === 'question' && typeof block.field === 'string' && block.field !== 'none' && Object.hasOwn(questions, block.field) && !questionSeen) {
        questionSeen = true; rendered.push(questions[block.field])
      } else return null
    }
    return rendered.join('\n') || null
  }
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

export function responseQuestion(reply:string):string|null {
  return Object.entries(questions).find(([key,text])=>key!=='none'&&text&&reply.includes(text))?.[0]??null
}
