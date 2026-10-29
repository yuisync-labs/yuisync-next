// Natural confirmation of ONE presented summary. Every word must either confirm,
// be filler, or restate a fact already in the persisted proposal. Any unknown
// word, change verb, hesitation or number that differs from the summary keeps
// the turn on the conversational path, where a new summary is required.
type JsonRecord = Record<string, unknown>
const record = (v: unknown): JsonRecord => v && typeof v === 'object' && !Array.isArray(v) ? v as JsonRecord : {}
const normalize = (v: string) => v.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
const singular = (w: string) => w.length > 3 && w.endsWith('s') ? w.slice(0, -1) : w
export const confirmationWords = (v: string) => normalize(v).replace(/r\$\s*/g, ' ').split(/[^a-z0-9]+/).filter(Boolean)

const AFFIRMATIVE = new Set(['confirmo', 'confirma', 'confirmado', 'confirmada', 'confirmar', 'fecha', 'fechou', 'fechado', 'fechar', 'fechamos', 'conclui', 'concluir', 'finaliza', 'finalizar', 'sim', 'ok', 'beleza', 'certo', 'isso', 'agendar', 'marcar',
  // Short WhatsApp yeses, and "sou eu" to "você é a Ana?".
  's', 'ss', 'sss', 'aham', 'uhum', 'positivo', 'correto', 'exato', 'yes', 'sou'])
const FILLER = new Set(['o', 'a', 'os', 'as', 'do', 'da', 'dos', 'das', 'de', 'esse', 'este', 'essa', 'esta', 'novo', 'nova', 'resumo', 'agora', 'entao', 'por', 'favor', 'pode', 'ser', 'pra', 'para', 'eu', 'mesmo', 'e', 'com', 'ai', 'la', 'unidade', 'item', 'iten', 'pacote', 'valor', 'total', 'reai', 'real', 'mesma', 'nesse', 'neste', 'nessa', 'nesta', 'no', 'na', 'dia', 'data',
  // Courtesy around a yes ("sim obrigada", "perfeito, pode marcar").
  'obrigado', 'obrigada', 'brigado', 'brigada', 'valeu', 'grato', 'grata', 'perfeito', 'perfeita', 'otimo', 'otima', 'show', 'claro', 'combinado', 'top', 'blz', 'tudo', 'bom', 'boa', 'legal', 'maravilha', 'muito', 'certinho', 'ta', 'tranquilo',
  // "sim, pode seguir", "bora", "pode fazer".
  'segue', 'seguir', 'prossegue', 'prosseguir', 'faz', 'fazer', 'vai', 'bora', 'meu', 'meus', 'minha', 'minhas'])
// Words that change, qualify, defer or reference something outside the summary.
const BLOCKERS = new Set(['nao', 'ainda', 'espera', 'pera', 'perai', 'mas', 'porem', 'depois', 'so', 'troca', 'trocar', 'muda', 'mudar', 'altera', 'alterar', 'tira', 'tirar', 'coloca', 'colocar', 'adiciona', 'aumenta', 'diminui', 'mais', 'menos', 'outro', 'outra', 'corrige', 'corrigindo', 'se', 'quando', 'talvez', 'acho', 'cancela', 'cancelar', 'cancelamento', 'pago', 'paguei', 'pagar', 'pix', 'cartao', 'dinheiro', 'amanha', 'hoje', 'hora', 'as'])
const NUMBERS: Record<string, number> = { um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10, vinte: 20, trinta: 30, quarenta: 40, cinquenta: 50, sessenta: 60, setenta: 70, oitenta: 80, noventa: 90, cem: 100 }
// "pode cadastrar" is a yes to a registration summary, like "pode agendar" to a booking.
const REGISTER = ['cadastrar', 'cadastra', 'cadastre', 'registrar', 'registra', 'salvar', 'salva', 'salve']
const SUBJECTS: Record<string, string[]> = {
  product_order_create: ['pedido', 'compra', 'carrinho'],
  appointment_create: ['horario', 'agendamento', 'banho', 'tosa', 'servico', 'agendar', 'marcar'],
  // "sim, confirmo o cancelamento", "pode cancelar": the operation's own verb is no change request.
  appointment_cancel: ['cancelamento', 'cancelar', 'cancela', 'desmarcar', 'desmarca', 'agendamento', 'horario', 'banho', 'tosa'],
  appointment_reschedule: ['mudanca', 'reagendamento', 'remarcacao', 'remarcar', 'horario', 'agendamento', 'banho', 'tosa'],
  customer_registration: ['cadastro', 'dado', ...REGISTER],
  pet_registration: ['cadastro', 'dado', 'pet', ...REGISTER],
}
const FULFILLMENT: Record<string, string[]> = { counter: ['retirada', 'retirar', 'buscar', 'busco', 'pego', 'pegar', 'loja'], delivery: ['entrega', 'entregar'] }

// Confirmation that names what it confirms. Only these may survive an
// intervening exchange in which the customer hesitated without changing anything.
export function namesSummary(words: string[], operationKind: string) {
  return words.some(w => w === 'resumo' || (SUBJECTS[operationKind] ?? []).includes(singular(w)))
}
// Intervening customer messages may hesitate ("ainda estou decidindo") but
// never ask for a change; otherwise the presented summary no longer applies.
export function requestsChange(text: string) {
  return confirmationWords(text).some(w => ['troca', 'trocar', 'muda', 'mudar', 'altera', 'alterar', 'tira', 'tirar', 'coloca', 'colocar', 'adiciona', 'aumenta', 'diminui', 'mais', 'menos', 'outro', 'outra', 'corrige', 'corrigindo', 'cancela', 'cancelar'].includes(w) || /^\d+$/.test(w) || w in NUMBERS && w !== 'um' && w !== 'uma')
}

export function naturalConfirmation(value: string, operationKind: string, payload: JsonRecord): boolean {
  if (!SUBJECTS[operationKind]) return false
  const words = confirmationWords(value)
  const yes = (w: string) => AFFIRMATIVE.has(w) || /registration$/.test(operationKind) && REGISTER.includes(w)
  if (!words.length || words.length > 24 || !words.some(yes)) return false
  const facts = new Set<string>(SUBJECTS[operationKind])
  const lines = operationKind === 'product_order_create' ? (Array.isArray(payload.items) ? payload.items : []) : (Array.isArray(payload.services) ? payload.services : [])
  for (const line of lines) for (const w of confirmationWords(String(record(line).name ?? ''))) facts.add(singular(w))
  if (typeof payload.pet_name === 'string') for (const w of confirmationWords(payload.pet_name)) facts.add(w)
  const fulfillment = String(payload.fulfillment_type ?? '')
  for (const w of FULFILLMENT[fulfillment] ?? []) facts.add(w)
  const quantities = new Set(lines.map(line => Number(record(line).quantity ?? 1)))
  quantities.add(lines.reduce((sum, line) => sum + Number(record(line).quantity ?? 1), 0))
  const totalCents = Number(payload.total_cents)
  for (const w of words) {
    if (AFFIRMATIVE.has(w)) continue
    const number = /^\d+$/.test(w) ? Number(w) : NUMBERS[w]
    if (number !== undefined) {
      // "uma Ração A" restates quantity 1; "90 reais" restates the summary total.
      if (quantities.has(number) || (Number.isFinite(totalCents) && number * 100 === totalCents)) continue
      return false
    }
    if (BLOCKERS.has(w)) return false
    if (FILLER.has(singular(w)) || facts.has(singular(w)) || facts.has(w)) continue
    return false
  }
  // Fulfillment words of the other modality are unknown, so they already failed above.
  return true
}

// "Pode fechar pelo valor que você me passou" or "fechou, pago os 90": a closing
// verb plus words that only point back at the summary. Payment words are allowed
// because Luna never processes payment. Every other word, including the other
// modality ("para entrega" on a pickup order), keeps the turn with the model.
const CLOSING = new Set(['confirmo', 'confirma', 'fecha', 'fechar', 'fechou', 'fechado', 'fechamos', 'conclui', 'concluir', 'finaliza', 'finalizar'])
const PAYMENT = new Set(['pago', 'paguei', 'pagar', 'pix', 'cartao', 'dinheiro', 'debito', 'credito'])
const BACKREFERENCE = new Set(['pelo', 'pela', 'que', 'voce', 'me', 'passou', 'antes', 'apareceu', 'mostrou', 'combinado', 'combinamos', 'tudo', 'bem', 'vou', 'em', 'aquele', 'aquela', 'mesmo', 'certo', 'sim', 'ok', 'beleza', 'isso'])
export function closingConfirmation(value: string, operationKind: string, payload: JsonRecord): boolean {
  if (!SUBJECTS[operationKind] || value.includes('?') || / antes de /.test(' ' + normalize(value) + ' ')) return false
  const words = confirmationWords(value)
  if (!words.length || words.length > 20 || !words.some(w => CLOSING.has(w))) return false
  const facts = new Set<string>(SUBJECTS[operationKind])
  const lines = operationKind === 'product_order_create' ? (Array.isArray(payload.items) ? payload.items : []) : (Array.isArray(payload.services) ? payload.services : [])
  for (const line of lines) for (const w of confirmationWords(String(record(line).name ?? ''))) facts.add(singular(w))
  if (typeof payload.pet_name === 'string') for (const w of confirmationWords(payload.pet_name)) facts.add(w)
  for (const w of FULFILLMENT[String(payload.fulfillment_type ?? '')] ?? []) facts.add(w)
  const quantities = new Set(lines.map(line => Number(record(line).quantity ?? 1)))
  quantities.add(lines.reduce((sum, line) => sum + Number(record(line).quantity ?? 1), 0))
  const totalCents = Number(payload.total_cents)
  return words.every(w => {
    const number = /^\d+$/.test(w) ? Number(w) : NUMBERS[w]
    if (number !== undefined) return quantities.has(number) || number * 100 === totalCents
    return CLOSING.has(w) || PAYMENT.has(w) || BACKREFERENCE.has(w) || FILLER.has(singular(w)) || facts.has(singular(w)) || facts.has(w)
  })
}

type Summary = { operation_kind: string; payload: JsonRecord }
function summaryNames(s: Summary) {
  const names = new Set<string>(SUBJECTS[s.operation_kind] ?? [])
  const lines = s.operation_kind === 'product_order_create' ? (Array.isArray(s.payload.items) ? s.payload.items : []) : (Array.isArray(s.payload.services) ? s.payload.services : [])
  for (const line of lines) for (const w of confirmationWords(String(record(line).name ?? ''))) if (w.length >= 3) names.add(singular(w))
  if (s.operation_kind === 'appointment_create' && typeof s.payload.pet_name === 'string') for (const w of confirmationWords(s.payload.pet_name)) if (w.length >= 3) names.add(w)
  return names
}
const DEFERRAL = new Set(['nao', 'ainda', 'depois', 'espera', 'pera', 'perai', 'segura', 'aguarda'])
// Several summaries pending: "Confirma só o banho; a compra ainda não." selects
// one only when its clause confirms it alone and every clause naming another
// summary defers it. Anything else stays with the model, which must ask.
export function scopedConfirmation(value: string, target: Summary, others: Summary[]): boolean {
  if (!SUBJECTS[target.operation_kind] || value.includes('?')) return false
  const mine = summaryNames(target), theirs = others.map(summaryNames)
  const clauses = normalize(value).split(/[;.,!]| mas | porem /).map(confirmationWords).filter(c => c.length)
  let selected = false
  for (const words of clauses) {
    const namesMine = words.some(w => mine.has(singular(w)) || mine.has(w))
    const namesOther = theirs.some(n => words.some(w => (n.has(singular(w)) || n.has(w)) && !mine.has(singular(w)) && !mine.has(w)))
    const deferred = words.some(w => DEFERRAL.has(w))
    if (namesOther) { if (!deferred || namesMine) return false; continue }
    if (!namesMine) continue
    if (deferred || !words.some(w => AFFIRMATIVE.has(w) || CLOSING.has(w)) || requestsChange(words.join(' '))) return false
    selected = true
  }
  return selected
}

// A yes in the customer's own words: "confirmo sim, pode deixar marcado",
// "sim, confirmo o banho da Mel amanhã às 9h", "pode confirmar, pago no cartão
// na entrega". Unknown words are allowed; what decides is that the message says
// yes, asks for no change, and every fact it restates (numbers, day, hour,
// modality, MotoDog) matches the persisted summary. Questions in the same
// message ("quanto custa a unha?") neither confirm nor block.
const STRONG_YES = new Set([...AFFIRMATIVE, ...CLOSING, 'confirmamos', 'confirmando', 'marcado', 'marcada', 'agendado', 'agendada', 'reservar', 'reservado'].filter(w => w !== 'isso' && w !== 'sou'))
const HOLD = new Set(['nao', 'mas', 'porem', 'ainda', 'espera', 'pera', 'perai', 'aguarda', 'segura', 'depois', 'talvez', 'acho', 'se', 'antes', 'pensar', 'pensando', 'decidir', 'decidindo', 'ver', 'vendo', 'conferir', 'conferindo', 'pessoa', 'atendente', 'humano', 'humana', 'gerente', 'so', 'somente', 'apenas', 'tambem', 'junto'])
// "pode" says yes only with a verb that carries on ("pode deixar marcado", not "pode me passar o preço").
const GO_ON = new Set(['agendar', 'marcar', 'confirmar', 'fechar', 'deixar', 'seguir', 'prosseguir', 'reservar', 'fazer', 'ser', 'cadastrar', 'salvar', 'mandar', 'finalizar', 'concluir', 'enviar', 'separar', 'registrar'])
const CHANGE = new Set(['troca', 'trocar', 'muda', 'mudar', 'altera', 'alterar', 'tira', 'tirar', 'coloca', 'colocar', 'adiciona', 'aumenta', 'diminui', 'mais', 'menos', 'outro', 'outra', 'corrige', 'corrigindo', 'cancela', 'cancelar', 'desisto', 'desistir'])
const WEEKDAYS = ['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado']
const QUESTION = /\b(quanto|qual|quais|como|onde|quando|tem|teria|aceita|aceitam|voces|vcs|vc)\b/
export function consistentConfirmation(value: string, operationKind: string, payload: JsonRecord, nowMs: number, timeZone = 'America/Sao_Paulo'): boolean {
  if (!SUBJECTS[operationKind]) return false
  // Questions about something else are set aside; a question that holds the yes is not a yes.
  // "confirmo, pode registrar, blz?": a tag question asks for agreement, not information.
  const untagged = value.replace(/[,\s]+(?:blz|beleza|ok|ta|t[aá] bom|certo|pode ser|n[eé]|combinado)\s*\?+\s*$/i, '.')
  // Facts of the summary as the customer may repeat them: "R$ 46,90", "Rua Muriaé, 200".
  const cents = new Set<number>(), textNumbers = new Set<number>()
  const walk = (v: unknown, key = ''): void => {
    if (Array.isArray(v)) { v.forEach(x => walk(x, key)); return }
    if (v && typeof v === 'object') { for (const [k, x] of Object.entries(v)) walk(x, k); return }
    if (typeof v === 'number' && key.endsWith('_cents')) cents.add(v)
    if (typeof v === 'string' && !/(^|_)id$|^name$/.test(key)) for (const n of v.match(/\d+/g) ?? []) textNumbers.add(Number(n))
  }
  walk(payload)
  let wrongAmount = false
  const amounts = untagged.replace(/(?:r\$\s*)?\b(\d{1,5})[.,](\d{2})\b/gi, (_all, reais, centavos) => { if (!cents.has(Number(reais) * 100 + Number(centavos))) wrongAmount = true; return ' ' })
  if (wrongAmount) return false
  const clauses = amounts.split(/(?<=[.!?;\n])/).map(c => c.trim()).filter(Boolean)
  const kept: string[] = []
  for (const clause of clauses) {
    if (!clause.endsWith('?')) { kept.push(clause); continue }
    const words = confirmationWords(clause)
    if (!QUESTION.test(words.join(' ')) || words.some(w => STRONG_YES.has(w) || HOLD.has(w) || CHANGE.has(w))) return false
  }
  // Hesitation before the yes ("hmm, deixa eu ver... sim") is resolved by it;
  // hesitation in or after the clause that says yes holds it.
  const says = (c: string[]) => c.some((w, i) => STRONG_YES.has(w) || w === 'pode' && (GO_ON.has(c[i + 1] ?? '') || operationKind === 'appointment_cancel' && /^(cancelar|desmarcar)$/.test(c[i + 1] ?? '')))
  const split = kept.map(confirmationWords).filter(c => c.length), last = split.map(says).lastIndexOf(true)
  const words = split.flat()
  // Luna never takes payment: "pago no cartão, se não der me avisa" is no reservation about the summary.
  const aboutPayment = (c: string[]) => c.some(w => PAYMENT.has(w) || w === 'pagamento')
  const own = new Set(SUBJECTS[operationKind])
  if (last < 0 || words.length > 60 || split.some(c => !aboutPayment(c) && c.some(w => CHANGE.has(w) && !own.has(w))) || split.slice(last).some(c => !aboutPayment(c) && c.some(w => HOLD.has(w)))) return false
  // A registration summary has no day or price: "confirmo, pode marcar o banho amanhã 14h" talks about the next step.
  if (operationKind.endsWith('registration')) return true
  // A stray letter is usually a product variant ("a Ração B").
  if (words.some(w => /^[a-z]$/.test(w) && !/^[aeos]$/.test(w))) return false
  const lines = operationKind === 'product_order_create' ? (Array.isArray(payload.items) ? payload.items : []) : (Array.isArray(payload.services) ? payload.services : [])
  const known = new Set<number>(lines.map(line => Number(record(line).quantity ?? 1)))
  known.add(lines.reduce((sum, line) => sum + Number(record(line).quantity ?? 1), 0))
  const total = Number(payload.total_cents), fee = Number(record(payload.transport).fee_cents)
  for (const cents of [total, fee, ...lines.map(l => Number(record(l).unit_price_cents ?? record(l).price_cents))]) if (Number.isFinite(cents) && cents > 0 && cents % 100 === 0) known.add(cents / 100)
  // "3 kg" restates a size from the item name, not a quantity.
  for (const n of textNumbers) known.add(n)
  const sizes = new Set(lines.flatMap(line => (String(record(line).name ?? '').match(/\d+/g) ?? []).map(Number)))
  const at = Number(payload.scheduled_at_ms)
  let day: { y: number; m: number; d: number; hour: number; minute: number; weekday: number } | null = null
  const parts = (ms: number) => { const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', hourCycle: 'h23', weekday: 'short' }).formatToParts(new Date(ms)).map(x => [x.type, x.value])); return { y: +p.year, m: +p.month, d: +p.day, hour: +p.hour, minute: +p.minute, weekday: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday) } }
  if (Number.isFinite(at) && at > 0) { day = parts(at); known.add(day.d); known.add(day.m); known.add(day.y); known.add(day.hour); if (day.minute) known.add(day.minute); if (day.hour > 12) known.add(day.hour - 12) }
  if (day && day.minute === 0) known.add(0)
  for (const [i, w] of words.entries()) {
    const number = /^\d+$/.test(w) ? Number(w) : NUMBERS[w]
    if (number !== undefined && /^(kg|kgs|g|gr|ml|l|quilos?|kilos?)$/.test(words[i + 1] ?? '')) { if (!sizes.has(number)) return false; continue }
    if (number !== undefined) { if (!known.has(number) && !(w in NUMBERS && (w === 'um' || w === 'uma'))) return false; continue }
    const hm = /^(\d{1,2})h(\d{2})?$/.exec(w)
    if (hm) { if (!day || +hm[1] !== day.hour || Number(hm[2] ?? 0) !== day.minute) return false; continue }
    const size = /^(\d+)(kg|g|gr|ml|l)$/.exec(w)
    if (size) { if (!sizes.has(Number(size[1]))) return false; continue }
    if (/^\d/.test(w)) return false
  }
  // Day words must point at the scheduled day; an order has no day to restate.
  const dayWord = words.find(w => w === 'hoje' || w === 'amanha' || WEEKDAYS.includes(w))
  if (dayWord) {
    if (!day) return false
    const today = parts(nowMs), dayIndex = Date.UTC(day.y, day.m - 1, day.d) / 864e5, todayIndex = Date.UTC(today.y, today.m - 1, today.d) / 864e5
    for (const w of words) {
      if (w === 'hoje' && dayIndex !== todayIndex) return false
      if (w === 'amanha' && dayIndex !== todayIndex + 1) return false
      if (WEEKDAYS.includes(w) && WEEKDAYS.indexOf(w) !== day.weekday) return false
    }
  }
  const text = ' ' + words.join(' ') + ' '
  if (operationKind === 'product_order_create') {
    const f = String(payload.fulfillment_type ?? '')
    if (f === 'counter' && /\b(entrega|entregar|entregue|delivery|endereco)\b/.test(text)) return false
    if (f === 'delivery' && /\b(retirada|retirar|retiro|busco|buscar|pego|pegar)\b/.test(text)) return false
  }
  if (operationKind === 'appointment_create') {
    const moto = Boolean(payload.transport)
    if (!moto && /\b(motodog|moto|busca|buscar|buscam|busquem|leva e traz|levar e buscar)\b/.test(text) && !/\b(eu|mesma|mesmo) (levo|busco|vou levar|vou buscar)\b/.test(text)) return false
    if (moto && /\b(eu levo|eu mesma levo|eu mesmo levo|vou levar|levo ela|levo ele)\b/.test(text)) return false
  }
  return true
}
