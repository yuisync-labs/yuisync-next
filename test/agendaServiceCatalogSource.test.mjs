import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { findService, normalizeService } from '../src/modules/petshop/lib/petshopTeam.js'

const root = new URL('../', import.meta.url)
const read = (path) => readFile(new URL(path, root), 'utf8')

test('agenda carrega servicos independentes e aceita preco zero', async () => {
  const loader = await read('src/modules/petshop/hooks/usePetshopAdvanced.js')

  assert.doesNotMatch(loader, /\.not\('source_product_id', 'is', null\)/)
  assert.doesNotMatch(loader, /\.gt\('price', 0\)/)
  assert.match(loader, /const independentServices = serviceRows/)
  assert.match(loader, /filter\(\(service\) => !service\.source_product_id\)/)
  assert.match(loader, /normalizeServices\(\[\.\.\.independentServices, \.\.\.productServices\]\)/)
})

test('area configurada vence inferencia e metadados permanecem normalizados', async () => {
  const loader = await read('src/modules/petshop/hooks/usePetshopAdvanced.js')
  const team = await read('src/modules/petshop/lib/petshopTeam.js')
  const grouping = await read('src/modules/petshop/lib/appointmentServices.js')

  assert.match(loader, /VALID_SERVICE_GROUPS\.has\(explicitGroup\)/)
  assert.match(loader, /serviceGroup\(linked\.group_type, product\)/)
  assert.match(loader, /category: String\(product\.category/)
  assert.match(loader, /description: String\(product\.description/)
  assert.match(team, /return \{\r?\n    \.\.\.row,/)
  assert.match(grouping, /if \(VALID_APPOINTMENT_GROUPS\.has\(declared\)\) return declared/)
})

test('hook antigo fica preservado como nucleo sem duplicar implementacao', async () => {
  const loader = await read('src/modules/petshop/hooks/usePetshopAdvanced.js')
  const core = await read('src/modules/petshop/hooks/usePetshopAdvancedCore.js')

  assert.match(loader, /usePetshopAdvanced as usePetshopAdvancedCore/)
  assert.match(loader, /return \{[\s\S]*\.\.\.core,[\s\S]*loadPetshopServices/)
  assert.match(core, /export function usePetshopAdvanced\(\)/)
})

test('identidade persistida do servico nao e reescrita pelo frontend', () => {
  const persisted = normalizeService({
    code: 'agenda-e2e-hifen',
    name: 'Banho com codigo persistido',
  })

  assert.equal(persisted.code, 'agenda-e2e-hifen')
  assert.equal(findService([persisted], 'agenda-e2e-hifen').code, 'agenda-e2e-hifen')
  assert.equal(findService([persisted], 'agenda_e2e_hifen').code, 'agenda-e2e-hifen')
})
