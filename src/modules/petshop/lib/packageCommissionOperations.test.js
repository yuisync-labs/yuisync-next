import { describe, expect, it } from 'vitest'

import { buildPackageCommissionItems } from './packageCommissionOperations'

const allocation = {
  plan_name: 'Plano Mensal',
  service_pool: 80,
  transport_total: 20,
  fallback_unit_value: 20,
  unit_values: new Map([['banho', 20]]),
  service_entries: [],
}

describe('package commission base provenance', () => {
  it('preserves an already recorded package unit base instead of replacing it with the current plan allocation', () => {
    const [item] = buildPackageCommissionItems({
      allocation,
      items: [{ code: 'banho', name: 'Banho', package_unit_price: 17.5 }],
    })

    expect(item).toMatchObject({
      package_unit_price: 17.5,
      package_base_source: 'appointment_snapshot',
    })
  })

  it('marks a reconstructed package base when only the current plan allocation is available', () => {
    const [item] = buildPackageCommissionItems({
      allocation,
      items: [{ code: 'banho', name: 'Banho' }],
    })

    expect(item).toMatchObject({
      package_unit_price: 20,
      package_base_source: 'current_plan_allocation',
    })
  })
})
