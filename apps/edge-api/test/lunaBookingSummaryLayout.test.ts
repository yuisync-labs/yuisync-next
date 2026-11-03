import { describe, expect, it } from 'vitest'
import { renderThinkProposalSummary } from '../src/luna/proposalPresentation'

describe('booking summary follows the store layout', () => {
  it('lists pet, service, value, place, address, date and time on their own lines', () => {
    const payload = { pet_name: 'Thor', scheduled_at_ms: Date.UTC(2026, 6, 31, 16, 0), services: [{ name: 'BANHO PET PORTE PEQUENO', price_cents: 5500 }], subtotal_cents: 5500 }
    const text = renderThinkProposalSummary({ id: 'p', version: 1, fingerprint: 'f', operation_kind: 'appointment_create', payload_json: JSON.stringify(payload) }, 'America/Sao_Paulo', { store_name: 'Quatro Patas', address: 'Avenida Constantino Pinto, 191', neighborhood: 'Centro', city: 'Muriaé' })
    expect(text.split('\n')).toEqual([
      'Segue o resumo do seu agendamento:',
      'Pet: Thor',
      'Serviço: BANHO PET PORTE PEQUENO: R$ 55,00',
      'Valor do agendamento: R$ 55,00',
      'Local: Quatro Patas - Muriaé',
      'Endereço: Avenida Constantino Pinto, 191 - Centro, Muriaé',
      'Data: 31/07/2026 (sexta-feira)',
      'Horário: 13:00',
      'Você confirma este resumo?',
    ])
  })
})
