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
