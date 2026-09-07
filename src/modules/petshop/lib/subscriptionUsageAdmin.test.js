import { describe, expect, it } from 'vitest'

import {
  benefitMovementDescription,
  buildEditableUsage,
  clampSubscriptionUsage,
  normalizeBenefitLedger,
} from './subscriptionUsageAdmin'

const subscription = {
  subscription_plans: {
    services: [
      { service_type: 'banho', service_name: 'Banho', qty_per_cycle: 4 },
      { service_type: 'motodog', service_name: 'MotoDog', qty_per_cycle: 2 },
    ],
  },
  services_used: { banho: 3, motodog: 0 },
  services_reserved: { banho: 1, motodog: 0 },
  services_consumed: { banho: 1, motodog: 0 },
}

describe('subscription usage admin', () => {
  it('does not hide persisted usage when a reservation makes the current state inconsistent', () => {
    const [bath] = buildEditableUsage({
      ...subscription,
      services_used: { banho: 4 },
    })

    expect(bath).toMatchObject({
      total: 4,
      used: 4,
      consumed: 1,
      reserved: 1,
      max_used: 3,
      available: 0,
    })
  })

  it('shows available balance after persisted usage and reservations', () => {
    const [bath] = buildEditableUsage(subscription)
    expect(bath).toMatchObject({ total: 4, used: 3, reserved: 1, consumed: 1, manual_used: 2, available: 0 })
  })

  it('rejects instead of silently clamping an edit that collides with an open reservation', () => {
    expect(() => clampSubscriptionUsage(subscription, { banho: 4, motodog: 0 }))
      .toThrow(/1 unidade está reservada/)
  })

  it('accepts the highest total usage that preserves the real reservation', () => {
    expect(clampSubscriptionUsage(subscription, { banho: 3, motodog: 0 }))
      .toEqual({ banho: 3, motodog: 0 })
  })

  it('does not let an admin erase usage already backed by completed appointments', () => {
    expect(() => clampSubscriptionUsage(subscription, { banho: 0, motodog: 0 }))
      .toThrow(/já foram consumidas por atendimentos concluídos/)
  })

  it('allows full manual usage when no allocation is reserved', () => {
    expect(clampSubscriptionUsage({
      ...subscription,
      services_used: { banho: 3, motodog: 0 },
      services_reserved: { banho: 0, motodog: 0 },
      services_consumed: { banho: 1, motodog: 0 },
    }, { banho: 4, motodog: 0 })).toEqual({ banho: 4, motodog: 0 })
  })

  it('keeps unlinked adjustments explicit instead of inventing an appointment origin', () => {
    const [benefit] = normalizeBenefitLedger([{
      benefit_key: 'banho',
      label: 'Banho',
      capacity: 4,
      used: 2,
      reserved: 1,
      consumed: 1,
      manual_or_historical: 1,
      movements: [
        {
          id: 'base:banho',
          kind: 'historical_or_manual_adjustment',
          state: 'consumed',
          quantity: 1,
          appointment_id: null,
          origin_known: false,
        },
        {
          id: 'allocation-1',
          kind: 'appointment',
          state: 'consumed',
          quantity: 1,
          appointment_id: 'appointment-1',
          origin_known: true,
        },
      ],
    }])

    expect(benefit.available).toBe(1)
    expect(benefit.movements[0]).toMatchObject({ origin_known: false, appointment_id: null })
    expect(benefitMovementDescription(benefit.movements[0])).toMatch(/sem vínculo com atendimento/)
    expect(benefitMovementDescription(benefit.movements[1])).toBe('Consumido por atendimento concluído')
  })
})
