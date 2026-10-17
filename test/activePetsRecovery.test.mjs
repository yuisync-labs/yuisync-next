import test from 'node:test'
import assert from 'node:assert/strict'
import { planActivePetsRecovery } from '../scripts/migration/legacy-supabase/activePetsRecovery.mjs'

const scope = { tenant_id: 'tenant-test', module_id: 'petshop' }
const nextClients = [{ id: 'client', name: 'JOELANE MAGALI', document: '12345678901', created_at_ms: 1, updated_at_ms: 2 }]
const source = (pets = [{ name: 'MARIA LUIZA', breed: 'SHIHTZU' }]) => ['client', '2026-07-20T17:00:00Z', 'MARIA LUIZA', 'dog', 'SHIHTZU', null, 5, 'Branca', null, pets, null]
const plan = overrides => planActivePetsRecovery({ scope, nextClients, sourceRows: [source()], now: 100, ...overrides })

test('recupera o pet no mesmo ID do cliente e preserva os dados do legado', () => {
  const result = plan()
  assert.equal(result.rows.length, 1)
  assert.equal(result.rows[0].id, 'client')
  assert.equal(result.rows[0].client_id, 'client')
  assert.equal(result.rows[0].name, 'MARIA LUIZA')
  assert.equal(result.rows[0].weight_kg, 5)
  assert.equal(result.rows[0].expected_client_updated_at_ms, 2)
})
test('recupera todos os pets distintos com IDs estáveis e sem copiar atributos do primeiro', () => {
  const sourceRows = [source([{ name: 'maria luiza' }, { name: 'Nina', breed: 'Gata' }, { name: ' NINA ', breed: 'Gata' }, { name: 'Outro' }])]
  const result = plan({ sourceRows })
  assert.deepEqual(result.rows.map(row => row.name), ['MARIA LUIZA', 'Nina', 'Outro'])
  assert.equal(result.rows[1].species, 'cat')
  assert.equal(result.rows[1].weight_kg, null)
  assert.equal(result.rows[2].species, 'other')
  assert.deepEqual(result.rows.map(row => row.id), plan({ sourceRows }).rows.map(row => row.id))
  assert.equal(new Set(result.rows.map(row => row.id)).size, 3)
})
test('preserva recadastro recente e pets inativos sem reativá-los', () => {
  const duplicate = plan({ existingOwners: [{ id: 'new-client', name: 'Joelane Magali', document: '12345678901', pet_id: 'new-pet', pet_name: 'Maria Luiza' }] })
  assert.equal(duplicate.rows.length, 0)
  assert.equal(duplicate.skipped[0].existing_pet_id, 'new-pet')
  const inactive = plan({ existingPets: [{ client_id: 'client', id: 'old', status: 'inactive' }] })
  assert.equal(inactive.rows.length, 0)
  assert.equal(plan({ existingOwners: [{ id: 'other', name: 'JOELANE MAGALI', pet_id: 'other-pet', pet_name: 'Maria Luiza', document: '22233344455' }] }).rows.length, 1)
})
test('separa campos inválidos e vínculo de tutor explícito em vez de truncar ou adivinhar', () => {
  const invalid = source(); invalid[2] = 'a'.repeat(161); invalid[9] = []
  assert.equal(plan({ sourceRows: [invalid] }).invalid.length, 1)
  const grouped = source(); grouped[10] = 'other-client'
  assert.equal(plan({ sourceRows: [grouped] }).rows.length, 0)
})
