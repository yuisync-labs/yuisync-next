import { describe, expect, it } from 'vitest'
import { buildAgendaStats } from './agendaStats'

const day = new Date(2026, 9, 6, 12)
const bath = (id, extra = {}) => ({ id, scheduled_at: new Date(2026, 9, 6, 8, 15).toISOString(), status: 'agendado',
  service_items: [{ name: 'BANHO PET', benefit_used: false }], ...extra })

describe('agenda stats from displayed appointments', () => {
  it('counts all four baths, including package benefits, once per appointment', () => {
    const rows = [bath('a'), bath('b'), bath('c', { subscription_id: 'package', service_items: [{ name: 'BANHO PET', benefit_used: true }] }), bath('d', { price: 0 })]
    expect(buildAgendaStats(rows, day)).toMatchObject({ total: 4, agendado: 4, baths: 4, grooming: 0 })
  })
  it('updates immediately when the date or displayed search results change', () => {
    expect(buildAgendaStats([bath('a')], new Date(2026, 9, 5, 12)).baths).toBe(0)
    expect(buildAgendaStats([], day).total).toBe(0)
    expect(buildAgendaStats([bath('b')], day).baths).toBe(1)
  })
  it('excludes cancelled baths and does not classify nail clipping as a bath or grooming', () => {
    const result = buildAgendaStats([bath('a', { status: 'cancelled' }), bath('b', { service_items: [{ name: 'CORTE DE UNHA' }] }), bath('c', { service_items: [{ name: 'TOSA TESOURA' }] })], day)
    expect(result).toMatchObject({ total: 3, cancelado: 1, baths: 0, grooming: 1 })
  })
  it('uses catalog labels for opaque codes and counts combined services once each', () => {
    expect(buildAgendaStats([bath('a', { service_items: [], service_type: 'catalog_1' })], day, [{ code: 'catalog_1', name: 'BANHO + TOSA' }])).toMatchObject({ baths: 1, grooming: 1 })
  })
  it('uses the same local date as the cards even across UTC midnight', () => {
    const late = new Date(2026, 9, 6, 23, 30).toISOString()
    expect(buildAgendaStats([bath('a', { scheduled_at: late })], day).baths).toBe(1)
    expect(buildAgendaStats([bath('a', { scheduled_at: late })], new Date(2026, 9, 7, 12)).baths).toBe(0)
  })
})
