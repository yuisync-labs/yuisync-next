import { describe, expect, it } from 'vitest'
import { nextBookingStep } from '../src/luna/bookingSteps'

const step = (items: number, fields: Record<string, string>, transportOffered = true) => nextBookingStep({ items: Array.from({ length: items }, (_, i) => ({ id: 's' + i })), fields }, { transportOffered }).step

describe('booking steps follow the store order', () => {
  it('walks service, pet, day, slot, transport and summary', () => {
    expect(step(0, {})).toBe('service')
    expect(step(1, {})).toBe('pet')
    expect(step(1, { pet_id: 'p' })).toBe('date')
    expect(step(1, { pet_id: 'p', period: 'manhã' })).toBe('slot')
    expect(step(1, { pet_id: 'p', scheduled_at: '2026-10-28T09:00:00-03:00' })).toBe('transport')
    expect(step(1, { pet_id: 'p', scheduled_at: '2026-10-28T09:00:00-03:00', transport_mode: 'self' })).toBe('summary')
  })
  it('asks the MotoDog address and option only when the customer wants it', () => {
    const base = { pet_id: 'p', scheduled_at: '2026-10-28T09:00:00-03:00', transport_mode: 'pickup_dropoff' }
    expect(step(1, base)).toBe('address')
    expect(step(1, { ...base, address: JSON.stringify({ street: 'Rua A', number: '10', city: 'Muriaé' }) })).toBe('transport_option')
    expect(step(1, { ...base, address: JSON.stringify({ street: 'Rua A', city: 'Muriaé' }), transport_option_id: 't1' })).toBe('summary')
  })
  it('skips transport when the store has no MotoDog', () => {
    expect(step(1, { pet_id: 'p', scheduled_at: '2026-10-28T09:00:00-03:00' }, false)).toBe('summary')
  })
})
