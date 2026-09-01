import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

test('equipe atribui responsavel por comando nativo e nao pela compatibilidade de updates', async () => {
  const [page, core, command, edge, worker] = await Promise.all([
    readFile(new URL('../src/modules/petshop/pages/EquipePage.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/modules/petshop/hooks/usePetshopAdvancedCore.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/modules/petshop/lib/appointmentCommands.js', import.meta.url), 'utf8'),
    readFile(new URL('../apps/edge-api/src/appointmentResponsibleAssignmentApi.ts', import.meta.url), 'utf8'),
    readFile(new URL('../apps/edge-api/src/index.ts', import.meta.url), 'utf8'),
  ])
  assert.ok(page.includes('assignPendingServiceResponsible'))
  assert.ok(page.includes('Servicos esteticos concluidos sem responsavel'))
  assert.ok(page.includes('Selecionar responsavel'))
  assert.ok(core.includes('assignPendingServiceResponsible'))
  assert.ok(core.includes('assignAppointmentResponsibleCommand'))
  assert.ok(core.includes('listAppointmentsCommand'))
  assert.ok(core.includes("filters: { status: 'concluido', start, end }"))
  assert.ok(core.includes('client: { ...(appointment.pets || {}), id: appointment.client_id }'))
  assert.ok(core.includes('const pendingServices = normalizedAppointments.filter'))
  assert.ok(core.includes('const serviceHistory = normalizedAppointments.filter'))
  assert.ok(!core.includes(".update(updates)\n        .eq('id', appointmentId)"))
  assert.ok(command.includes('/responsible'))
  assert.ok(command.includes("method: 'PATCH'"))
  assert.ok(edge.includes("status='completed'"))
  assert.ok(edge.includes("responsible_staff_key IS NULL OR trim(responsible_staff_key)=''"))
  assert.ok(edge.includes('version=version+1'))
  assert.ok(worker.includes('handleAppointmentResponsibleAssignmentApi'))
})
