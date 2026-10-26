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
