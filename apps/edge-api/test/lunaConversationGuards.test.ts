import { describe, expect, it } from 'vitest'
import { conversationGuard, offensive, storeShortName, withAssistantNotice } from '../src/luna/conversationGuards'
import { handoffReasonLabel } from '../src/luna/handoffReasons'

describe('first reply says Luna is a virtual assistant', () => {
  it('keeps the greeting and adds the notice after it', () => {
    expect(withAssistantNotice('Olá, boa noite! É para a Pipoca ou o Max?', 'PetShop QuatroPatas')).toBe('Olá, boa noite! Sou a Luna, a nova assistente virtual da QuatroPatas. É para a Pipoca ou o Max?')
    expect(withAssistantNotice('Qual dia e horário você prefere?', 'PetShop QuatroPatas')).toBe('Oi! Sou a Luna, a nova assistente virtual da QuatroPatas. Qual dia e horário você prefere?')
    expect(withAssistantNotice('Oi! Sou a Luna. Como posso ajudar?', 'Loja X')).toBe('Oi! Sou a Luna. Como posso ajudar?')
    expect(withAssistantNotice('Bom dia. Temos banho a partir de R$ 50.', null)).toBe('Bom dia. Sou a Luna, a nova assistente virtual. Temos banho a partir de R$ 50.')
    expect(storeShortName('Pet Shop Amigo Fiel')).toBe('Amigo Fiel')
  })
})

describe('offensive messages and floods', () => {
  it('recognizes insults, not ordinary words', () => {
    for (const text of ['vai se fuder', 'sua inútil', 'que merda de atendimento', 'IA burra', 'seu idiota']) expect(offensive(text), text).toBe(true)
    for (const text of ['computador', 'disputa', 'caramba, que caro', 'quero um banho', 'meu cachorro é bobinho']) expect(offensive(text), text).toBe(false)
  })
  it('warns at the first offense, hands off at the second or over 30 messages an hour', () => {
    const now = 10_000_000
    const msg = (text: string, minutesAgo = 1) => ({ text, at: now - minutesAgo * 60000 })
    expect(conversationGuard([msg('quero um banho')], now)).toEqual({})
    expect(conversationGuard([msg('seu idiota'), msg('quero um banho')], now)).toEqual({ warnOffense: true })
    expect(conversationGuard([msg('seu idiota'), msg('IA burra', 5)], now)).toEqual({ block: 'offense' })
    expect(conversationGuard(Array.from({ length: 31 }, (_, i) => msg('oi ' + i)), now)).toEqual({ block: 'rate' })
    expect(conversationGuard(Array.from({ length: 31 }, (_, i) => msg('oi ' + i, 61 + i)), now)).toEqual({})
  })
  it('names the reason for the store owner', () => {
    expect(handoffReasonLabel('Muitas mensagens em pouco tempo: confira a conversa.')).toBe('Muitas mensagens em pouco tempo: confira a conversa e responda.')
    expect(handoffReasonLabel('Cliente com mensagens ofensivas: atendimento humano.')).toBe('Cliente com mensagens ofensivas: atendimento humano.')
  })
})
