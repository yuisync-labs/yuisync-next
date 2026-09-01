import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const root = new URL('../', import.meta.url)
const read = (path) => readFile(new URL(path, root), 'utf8')

test('historico vincula pets do tutor e reune agendamentos e compras', async () => {
  const source = await read('src/modules/petshop/components/ClientHistoryGroomingEnhancer.jsx')

  assert.match(source, /tutor_group_id/)
  assert.match(source, /groupPetsByTutor/)
  assert.match(source, /\.from\('appointments'\)/)
  assert.match(source, /\.from\('sales'\)/)
  assert.match(source, /saleByAppointment/)
  assert.match(source, /filter\(\(sale\) => !sale\.appointment_id\)/)
  assert.match(source, /Último valor finalizado/)
  assert.match(source, /deliveryLabelFromAppointment/)
  assert.match(source, /deliveryLabelFromSale/)
})

test('historico mostra numero da maquina junto da tosa', async () => {
  const source = await read('src/modules/petshop/components/ClientHistoryGroomingEnhancer.jsx')

  assert.match(source, /grooming_machine_no/)
  assert.match(source, /`\$\{baseLabel\} - Nº \$\{machine\}`/)
  assert.match(source, /GROOMING_MACHINE_OPTIONS = \[4, 7, 10\]/)
})

test('conclusao de tosa salva maquina antes de continuar fluxo original', async () => {
  const source = await read('src/modules/petshop/components/ClientHistoryGroomingEnhancer.jsx')

  assert.match(source, /data-yuisync-action="complete"/)
  assert.match(source, /stopImmediatePropagation/)
  assert.match(source, /grooming_machine_no: machineNo/)
  assert.match(source, /yuisyncMachineBypass/)
  assert.match(source, /action\.click\(\)/)
  assert.match(source, /Sem Nº/)
})

test('migration aceita somente maquinas operacionais ou nulo', async () => {
  const sql = await read('supabase/migrations/20260801123000_petshop_grooming_machine_history.sql')

  assert.match(sql, /add column if not exists grooming_machine_no integer/)
  assert.match(sql, /grooming_machine_no is null or grooming_machine_no in \(4, 7, 10\)/)
})

test('agenda e clientes carregam o aprimorador de historico', async () => {
  const source = await read('src/config/modules.jsx')

  assert.match(source, /AgendaWithClientHistory/)
  assert.match(source, /PetsWithClientHistory/)
  assert.match(source, /ClientHistoryGroomingEnhancer/)
  assert.match(source, /agenda: AgendaWithClientHistory/)
  assert.match(source, /pets: PetsWithClientHistory/)
})
