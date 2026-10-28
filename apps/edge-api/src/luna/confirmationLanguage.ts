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
  appointment_create: ['horario', 'agendamento', 'banho', 'tosa', 'servico'],
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
