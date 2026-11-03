// Guards that keep a conversation inside the store's service: the AI notice on
// the first reply, offensive messages and message floods. Decided by the server.

const plain = (text: string) => text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()

// "PetShop QuatroPatas" is introduced as "da QuatroPatas".
export function storeShortName(name: unknown) {
  const text = typeof name === 'string' ? name.trim() : ''
  return text.replace(/^pet\s*shop\s+/i, '').trim() || text
}

// The first reply of a conversation says it is a virtual assistant. A greeting
// the reply already opens with keeps its place; the notice follows it.
export function withAssistantNotice(reply: string, storeName: unknown) {
  const store = storeShortName(storeName)
  const intro = `Sou a Luna, a nova assistente virtual${store ? ' da ' + store : ''}.`
  const text = reply.trim()
  if (/\bsou a luna\b/i.test(text)) return text
  const greeting = /^(?:ol[aá]|oi|oie|bom dia|boa tarde|boa noite)(?=[\s,!.])[^.!?\n]{0,40}[!.]\s*/i.exec(text)
  if (greeting) return (greeting[0].trim() + ' ' + intro + ' ' + text.slice(greeting[0].length)).trim()
  return ('Oi! ' + intro + ' ' + text).trim()
}

// Insults and slurs aimed at someone. A casual "nossa" or "caramba" is not one.
const OFFENSE = /\b(?:porra|caralho|krl|crl|puta|put[ao]s?|fdp|filh[oa] da puta|vai (?:se|te|tomar) (?:fo|fu)der|vai tomar no|foda-?se|fodase|vagabund[oa]s?|idiota|imbecil|otari[oa]|arrombad[oa]|desgracad[oa]|babac[ao]|retardad[oa]|merda|bost[ao]|cuzao|piranha|viad[oa]|lixo de (?:loja|atendimento|robo|ia)|sua inutil|seu inutil|robo burr[oa]|ia burr[oa]|burr[oa] demais)\b/

export function offensive(text: string) {
  return OFFENSE.test(plain(text))
}

export const MESSAGES_PER_HOUR = 30

export type GuardDecision = { block?: 'rate' | 'offense'; warnOffense?: boolean }

// inbound: this conversation's customer messages of the last day, newest included.
export function conversationGuard(inbound: readonly { text: string; at: number }[], now: number, limit = MESSAGES_PER_HOUR): GuardDecision {
  if (inbound.filter(m => m.at > now - 3600000).length > limit) return { block: 'rate' }
  const offenses = inbound.filter(m => offensive(m.text)).length
  if (offenses >= 2) return { block: 'offense' }
  return offenses === 1 ? { warnOffense: true } : {}
}

export const GUARD_HANDOFF_REASON = {
  rate: 'Muitas mensagens em pouco tempo: confira a conversa.',
  offense: 'Cliente com mensagens ofensivas: atendimento humano.',
} as const

export const GUARD_REPLY = {
  rate: 'Recebi muitas mensagens em pouco tempo. Vou passar seu atendimento para alguém da loja continuar com você.',
  offense: 'Vou passar seu atendimento para alguém da loja continuar com você.',
} as const
