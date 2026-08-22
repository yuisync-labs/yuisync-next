import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

import { matchesSearchTerms, normalizeSearchText } from '../src/shared/lib/searchMatch.js'

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8')

test('SEARCH-01 encontra primeiro e último sobrenome separados por nomes intermediários', () => {
  assert.equal(matchesSearchTerms('marcos carvalho', ['Marcos Antonio Pereira de Carvalho']), true)
})

test('SEARCH-02 ignora acentos', () => {
  assert.equal(matchesSearchTerms('marcos carvalho', ['Márcos Antônio de Carválho']), true)
})

test('SEARCH-03 ignora caixa', () => {
  assert.equal(matchesSearchTerms('MARCOS CARVALHO', ['marcos antonio carvalho']), true)
})

test('SEARCH-04 ignora espaços duplicados', () => {
  assert.equal(normalizeSearchText('  Marcos    Carvalho  '), 'marcos carvalho')
  assert.equal(matchesSearchTerms('  Marcos    Carvalho  ', ['Marcos Antonio Carvalho']), true)
})

test('SEARCH-05 tutor e pet são pesquisáveis na mesma busca', () => {
  assert.equal(matchesSearchTerms('marcos thor', ['Marcos Carvalho', 'Thor']), true)
  assert.equal(matchesSearchTerms('thor', ['Marcos Carvalho', 'Thor']), true)
})

test('SEARCH-06 telefone é pesquisável', () => {
  assert.equal(matchesSearchTerms('985205279', ['Gabriel', 'Thor', '(32) 985205279']), true)
})

test('SEARCH-07 selecionar serviço fecha/perde foco do seletor', async () => {
  const source = await read('src/modules/petshop/pages/AgendaIntegratedPage.jsx')
  assert.match(source, /Buscar servico para adicionar/)
  assert.match(source, /\.blur\(\)/)
  assert.match(source, /new MouseEvent\('mousedown'/)
})

test('SEARCH-08 seletor permite adicionar outro serviço', async () => {
  const source = await read('src/modules/petshop/pages/AgendaIntegratedPage.jsx')
  assert.match(source, /Servicos encontrados/)
  assert.match(source, /Buscar servico para adicionar/)
  assert.match(source, /service_items|serviceItems/)
})

test('SEARCH-09 assinantes incluem tutor, pet, telefone e pacote/status', async () => {
  const page = await read('src/modules/petshop/pages/PlanosNativePage.jsx')
  const helper = await read('src/modules/petshop/lib/subscriptionUsageAdmin.js')
  assert.match(page, /Pesquisar assinantes/)
  assert.match(page, /subscriptionMatchesSearch/)
  assert.match(helper, /owner_name/)
  assert.match(helper, /pet_name/)
  assert.match(helper, /phone/)
  assert.match(helper, /subscription_plans/)
})
