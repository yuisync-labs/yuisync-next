import test from 'node:test'
import assert from 'node:assert/strict'

import { appointmentCommissionLines } from '../src/modules/petshop/lib/teamCommissionSummary.js'

function lineFor(item, appointment = {}) {
  const [line] = appointmentCommissionLines({
    id: 'commission-acceptance',
    service_group: 'banho_tosa',
    service_items: [item],
    ...appointment,
  })
  return line
}

test('COM-04 qualquer tosa real usa 10% quando não há taxa personalizada', () => {
  const machine = lineFor({ name: 'Tosa na máquina', group_type: 'banho_tosa', unit_price: 100 })
  const scissor = lineFor({ name: 'Tosa na tesoura', group_type: 'banho_tosa', unit_price: 120 })
  assert.equal(machine.rate, 0.10)
  assert.equal(machine.commission, 10)
  assert.equal(scissor.rate, 0.10)
  assert.equal(scissor.commission, 12)
})

test('COM-05 serviço estético sem tosa usa padrão 5%', () => {
  const line = lineFor({ name: 'Hidratação de pelagem', group_type: 'banho_tosa', unit_price: 40 })
  assert.equal(line.category, 'other')
  assert.equal(line.rate, 0.05)
  assert.equal(line.commission, 2)
})

test('COM-06 taxa personalizada do snapshot tem prioridade', () => {
  const line = lineFor({ name: 'Tosa na máquina', group_type: 'banho_tosa', unit_price: 100, commission_rate: 7.5 })
  assert.equal(line.rate, 0.075)
  assert.equal(line.commission, 7.5)
})

test('COM-07 tosa higiênica aparece em Outros mas recebe 10%', () => {
  const line = lineFor({ name: 'Tosa higiênica', code: 'tosa_higienica', group_type: 'banho_tosa', unit_price: 30 })
  assert.equal(line.category, 'other')
  assert.equal(line.rate, 0.10)
  assert.equal(line.commission, 3)
})

test('COM-08 MotoDog/transporte não entra na comissão estética', () => {
  const lines = appointmentCommissionLines({
    id: 'motodog-only',
    service_group: 'banho_tosa',
    service_items: [{ name: 'MotoDog - buscar e levar', code: 'motodog', group_type: 'banho_tosa', unit_price: 20 }],
  })
  assert.deepEqual(lines, [])
})
