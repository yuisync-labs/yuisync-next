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
      { op: 'gte', column: 'created_at_ms', value: 1785542400000 },
    ])
    expect(body.orders).toEqual([{ column: 'created_at_ms', ascending: false }])
  })

  it('normalizes appointment date filters to the SQLite datetime projection', () => {
    const body = normalizeBaseCompatQueryBody({
      table: 'appointments',
      filters: [
        { op: 'gte', column: 'scheduled_at', value: '2026-08-29T00:00:00-03:00' },
        { op: 'lte', column: 'scheduled_at', value: '2026-08-29T23:59:59.999-03:00' },
      ],
    })

    expect(body.filters).toEqual([
      { op: 'gte', column: 'scheduled_at', value: '2026-08-29 03:00:00.000' },
      { op: 'lte', column: 'scheduled_at', value: '2026-08-30 02:59:59.999' },
    ])
  })

  it('normalizes the Growth, loyalty and fiscal timestamp orders seen in staging E2E', () => {
    for (const table of [
      'petshop_growth_no_show_events',
      'petshop_growth_booking_requests',
      'petshop_growth_leads',
      'petshop_growth_report_cards',
      'loyalty_points',
      'fiscal_audit_logs',
    ]) {
      const body = normalizeBaseCompatQueryBody({
        table,
        orders: [{ column: 'created_at', ascending: false, nullsFirst: false }],
      })
      expect(body.orders).toEqual([
        { column: 'created_at_ms', ascending: false, nullsFirst: false },
      ])
    }
  })

  it('removes implicit tenant and module keys from upsert conflict targets', () => {
    expect(
      normalizeBaseCompatQueryBody({
        table: 'petshop_growth_booking_settings',
        action: 'upsert',
        conflict: 'tenant_id,module_id',
      }).conflict,
    ).toBe('')

    expect(
      normalizeBaseCompatQueryBody({
        table: 'petshop_growth_leads',
        action: 'upsert',
        conflict: 'tenant_id,module_id,id,id',
      }).conflict,
    ).toBe('id')
  })

  it('rewrites timestamp columns inside legacy OR expressions', () => {
    const body = normalizeBaseCompatQueryBody({
      table: 'petshop_growth_leads',
      filters: [
        {
          op: 'or',
          expression: 'next_followup_at.gte.2026-08-10,last_contact_at.is.null',
        },
      ],
    })

    expect(body.filters).toEqual([
      {
        op: 'or',
        column: undefined,
        expression: 'next_followup_at_ms.gte.2026-08-10,last_contact_at_ms.is.null',
      },
    ])
  })
})
