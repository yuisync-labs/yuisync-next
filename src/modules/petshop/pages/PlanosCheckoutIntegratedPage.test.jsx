import { act, render, screen, cleanup } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import PlanosCheckoutIntegratedPage from './PlanosCheckoutIntegratedPage'

vi.mock('../components/PackageRecurringScheduleEnhancer', () => ({ PACKAGE_SCHEDULE_SAVED_EVENT: 'test:package-schedule-saved' }))
vi.mock('./PlanosNativePage', () => ({ default: () => <div>Planos nativos</div> }))
vi.mock('./PackageActivationReliablePanel', () => ({ default: () => <div>Painel de pagamento</div> }))
afterEach(cleanup)

describe('package schedule navigation', () => {
  it('keeps active subscription edits on plans', () => {
    render(<PlanosCheckoutIntegratedPage />)
    act(() => window.dispatchEvent(new CustomEvent('test:package-schedule-saved', { detail: { pendingPayment: false } })))
    expect(screen.getByText('Planos nativos')).toBeTruthy()
    expect(screen.queryByText('Painel de pagamento')).toBeNull()
  })

  it('takes a newly sold pending subscription to payment', () => {
    render(<PlanosCheckoutIntegratedPage />)
    act(() => window.dispatchEvent(new CustomEvent('test:package-schedule-saved', { detail: { pendingPayment: true } })))
    expect(screen.getByText('Painel de pagamento')).toBeTruthy()
  })
})
