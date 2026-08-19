import { describe, expect, it } from 'vitest'
import { normalizeBaseCompatQueryBody } from '../src/compatApi'

describe('legacy compat query adapter', () => {
  it('maps normalized legacy timestamps back to physical D1 columns', () => {
    const body = normalizeBaseCompatQueryBody({
      table: 'petshop_growth_booking_requests',
      action: 'select',
      filters: [
        { op: 'eq', column: 'tenant_id', value: 'tenant-1' },
        { op: 'gte', column: 'created_at', value: '2026-08-01T00:00:00.000Z' },
      ],
      orders: [{ column: 'created_at', ascending: false }],
    })
    expect(body.filters).toEqual([
      { op: 'eq', column: 'tenant_id', value: 'tenant-1' },
      { op: 'gte', column: 'created_at_ms', value: '2026-08-01T00:00:00.000Z' },
    ])
    expect(body.orders).toEqual([{ column: 'created_at_ms', ascending: false }])
  })

  it('normalizes the Growth, loyalty and fiscal timestamp orders seen in staging E2E', () => {
    for (const table of ['petshop_growth_no_show_events','petshop_growth_booking_requests','petshop_growth_leads','petshop_growth_report_cards','loyalty_points','fiscal_audit_logs']) {
      const body = normalizeBaseCompatQueryBody({ table, orders: [{ column: 'created_at', ascending: false, nullsFirst: false }] })
      expect(body.orders).toEqual([{ column: 'created_at_ms', ascending: false, nullsFirst: false }])
    }
  })

  it('removes implicit tenant and module keys from upsert conflict targets', () => {
    expect(normalizeBaseCompatQueryBody({ table: 'petshop_growth_booking_settings', action: 'upsert', conflict: 'tenant_id,module_id' }).conflict).toBe('')
    expect(normalizeBaseCompatQueryBody({ table: 'petshop_growth_leads', action: 'upsert', conflict: 'tenant_id,module_id,id,id' }).conflict).toBe('id')
  })

  it('rewrites timestamp columns inside legacy OR expressions', () => {
    const body = normalizeBaseCompatQueryBody({
      table: 'petshop_growth_leads',
      filters: [{ op: 'or', expression: 'next_followup_at.gte.2026-08-10,last_contact_at.is.null' }],
    })
    expect(body.filters).toEqual([{ op: 'or', column: undefined, expression: 'next_followup_at_ms.gte.2026-08-10,last_contact_at_ms.is.null' }])
  })

  it('normalizes the exact legacy pet upsert emitted by Agenda before booking', () => {
    const body = normalizeBaseCompatQueryBody({
      table: 'pets',
      action: 'upsert',
      payload: [{
        id: 'pet-1', tenant_id: 'tenant-1', client_id: 'client-1',
        owner_name: 'Tutor Regressao', owner_phone: '(32) 99999-1111', owner_email: 'qa@example.test',
        owner_cpf: '123.456.789-00', owner_address: 'Rua QA, 123',
        pet_name: 'Nina QA', pet_breed: 'Shih Tzu', pet_species: 'dog',
        pet_birth_date: '2022-01-01', pet_weight: 10.099,
        pet_notes: 'Pet limite pequeno\nPet color: Branca', updated_at: '2026-08-19T20:37:42.547Z',
      }],
      onConflict: 'id',
    })

    expect(body.conflict).toBe('id')
    expect(body.payload).toEqual([{
      id: 'pet-1', tenant_id: 'tenant-1', client_id: 'client-1',
      name: 'Nina QA', species: 'dog', breed: 'Shih Tzu', birth_date: '2022-01-01',
      weight_kg: 10.099, notes: 'Pet limite pequeno\nPet color: Branca', updated_at: '2026-08-19T20:37:42.547Z',
    }])
  })
})
