import { describe, expect, it } from 'vitest'

import { appointmentCommissionLines, buildCommissionRows } from './teamCommissionSummary'

describe('teamCommissionSummary service categories', () => {
  it('contabiliza corte de unha avulso em outros servicos', () => {
    const appointment = {
      id: 'nail-trim',
      service_group: 'banho_tosa',
      service_items: [{
        code: 'corte_de_unha',
        name: 'Corte de unha',
        group_type: 'banho_tosa',
        unit_price: 20,
      }],
      responsible_staff_key: 'esteticista-1',
    }

    expect(appointmentCommissionLines(appointment)[0].category).toBe('other')
    expect(buildCommissionRows([appointment], [
      { key: 'esteticista-1', name: 'Luana', active: true },
    ])[0]).toMatchObject({
      bath_count: 0,
      other_service_count: 1,
    })
  })

  it('mantem banho com corte de unhas como banho', () => {
    const [line] = appointmentCommissionLines({
      id: 'bath-with-nail-trim',
      service_group: 'banho_tosa',
      service_items: [{ name: 'Banho com corte de unhas', group_type: 'banho_tosa', unit_price: 50 }],
    })

    expect(line.category).toBe('bath')
  })
})
