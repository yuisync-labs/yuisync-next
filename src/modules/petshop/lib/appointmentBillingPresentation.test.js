import { describe, expect, it } from 'vitest'

import {
  appointmentCardKind,
  appointmentPackagePresentation,
} from './appointmentBillingPresentation'

describe('appointment billing presentation', () => {
  it('classifies baths, packages and grooming services with stable semantic kinds', () => {
    expect(appointmentCardKind({
      service_items: [{ name: 'BANHO PET PORTE PEQUENO', benefit_used: false }],
    })).toBe('bath')

    expect(appointmentCardKind({
      service_items: [{ name: 'BANHO PET PORTE PEQUENO', benefit_used: true }],
    })).toBe('package')

    expect(appointmentCardKind({
      service_items: [{ name: 'TOSA TESOURA 0 KG A 10 KG', benefit_used: false }],
    })).toBe('grooming')
  })

  it('does not turn a grooming service into a package for a transport-only snapshot', () => {
    const appointment = {
      subscription_id: 'sub-transport',
      subscription_benefit_used: true,
      subscription_benefit_status: 'reserved',
      billing_intent_type: 'subscription',
      subscription_benefits_json: JSON.stringify([
        { key: 'motodog', kind: 'transport', status: 'reserved' },
      ]),
      service_items: [{ name: 'TOSA TESOURA', benefit_used: false }],
    }

    expect(appointmentPackagePresentation(appointment).usesPackage).toBe(false)
    expect(appointmentCardKind(appointment)).toBe('grooming')
  })
})
