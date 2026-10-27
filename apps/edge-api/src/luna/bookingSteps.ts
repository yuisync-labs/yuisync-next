// The server decides which booking step comes next; the model only extracts
// what the customer said and asks for what this step names.
export type BookingStep = 'service' | 'pet' | 'weight' | 'date' | 'slot' | 'transport' | 'address' | 'transport_option' | 'summary'
type Draft = { items: readonly { id: string }[]; fields: Readonly<Record<string, string | undefined>> }

const asks: Record<BookingStep, string> = {
  service: 'Descubra qual serviço o cliente quer e coloque-o no rascunho (add_item com o ID de search_services).',
  pet: 'Pergunte para qual pet é, se ainda não estiver claro, e salve pet_id.',
  weight: 'O preço depende do peso e o pet não tem peso cadastrado: pergunte o peso aproximado (nunca estime pela raça) e salve weight_kg com o número que o cliente disser.',
  date: 'Pergunte o dia (e o período, se ele quiser). Não consulte vagas antes de ele dizer o dia.',
  slot: 'Consulte get_available_slots para o dia dito, ofereça os horários e salve scheduled_at do horário escolhido.',
  transport: 'Pergunte se ele vai trazer o pet ou se quer o MotoDog (buscar, levar ou os dois). Trazer = transport_mode self.',
  address: 'Peça rua, número, bairro e ponto de referência para o MotoDog e salve address.',
  transport_option: 'Consulte get_transport_quote e salve transport_option_id da opção que bate com o pedido (buscar, levar ou os dois).',
  summary: 'Tudo coletado: chame update_draft com prepare:true para mostrar o resumo.',
}
const labels: Partial<Record<BookingStep, string>> = { service: 'serviço', pet: 'pet', weight: 'peso', date: 'dia', slot: 'horário', transport: 'transporte', address: 'endereço', transport_option: 'opção de MotoDog' }

export function nextBookingStep(draft: Draft, options: { transportOffered: boolean; weightNeeded?: boolean }): { step: BookingStep; done: string[]; instruction: string } {
  const f = draft.fields
  const moto = Boolean(f.transport_mode && !/^(self|none)$/.test(f.transport_mode))
  let address: Record<string, unknown> = {}
  try { address = f.address ? JSON.parse(f.address) as Record<string, unknown> : {} } catch {}
  const order: [BookingStep, boolean][] = [
    ['service', draft.items.length > 0],
    ['pet', Boolean(f.pet_id)],
    ['weight', !options.weightNeeded || Boolean(f.weight_kg)],
    ['date', Boolean(f.scheduled_at || f.period)],
    ['slot', Boolean(f.scheduled_at)],
    ['transport', !options.transportOffered || Boolean(f.transport_mode)],
    ['address', !moto || Boolean(address.street && address.city)],
    ['transport_option', !moto || Boolean(f.transport_option_id)],
  ]
  const step = order.find(([, ok]) => !ok)?.[0] ?? 'summary'
  const done = order.filter(([name, ok]) => ok && labels[name] && !(name === 'date' && f.scheduled_at) && !(name === 'weight' && !f.weight_kg) && !(name === 'transport' && !f.transport_mode) && !(/^(address|transport_option)$/.test(name) && !moto)).map(([name]) => labels[name]!)
  return { step, done, instruction: asks[step] }
}

// A weight counts only when the customer wrote that number.
export const weightSaid = (value: string, said: string) => new RegExp(`(^|[^0-9.])${String(Number(value.replace(',', '.'))).replace('.', '[.,]')}([^0-9]|$)`).test(said)

const plain = (text: string) => text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()
// Slots are looked up only after the customer named a day.
export const dateSaid = (said: string) => /\b(hoje|amanha|segunda|terca|quarta|quinta|sexta|sabado|domingo|semana que vem|proxima semana|fim de semana|dia \d{1,2})\b|\b\d{1,2}\/\d{1,2}\b/.test(plain(said))
// "Eu levo" is the customer's own transport; the model may not assume it.
export const selfTransportSaid = (said: string) => /\b(levo|trago|eu busco|busco eu|vou levar|vou trazer|nao precis\w*|sem (?:motodog|transporte))\b/.test(plain(said))
