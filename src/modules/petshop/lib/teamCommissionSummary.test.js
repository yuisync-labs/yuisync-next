import { describe, expect, it } from 'vitest'

import {
  appointmentCommissionLines,
  buildCommissionQueues,
  buildCommissionRows,
  hydrateLegacyCommissionAppointment,
} from './teamCommissionSummary'

describe('teamCommissionSummary service categories', () => {
  it('contabiliza corte de unha avulso em outros servicos quando a regra foi registrada', () => {
    const appointment = {
      id: 'nail-trim',
      service_group: 'banho_tosa',
      service_items: [{
        code: 'corte_de_unha',
        name: 'Corte de unha',
        group_type: 'banho_tosa',
        unit_price: 20,
        commission_rate: 5,
      }],
      responsible_staff_key: 'esteticista-1',
    }

    expect(appointmentCommissionLines(appointment)[0]).toMatchObject({
      category: 'other',
      commission_rule_source: 'appointment_snapshot',
      commission: 1,
    })
    expect(buildCommissionRows([appointment], [
      { key: 'esteticista-1', name: 'Luana', active: true },
    ])[0]).toMatchObject({
      bath_count: 0,
      other_service_count: 1,
      total_commission: 1,
      snapshot_missing_count: 0,
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

  it('nao aplica taxa padrao atual quando o snapshot historico esta ausente', () => {
    const appointment = {
      id: 'bath-with-hygienic-grooming',
      service_group: 'banho_tosa',
      responsible_staff_key: 'esteticista-1',
      service_items: [{
        name: 'Banho com tosa higienica',
        group_type: 'banho_tosa',
        unit_price: 50,
      }],
    }
    const [line] = appointmentCommissionLines(appointment)

    expect(line).toMatchObject({
      category: 'bath',
      rate: null,
      commission: null,
      commission_rule_source: 'missing_snapshot',
      rule_snapshot_missing: true,
      close_ready: false,
    })
    expect(buildCommissionQueues([appointment])).toMatchObject({
      pendingResponsible: [],
      pendingRuleSnapshot: [appointment],
      ready: [],
    })
  })

  it('preserva a taxa registrada mesmo que o catalogo atual tenha outra regra', () => {
    const appointment = {
      id: 'historical-rate',
      service_group: 'banho_tosa',
      responsible_staff_key: 'esteticista-1',
      service_items: [{
        code: 'banho',
        name: 'Banho',
        group_type: 'banho_tosa',
        unit_price: 80,
        commission_rate: 7.5,
      }],
    }
    const hydrated = hydrateLegacyCommissionAppointment(appointment, [{
      code: 'banho',
      name: 'Banho atual',
      default_price: 100,
      commission_rate: 25,
    }])
    const [line] = appointmentCommissionLines(hydrated)

    expect(line).toMatchObject({
      revenue: 80,
      commission_rate: 7.5,
      commission: 6,
      commission_rule_source: 'appointment_snapshot',
    })
  })

  it('separa sem responsavel, sem regra historica e pronto para fechamento', () => {
    const noResponsible = {
      id: 'no-responsible',
      service_group: 'banho_tosa',
      service_items: [{ name: 'Banho', unit_price: 50, commission_rate: 5 }],
    }
    const noRule = {
      id: 'no-rule',
      service_group: 'banho_tosa',
      responsible_staff_key: 'esteticista-1',
      service_items: [{ name: 'Banho', unit_price: 50 }],
    }
    const ready = {
      id: 'ready',
      service_group: 'banho_tosa',
      responsible_staff_key: 'esteticista-1',
      service_items: [{ name: 'Banho', unit_price: 50, commission_rate: 5 }],
    }

    const queues = buildCommissionQueues([noResponsible, noRule, ready])
    expect(queues.pendingResponsible.map((item) => item.id)).toEqual(['no-responsible'])
    expect(queues.pendingRuleSnapshot.map((item) => item.id)).toEqual(['no-rule'])
    expect(queues.ready.map((item) => item.id)).toEqual(['ready'])
  })
})
