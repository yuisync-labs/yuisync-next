import { describe, expect, it } from 'vitest'

import {
  DIRECT_APPOINTMENT_EDIT_FIELDS,
  TRANSACTIONAL_APPOINTMENT_EDIT_FIELDS,
  appointmentUpdateRequiresTransaction,
} from './appointmentUpdateSemantics'

const directCases = [
  ['responsible-only', { responsible_staff_key: 'staff-2' }],
  ['notes-only', { notes: 'Usar shampoo hipoalergenico' }],
  ['status-only', { status: 'confirmado' }],
  ['transport-only', { transport_mode: 'somente_levar', transport_city: 'Muriae' }],
]

const transactionalCases = [
  ['date/time-only', { scheduled_at: '2026-08-20T16:30:00.000Z' }],
  ['service-only', { service_type: 'tosa-maquina', services: [{ code: 'tosa-maquina' }] }],
  ['pet-only', { client_id: 'client-b', pet_id: 'pet-b' }],
]

describe('appointment update semantic domains', () => {
  it.each(directCases)('%s remains a direct edit and cannot accidentally reprice/reallocate', (_, payload) => {
    expect(appointmentUpdateRequiresTransaction(payload)).toBe(false)
  })

  it.each(transactionalCases)('%s uses the operational transaction boundary', (_, payload) => {
    expect(appointmentUpdateRequiresTransaction(payload)).toBe(true)
  })

  it('mixed UI payload becomes transactional only when a real operational field is present', () => {
    expect(appointmentUpdateRequiresTransaction({ notes: 'ok', responsible_staff_key: 'a' })).toBe(false)
    expect(appointmentUpdateRequiresTransaction({ notes: 'ok', service_type: 'banho' })).toBe(true)
  })

  it('keeps direct and transactional field inventories disjoint', () => {
    const direct = new Set(DIRECT_APPOINTMENT_EDIT_FIELDS)
    expect(TRANSACTIONAL_APPOINTMENT_EDIT_FIELDS.some((field) => direct.has(field))).toBe(false)
  })

  it('does not classify price as a billing intent signal', () => {
    expect(appointmentUpdateRequiresTransaction({ price: 35 })).toBe(false)
    expect(TRANSACTIONAL_APPOINTMENT_EDIT_FIELDS).not.toContain('price')
  })
})
