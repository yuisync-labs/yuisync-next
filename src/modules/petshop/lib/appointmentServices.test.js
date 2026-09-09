import { describe, expect, it } from 'vitest'
import { dashboardAppointmentServiceLabel } from './appointmentServices'

describe('dashboardAppointmentServiceLabel', () => {
  it('uses the immutable service snapshot instead of a catalog identifier', () => {
    expect(dashboardAppointmentServiceLabel({
      service_type: 'catalog_918ab88b5baf4c1c85bce7c444a425c8',
      service_items: [{ name: 'BANHO PET PORTE PEQUENO 0 KG A 10 KG' }],
    })).toBe('BANHO PET PORTE PEQUENO 0 KG A 10 KG')
  })

  it('keeps known legacy labels when no snapshot exists', () => {
    expect(dashboardAppointmentServiceLabel(
      { service_type: 'banho' },
      () => 'Banho',
    )).toBe('Banho')
  })

  it('never exposes an internal catalog identifier', () => {
    expect(dashboardAppointmentServiceLabel(
      { service_type: 'catalog_missing', service_items: [] },
      (value) => value,
    )).toBe('Serviço agendado')
  })
})
