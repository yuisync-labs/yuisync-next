// Natural confirmation of ONE presented summary. Every word must either confirm,
// be filler, or restate a fact already in the persisted proposal. Any unknown
// word, change verb, hesitation or number that differs from the summary keeps
// the turn on the conversational path, where a new summary is required.
type JsonRecord = Record<string, unknown>
const record = (v: unknown): JsonRecord => v && typeof v === 'object' && !Array.isArray(v) ? v as JsonRecord : {}
const normalize = (v: string) => v.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
const singular = (w: string) => w.length > 3 && w.endsWith('s') ? w.slice(0, -1) : w
export const confirmationWords = (v: string) => normalize(v).replace(/r\$\s*/g, ' ').split(/[^a-z0-9]+/).filter(Boolean)

const AFFIRMATIVE = new Set(['confirmo', 'confirma', 'confirmado', 'confirmada', 'confirmar', 'fecha', 'fechou', 'fechado', 'fechar', 'fechamos', 'conclui', 'concluir', 'finaliza', 'finalizar', 'sim', 'ok', 'beleza', 'certo', 'isso', 'agendar', 'marcar'])
const FILLER = new Set(['o', 'a', 'os', 'as', 'do', 'da', 'dos', 'das', 'de', 'esse', 'este', 'essa', 'esta', 'novo', 'nova', 'resumo', 'agora', 'entao', 'por', 'favor', 'pode', 'ser', 'pra', 'para', 'eu', 'mesmo', 'e', 'com', 'ai', 'la', 'unidade', 'item', 'iten', 'pacote', 'valor', 'total', 'reai', 'real', 'mesma'])
// Words that change, qualify, defer or reference something outside the summary.
const BLOCKERS = new Set(['nao', 'ainda', 'espera', 'pera', 'perai', 'mas', 'porem', 'depois', 'so', 'troca', 'trocar', 'muda', 'mudar', 'altera', 'alterar', 'tira', 'tirar', 'coloca', 'colocar', 'adiciona', 'aumenta', 'diminui', 'mais', 'menos', 'outro', 'outra', 'corrige', 'corrigindo', 'se', 'quando', 'talvez', 'acho', 'cancela', 'cancelar', 'cancelamento', 'pago', 'paguei', 'pagar', 'pix', 'cartao', 'dinheiro', 'amanha', 'hoje', 'hora', 'as'])
const NUMBERS: Record<string, number> = { um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10, vinte: 20, trinta: 30, quarenta: 40, cinquenta: 50, sessenta: 60, setenta: 70, oitenta: 80, noventa: 90, cem: 100 }
const SUBJECTS: Record<string, string[]> = {
  product_order_create: ['pedido', 'compra', 'carrinho'],
  appointment_create: ['horario', 'agendamento', 'banho', 'tosa', 'servico'],
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
  if (!words.length || words.length > 24 || !words.some(w => AFFIRMATIVE.has(w))) return false
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
