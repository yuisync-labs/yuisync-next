import { env } from 'cloudflare:workers'
import { expect, it } from 'vitest'
import { selectRows } from '../src/compatApiRuntime.js'

it('inclui o pacote recebido hoje e separa os dias de Brasília nos filtros do caixa', async () => {
  const db = (env as EdgeEnv & { DB: D1Database }).DB
  const tenantId = `cash-date-${crypto.randomUUID()}`, otherTenantId = `${tenantId}-other`
  const scope = { tenantId, moduleId: 'petshop' }
  const now = Date.parse('2026-10-16T13:16:32.971Z')
  const fixtures = [
    ['day15-start', '2026-10-15T03:00:00.000Z'],
    ['day15-end', '2026-10-16T02:59:59.999Z'],
    ['day16-start', '2026-10-16T03:00:00.000Z'],
    ['package-paid', '2026-10-16T13:16:32.971Z'],
    ['day16-end', '2026-10-17T02:59:59.999Z'],
    ['day17-start', '2026-10-17T03:00:00.000Z'],
  ]
  for (const id of [tenantId, otherTenantId]) {
    await db.prepare("INSERT INTO tenants(id,slug,name,status,created_at_ms,updated_at_ms) VALUES(?1,?1,'Cash dates','active',?2,?2)").bind(id, now).run()
  }
  try {
    await db.batch([
      db.prepare("INSERT INTO clients(tenant_id,module_id,id,name,status,created_at_ms,updated_at_ms) VALUES(?1,'petshop','client','Tutora','active',?2,?2)").bind(tenantId, now),
      db.prepare("INSERT INTO pets(tenant_id,module_id,id,client_id,name,status,created_at_ms,updated_at_ms) VALUES(?1,'petshop','pet','client','Pet','active',?2,?2)").bind(tenantId, now),
      db.prepare("INSERT INTO subscription_plans(tenant_id,module_id,id,name,price_cents,created_at_ms,updated_at_ms) VALUES(?1,'petshop','plan','Pacote',20000,?2,?2)").bind(tenantId, now),
      db.prepare("INSERT INTO client_subscriptions(tenant_id,module_id,id,plan_id,client_id,status,started_at_ms,created_at_ms,updated_at_ms) VALUES(?1,'petshop','subscription','plan','client','active',?2,?2,?2)").bind(tenantId, now),
      ...fixtures.map(([id, at]) => db.prepare(`INSERT INTO sales(tenant_id,module_id,id,operation_key,subscription_id,
        source,fulfillment_type,subtotal_cents,total_cents,status,created_at_ms,updated_at_ms)
        VALUES(?1,'petshop',?2,?2,?3,'pos','service',20000,20000,'completed',?4,?4)`)
        .bind(tenantId, id, id === 'package-paid' ? 'subscription' : null, Date.parse(at))),
      db.prepare(`INSERT INTO sales(tenant_id,module_id,id,operation_key,source,fulfillment_type,
        subtotal_cents,total_cents,status,created_at_ms,updated_at_ms)
        VALUES(?1,'petshop','other','other','pos','service',90000,90000,'completed',?2,?2)`).bind(otherTenantId, now),
      db.prepare(`INSERT INTO payments(tenant_id,module_id,id,sale_id,operation_key,method,amount_cents,
        status,received_at_ms,created_at_ms,updated_at_ms)
        VALUES(?1,'petshop','pix','package-paid','payment','pix',20000,'received',?2,?2,?2)`).bind(tenantId, now),
      db.prepare(`INSERT INTO cash_register(tenant_id,module_id,id,opened_at_ms)
        VALUES(?1,'petshop','register',?2)`).bind(tenantId, Date.parse('2026-10-16T12:00:00Z')),
      db.prepare(`INSERT INTO appointments(tenant_id,module_id,id,client_id,pet_id,scheduled_at_ms,duration_min,
        status,created_at_ms,updated_at_ms) VALUES(?1,'petshop','package-bath','client','pet',?2,60,'completed',?2,?3)`)
        .bind(tenantId, Date.parse('2026-10-15T13:00:00Z'), now),
    ])
    const range = (start: string, end: string) => [
      { column: 'created_at', op: 'gte', value: start },
      { column: 'created_at', op: 'lte', value: end },
    ]
    const readSales = (filters: unknown[]) => selectRows(db, 'sales', { read: 'compat_sales' }, {
      filters: [{ column: 'status', op: 'eq', value: 'concluido' }, ...filters],
      orders: [{ column: 'created_at', ascending: true }], limit: null,
    }, scope)

    const day15 = await readSales(range('2026-10-15T00:00:00-03:00', '2026-10-15T23:59:59.999-03:00'))
    expect(day15.rows.map(row => row.id)).toEqual(['day15-start', 'day15-end'])
    for (const [start, end] of [
      ['2026-10-16T00:00:00-03:00', '2026-10-16T23:59:59.999-03:00'],
      ['2026-10-16T03:00:00.000Z', '2026-10-17T02:59:59.999Z'],
    ]) {
      const day16 = await readSales(range(start, end))
      expect(day16.rows.map(row => row.id)).toEqual(['day16-start', 'package-paid', 'day16-end'])
      expect(day16.rows.find(row => row.id === 'package-paid')).toMatchObject({
        subscription_id: 'subscription', total_price: 200, payment_method: 'pix',
        created_at: '2026-10-16T13:16:32.000Z',
      })
    }

    const registers = await selectRows(db, 'cash_register', { read: 'compat_cash_register' }, {}, scope)
    expect(registers.rows[0]).toMatchObject({ opened_at: '2026-10-16T12:00:00.000Z', closed_at: null })
    const reopened = await readSales(range(String(registers.rows[0].opened_at), '2026-10-17T02:59:59.999Z'))
    expect(reopened.rows.map(row => row.id)).toEqual(['package-paid', 'day16-end'])
    const splits = await selectRows(db, 'sale_payment_splits', { read: 'compat_sale_payment_splits' }, {
      filters: range('2026-10-16T03:00:00Z', '2026-10-17T02:59:59.999Z'),
    }, scope)
    expect(splits.rows).toEqual([expect.objectContaining({
      sale_id: 'package-paid', payment_method: 'pix', amount: 200, created_at: '2026-10-16T13:16:32.000Z',
    })])
    const baths = await selectRows(db, 'appointments', { read: 'compat_appointments' }, {
      filters: range('2026-10-16T03:00:00Z', '2026-10-17T02:59:59.999Z')
        .map(filter => ({ ...filter, column: 'updated_at' })),
    }, scope)
    expect(baths.rows).toEqual([expect.objectContaining({
      id: 'package-bath', status: 'concluido', scheduled_at: '2026-10-15T13:00:00.000Z',
      updated_at: '2026-10-16T13:16:32.000Z',
    })])
    // A non-datetime predicate remains a literal text comparison.
    expect((await readSales([{ column: 'notes', op: 'eq', value: '2026-10-16T13:16:32Z' }])).rows).toHaveLength(0)
  } finally {
    for (const table of ['payments', 'sales', 'cash_register', 'appointments', 'client_subscriptions', 'subscription_plans', 'pets', 'clients']) {
      await db.prepare(`DELETE FROM ${table} WHERE tenant_id=?1`).bind(tenantId).run()
    }
    await db.prepare('DELETE FROM sales WHERE tenant_id=?1').bind(otherTenantId).run()
    await db.prepare('DELETE FROM tenants WHERE id IN (?1,?2)').bind(tenantId, otherTenantId).run()
  }
})
