import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

test('sincronizacoes auxiliares de pet preservam o tutor canonico no D1', async () => {
  const [clientsHook, appointmentsHook] = await Promise.all([
    readFile(new URL('../src/shared/hooks/useClients.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/shared/hooks/useAppointments.js', import.meta.url), 'utf8'),
  ])

  assert.match(clientsHook, /client_id:\s*client\.tutor_group_id\s*\|\|\s*client\.id/)
  assert.match(appointmentsHook, /client_id:\s*client\.details\?\.tutor_group_id\s*\|\|\s*client\.id/)
})
