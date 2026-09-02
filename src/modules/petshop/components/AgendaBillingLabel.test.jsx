import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { AgendaBillingLabel } from './AgendaBillingLabel'

function labelFor(appointment) {
  render(<AgendaBillingLabel appointment={appointment}/>)
  return screen.getByText(/PACOTE|R\$/)
}

describe('AgendaBillingLabel', () => {
  it('renders persisted package state without reading rendered price or DOM state', () => {
    const label = labelFor({
      price: 99,
      subscription_id: 'sub-1',
      subscription_benefit_status: 'reserved',
      billing_intent_type: 'subscription',
    })

    expect(label).toHaveTextContent('PACOTE · R$ 0,00')
    expect(label).toHaveAttribute('data-billing-source', 'subscription')
    expect(label).toHaveAttribute('data-benefit-state', 'reserved')
  })

  it('renders standalone value even when it is cheaper than a previous package-eligible service', () => {
    const label = labelFor({
      price: 35,
      subscription_benefit_status: 'released',
      billing_intent_type: 'standalone',
    })

    expect(label).toHaveTextContent('R$')
    expect(label).toHaveTextContent('35')
    expect(label).toHaveAttribute('data-billing-source', 'standalone')
  })

  it('keeps a grooming service standalone when the package covers only MotoDog', () => {
    const label = labelFor({
      price: 130,
      subscription_id: 'sub-transport',
      subscription_benefit_used: true,
      subscription_benefit_status: 'reserved',
      billing_intent_type: 'subscription',
      service_items: [{ name: 'TOSA TESOURA 0 KG A 10 KG', unit_price: 130, benefit_used: false }],
      subscription_benefits: [{
        key: 'motodog',
        kind: 'transport',
        status: 'reserved',
        transport_mode: 'buscar_e_levar',
      }],
    })

    expect(label).toHaveTextContent('R$')
    expect(label).toHaveTextContent('130')
    expect(label).not.toHaveTextContent('PACOTE')
    expect(label).toHaveAttribute('data-billing-source', 'standalone')
  })

  it('keeps the package label when the service itself has an active benefit', () => {
    const label = labelFor({
      price: 55,
      subscription_id: 'sub-service',
      subscription_benefit_status: 'reserved',
      service_items: [{ name: 'BANHO PET', unit_price: 55, benefit_used: true }],
      subscription_benefits: [{ kind: 'service', service_code: 'banho-pet', status: 'reserved' }],
    })

    expect(label).toHaveTextContent('PACOTE · R$ 0,00')
    expect(label).toHaveAttribute('data-billing-source', 'subscription')
  })
})
