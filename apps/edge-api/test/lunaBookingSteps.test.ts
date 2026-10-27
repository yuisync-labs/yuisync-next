import { describe, expect, it } from 'vitest'
import { nextBookingStep, weightSaid, dateSaid, selfTransportSaid } from '../src/luna/bookingSteps'

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
    expect(step(1, { ...base, address: JSON.stringify({ street: 'Rua A', number: '10' }) })).toBe('transport_option')
    expect(step(1, { ...base, address: JSON.stringify({ street: 'Rua A', city: 'Muriaé' }), transport_option_id: 't1' })).toBe('summary')
  })
  it('asks the weight after the pet when the price depends on it', () => {
    const next = (fields: Record<string, string>) => nextBookingStep({ items: [{ id: 's' }], fields }, { transportOffered: false, weightNeeded: true })
    expect(next({ pet_id: 'p' }).step).toBe('weight')
    expect(next({ pet_id: 'p', weight_kg: '8' }).step).toBe('date')
    expect(nextBookingStep({ items: [{ id: 's' }], fields: { pet_id: 'p' } }, { transportOffered: false }).done).toEqual(['serviço', 'pet'])
  })
  it('counts a weight only when the customer wrote it', () => {
    expect(weightSaid('8', 'ele tem uns 8kg')).toBe(true)
    expect(weightSaid('10.5', 'tem 10,5 kg')).toBe(true)
    expect(weightSaid('15', 'porte médio, não sei o peso')).toBe(false)
    expect(weightSaid('8', 'tem 18 kg')).toBe(false)
  })
  it('needs a day before slots and the customer own words before assuming own transport', () => {
    expect(dateSaid('quero agendar um banho pra Mel')).toBe(false)
    expect(dateSaid('Banho pra Mel quarta às 10h')).toBe(true)
    expect(dateSaid('tem pra amanhã?')).toBe(true)
    expect(dateSaid('pode ser 30/10?')).toBe(true)
    expect(selfTransportSaid('Banho pra Mel quarta às 10h')).toBe(false)
    expect(selfTransportSaid('eu levo e busco')).toBe(true)
    expect(selfTransportSaid('não precisa buscar, eu trago')).toBe(true)
  })
  it('skips transport when the store has no MotoDog', () => {
    expect(step(1, { pet_id: 'p', scheduled_at: '2026-10-28T09:00:00-03:00' }, false)).toBe('summary')
  })
})
