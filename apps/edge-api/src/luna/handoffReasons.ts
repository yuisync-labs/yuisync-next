// Why Luna handed the chat to the store, in words the store owner understands.
// Internal codes and the model's own wording become one category plus, for
// free text, the model's short detail.
const CODES: [RegExp, string][] = [
  [/LUNA_PROMISED_HANDOFF/, 'A Luna não conseguiu concluir e passou a conversa para a loja: responda este cliente.'],
  [/AI_QUOTA|DAILY_AI_BUDGET|Limite diário de IA/i, 'Limite diário da IA atingido: responda este cliente manualmente.'],
  [/TURN_BUDGET|Limite (?:de consumo )?do turno|Orçamento de consumo|Capacidade fora/i, 'A Luna não conseguiu concluir a resposta: responda este cliente manualmente.'],
  [/ambígua|AMBIGUOUS/i, 'Cadastro duplicado: há mais de um cliente com este telefone. Confira o cadastro e responda.'],
  [/clínica|veterin/i, 'Saúde do pet: precisa de avaliação da veterinária.'],
  [/UNSUPPORTED_PRICE/, 'Preço não encontrado no cadastro: confira o serviço ou produto e responda.'],
  [/SLOT_(?:UNVERIFIED|NOT_RETURNED)/, 'Horário não confirmado na agenda: confira a agenda e responda.'],
  [/STOCK_(?:UNVERIFIED|ZERO)/, 'Estoque não confirmado: confira o produto e responda.'],
  [/DELIVERY_WINDOW/, 'Horário de entrega não confirmado: combine com o cliente.'],
  [/PAYMENT_NOT_INTEGRATED/, 'Pagamento: o cliente precisa de ajuda com o pagamento.'],
  [/Identidade, canal|alterados/i, 'A conversa mudou de canal ou já estava com a equipe.'],
  [/RECONCILIATION|EXECUTION_FAILED|CHECKPOINT|Resposta comercial sem evidência/i, 'Falha técnica da Luna: responda este cliente manualmente.'],
]
const TOPICS: [RegExp, string][] = [
  [/confirma/i, 'Agendamento ou pedido não concluído'],
  [/reclama|insatisf|problema com|atraso/i, 'Reclamação do cliente'],
  [/cancel/i, 'Cancelamento'],
  [/humano|atendente|pessoa|equipe|falar com/i, 'Cliente pediu atendente'],
]
const plain = (v: string) => v.normalize('NFD').replace(/[̀-ͯ]/g, '')

export function handoffReasonLabel(raw: string): string {
  const reason = String(raw ?? '').trim()
  const code = CODES.find(([pattern]) => pattern.test(reason) || pattern.test(plain(reason)))
  if (code) return code[1]
  // Raw identifiers never reach the store owner.
  if (!reason || /^[A-Z][A-Z0-9_]+$/.test(reason)) return 'A Luna não conseguiu concluir o atendimento: responda este cliente manualmente.'
  const topic = TOPICS.find(([pattern]) => pattern.test(plain(reason)))?.[1] ?? 'Fora do que a Luna resolve'
  if (topic === 'Cliente pediu atendente') return 'Cliente pediu atendente.'
  const detail = reason.replace(/\s+/g, ' ').slice(0, 200)
  return detail.toLowerCase().startsWith(topic.toLowerCase()) ? detail : `${topic}: ${detail}`
}
