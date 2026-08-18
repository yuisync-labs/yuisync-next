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
})
