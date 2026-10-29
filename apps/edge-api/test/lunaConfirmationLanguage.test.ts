import { describe, expect, it } from 'vitest'
import { explicitConfirmation } from '../src/luna/commitProposal'

describe('Luna authorization language (still requires persisted presentation)', () => {
  it.each([
    ['Confirmo o resumo do banho.', 'appointment_create'],
    ['Confirmo o horário.', 'appointment_create'],
    ['Confirmo a mudança.', 'appointment_reschedule'],
    ['Confirmo o cancelamento.', 'appointment_cancel'],
    ['Confirmo o cadastro.', 'customer_registration'],
    ['Sim.', 'product_order_create'],
  ])('reconhece confirmação inequívoca da operação apresentada: %s', (phrase, kind) => {
    expect(explicitConfirmation(phrase, kind)).toBe(true)
  })
  it.each([
    ['Sim, mas tira uma antes.', 'product_order_create'],
    ['Ainda não confirma a compra.', 'product_order_create'],
    ['Confirmo o cancelamento.', 'appointment_create'],
    ['Confirmo a mudança.', 'product_order_create'],
    ['Confirmo o horário amanhã às dez.', 'appointment_create'],
  ])('não transforma correção, negação ou outra operação em autorização: %s', (phrase, kind) => {
    expect(explicitConfirmation(phrase, kind)).toBe(false)
  })
})

import { closingConfirmation, scopedConfirmation, naturalConfirmation } from '../src/luna/confirmationLanguage'
import { nameTerms } from '../src/luna/thinkCatalog/catalog'
const order = { items: [{ name: 'Ração A', quantity: 1 }], total_cents: 9000, fulfillment_type: 'counter' }
const bath = { services: [{ name: 'Banho' }], pet_name: 'Mel' }
describe('Luna closing and scoped confirmation', () => {
  it.each(['Pode fechar pelo valor que você me passou antes.', 'Fechou, pago os 90 que apareceu ai.', 'Confirmo no pix.'])('fecha o único resumo: %s', phrase => expect(closingConfirmation(phrase, 'product_order_create', order)).toBe(true))
  it.each(['Minha irmã escreveu "confirmo", mas eu ainda estou decidindo.', 'Se eu disser "pode fechar" depois, aí sim. Agora não.', 'Antes de fechar quero falar com uma pessoa.', 'Nao fecha nada, passa pro atendente pfv.', 'Fecha com 3?', 'Fecha com 2 unidades.', 'Confirmo esse pedido para entrega.', 'Pode fechar, vou pensar.'])('não fecha: %s', phrase => expect(closingConfirmation(phrase, 'product_order_create', order)).toBe(false))
  it('aceita dia e horário do resumo como restatement', () => expect(naturalConfirmation('Confirmo o banho da Mel nesse dia e horário do resumo.', 'appointment_create', bath)).toBe(true))
  const bathSummary = { operation_kind: 'appointment_create', payload: bath }, orderSummary = { operation_kind: 'product_order_create', payload: order }
  it.each(['Confirma só o banho; a compra ainda não.', 'O pedido fica pra depois. Pode concluir apenas o agendamento da Mel.', 'Fecha o horario da Mel, mas nao fecha a racao ainda.'])('seleciona só o banho: %s', phrase => {
    expect(scopedConfirmation(phrase, bathSummary, [orderSummary])).toBe(true)
    expect(scopedConfirmation(phrase, orderSummary, [bathSummary])).toBe(false)
  })
  it.each(['Confirmo o banho e o pedido.', 'Fecha o banho, a compra também.', 'Sim.', 'Confirma só o banho?'])('não escolhe entre resumos: %s', phrase => expect(scopedConfirmation(phrase, bathSummary, [orderSummary])).toBe(false))
  it('busca nomes sem acento e plural', () => { expect(nameTerms('saches')).toEqual(['saches', 'sache']); expect(nameTerms('Rações')).toEqual(['racoes', 'racao']); expect(nameTerms('gato')).toEqual(['gato']) })
})

import { consistentConfirmation } from '../src/luna/confirmationLanguage'
// Phrases from the customer simulator (29/10/2026): a yes in the customer's own
// words, checked against the facts of the persisted summary.
describe('Luna yes in the customer own words', () => {
  const now = Date.parse('2026-10-29T13:00:00-03:00')
  const mel = { pet_name: 'Mel', services: [{ name: 'BANHO PET PORTE PEQUENO 0 KG A 10 KG (TODAS AS PELAGENS)' }], total_cents: 5500, scheduled_at_ms: Date.parse('2026-10-30T09:00:00-03:00') }
  const moto = { ...mel, total_cents: 7500, transport: { label: 'Buscar e levar', fee_cents: 2000 } }
  const golden = { items: [{ name: 'GOLDEN FORMULA GATO ADULTO FRANGO 1 KG', quantity: 1 }], total_cents: 4690, fulfillment_type: 'delivery' }
  const ultralife = { items: [{ name: 'RACAO SPECIAL DOG ULTRALIFE 3 KG', quantity: 2 }], total_cents: 10980, fulfillment_type: 'counter' }
  it.each([
    ['confirmo sim, pode deixar marcado entao', mel],
    ['Sim, confirmo o agendamento para o banho da Mel amanhã às 9h.', mel],
    ['Sim, confirmo mesmo o agendamento para amanhã às 9h, vou levar a Mel até a loja.', mel],
    ['confirma sim, obrigada! ah e quanto custa o corte de unha?', moto],
    ['Confirmo, sexta 9h com o MotoDog buscando, R$ 75.', moto],
    ['Hmm, deixa eu ver... Sim, está tudo certo, pode confirmar o pedido para entrega com pagamento no cartão na entrega.', golden],
    ['sim confirma, quero pagar com cartao na entrega', golden],
    ['Sim, confirmo o pedido e o pagamento via PIX na retirada na loja.', ultralife],
    ['pode fechar os 2 pacotes', ultralife],
  ])('aceita: %s', (phrase, payload) => expect(consistentConfirmation(phrase, (payload as Record<string, unknown>).items ? 'product_order_create' : 'appointment_create', payload, now)).toBe(true))
  it.each([
    ['confirmo, mas às 10h', mel],
    ['Confirmo o banho amanhã às 10h.', mel],
    ['Confirmo pra segunda às 9h.', mel],
    ['sim, com o MotoDog buscando', mel],
    ['sim, mas eu levo ela', moto],
    ['Confirmo, eu vou levar ela.', moto],
    ['Confirmo para retirada.', golden],
    ['sim, confirmo 3 pacotes', ultralife],
    ['Confirma pra entregar?', golden],
    ['pode me passar o preço da tosa', mel],
    ['ok, vou pensar e te falo', mel],
    ['confirmo, e marca a Luna também', mel],
    ['Pode fechar a Ração B.', ultralife],
    ['Sim, pode trocar pra tosa.', mel],
    ['confirmo, quero falar com uma pessoa antes', mel],
  ])('recusa: %s', (phrase, payload) => expect(consistentConfirmation(phrase, (payload as Record<string, unknown>).items ? 'product_order_create' : 'appointment_create', payload, now)).toBe(false))
})
