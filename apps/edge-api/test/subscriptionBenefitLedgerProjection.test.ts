import { describe, expect, it } from 'vitest'

import { projectBenefitLedger } from '../src/subscriptionBenefitLedger'

describe('subscription benefit ledger projection', () => {
  it('separates capacity, available balance, reservations, consumption and unlinked base usage', () => {
    const [bath] = projectBenefitLedger({
      services: [{ service_type: 'banho', service_name: 'Banho', qty_per_cycle: 4 }],
      baseUsage: { banho: 1 },
      allocations: [
        {
          id: 'allocation-reserved',
          benefit_key: 'banho',
          service_code: 'banho',
          state: 'reserved',
          appointment_id: 'appointment-1',
          appointment_status: 'scheduled',
          scheduled_at_ms: Date.parse('2026-09-10T12:00:00.000Z'),
          service_name: 'Banho',
          reserved_at_ms: Date.parse('2026-09-07T12:00:00.000Z'),
        },
        {
          id: 'allocation-consumed',
          benefit_key: 'banho',
          service_code: 'banho',
          state: 'consumed',
          appointment_id: 'appointment-2',
          appointment_status: 'completed',
          scheduled_at_ms: Date.parse('2026-09-05T12:00:00.000Z'),
          service_name: 'Banho',
          consumed_at_ms: Date.parse('2026-09-05T13:00:00.000Z'),
        },
      ],
    })

    expect(bath).toMatchObject({
      benefit_key: 'banho',
      label: 'Banho',
      capacity: 4,
      manual_or_historical: 1,
      reserved: 1,
      consumed: 1,
      used: 2,
      available: 1,
    })
    expect(bath.movements).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'historical_or_manual_adjustment',
        quantity: 1,
        appointment_id: null,
        origin_known: false,
      }),
      expect.objectContaining({
        kind: 'appointment',
        state: 'reserved',
        appointment_id: 'appointment-1',
        origin_known: true,
      }),
      expect.objectContaining({
        kind: 'appointment',
        state: 'consumed',
        appointment_id: 'appointment-2',
        origin_known: true,
      }),
    ]))
  })

  it('keeps released appointment movements for audit without reducing available capacity', () => {
    const [item] = projectBenefitLedger({
      services: [{ service_type: 'tosa', qty_per_cycle: 2 }],
      allocations: [{
        id: 'released',
        benefit_key: 'tosa',
        state: 'released',
        appointment_id: 'appointment-cancelled',
        appointment_status: 'cancelled',
        released_at_ms: Date.parse('2026-09-06T12:00:00.000Z'),
      }],
    })

    expect(item).toMatchObject({ capacity: 2, used: 0, reserved: 0, consumed: 0, available: 2 })
    expect(item.movements[0]).toMatchObject({ state: 'released', appointment_id: 'appointment-cancelled' })
  })
})
