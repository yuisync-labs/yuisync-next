import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  buildCashDashboardSummary,
  isPackageCoveredAppointment,
  resolveCashPeriod,
} from '../src/modules/petshop/lib/cashRegisterSummary.js'
import { appointmentCommissionLines } from '../src/modules/petshop/lib/teamCommissionSummary.js'

test('banho coberto pelo pacote fica zerado no caixa e comissiona pelo catalogo', () => {
  const appointment = {
    id: 'package-bath',
    price: 0,
    service_group: 'banho_tosa',
    subscription_benefit_status: 'consumed',
    subscription_discount: 55,
    service_items: [{
      code: 'banho_0_10',
      name: 'Banho 0 a 10 kg',
      group_type: 'banho_tosa',
      unit_price: 0,
      catalog_price: 55,
      subscription_benefit_used: true,
    }],
    subscription_benefits: [{
      kind: 'service', service_code: 'banho_0_10', label: 'Banho 0 a 10 kg',
      catalog_price: 55, status: 'consumed',
    }],
  }

  assert.equal(isPackageCoveredAppointment(appointment), true)
  const [line] = appointmentCommissionLines(appointment)
  assert.equal(line.category, 'bath')
  assert.equal(line.revenue, 55)
  assert.equal(line.commission, 2.75)
})

test('pacote e cobrado uma vez e consumos aparecem como movimentos de zero reais', () => {
  const summary = buildCashDashboardSummary({
    sales: [{
      id: 'sale-package', subscription_id: 'subscription-1', source: 'assinatura',
      total_price: 200, payment_method: 'pix', created_at: '2026-07-31T12:00:00Z',
      customer_name: 'Tutora', notes: 'Pacote mensal',
    }],
    packageAppointments: [{
      id: 'bath-1', price: 0, updated_at: '2026-07-31T13:00:00Z',
      service_type: 'banho_0_10', service_group: 'banho_tosa',
      subscription_benefit_status: 'consumed', subscription_discount: 55,
      service_items: [{ name: 'Banho 0 a 10 kg', catalog_price: 55, unit_price: 0, subscription_benefit_used: true }],
      client: { owner_name: 'Tutora', pet_name: 'Pet' },
    }],
  })

  assert.equal(summary.totalSales, 200)
  assert.equal(summary.totalsByMethod.pix, 200)
  assert.equal(summary.sourceSummary.subscriptions.count, 1)
  assert.equal(summary.sourceSummary.packageConsumed.count, 1)
  assert.deepEqual(summary.movements.map((movement) => movement.amount).sort((a, b) => a - b), [0, 200])
})

test('caixa reaberto usa somente vendas posteriores a nova abertura', () => {
  const period = resolveCashPeriod({
    openedAt: '2026-07-31T15:00:00Z',
    dayStart: '2026-07-31T03:00:00Z',
    dayEnd: '2026-08-01T02:59:59Z',
  })
  assert.equal(period.start, '2026-07-31T15:00:00Z')
  assert.equal(period.mode, 'register')
})

test('movimento de agendamento mostra tutor e pet sem expor UUID operacional', () => {
  const appointmentId = '65aa1111-2222-4333-8444-555555555555'
  const summary = buildCashDashboardSummary({
    sales: [{
      id: 'sale-appointment',
      appointment_id: appointmentId,
      total_price: 75,
      payment_method: 'pix',
      created_at: '2026-08-31T15:00:00Z',
      notes: `Agendamento: ${appointmentId} | Banho e tosa`,
      client: { owner_name: 'Daiany', pet_name: 'Francisco' },
    }],
  })

  assert.equal(summary.movements[0].client_name, 'Daiany')
  assert.equal(summary.movements[0].pet_name, 'Francisco')
  assert.equal(summary.movements[0].description, 'Banho e tosa')
  assert.doesNotMatch(summary.movements[0].description, /65aa1111/)
})

test('tela do caixa usa grade fluida e operacoes financeiras integradas', async () => {
  const [page, operations] = await Promise.all([
    readFile(new URL('../src/modules/petshop/pages/CaixaPage.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/modules/petshop/lib/cashRegisterOperations.js', import.meta.url), 'utf8'),
  ])
  assert.match(page, /repeat\(auto-fit/)
  assert.match(page, /Movimentos do caixa/)
  assert.match(page, /Banhos de pacote/)
  assert.match(operations, /openedAt: current\?\.opened_at/)
  assert.match(operations, /isPackageCoveredAppointment/)
  assert.match(operations, /sale_payment_splits/)
})
