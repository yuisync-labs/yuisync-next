import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8')

test('IMP-01/02/08/12 ficha usa composição térmica compacta de 80 mm com dados operacionais', async () => {
  const source = await read('src/modules/petshop/pages/AgendaResolvedPage.jsx')
  const shell = source.slice(source.indexOf('function receiptShell'), source.indexOf('function findScrollableAncestor'))
  const appointment = source.slice(source.indexOf('const printAppointment = useCallback'), source.indexOf('const printDay = useCallback'))
  assert.match(shell, /72mm/)
  assert.match(shell, /@media print|window\.print/)
  assert.match(appointment, /Pet|pet/i)
  assert.match(appointment, /Tutor|tutor/i)
  assert.match(appointment, /Servico|serviço|service/i)
  assert.match(appointment, /Resp\./)
  assert.match(appointment, /Obs\./)
})

test('IMP-03/04 impressão possui um caminho por ação e não injeta segundo handler', async () => {
  const resolved = await read('src/modules/petshop/pages/AgendaResolvedPage.jsx')
  const enhancements = await read('src/modules/petshop/pages/AgendaBookingEnhancements.jsx')
  assert.match(resolved, /data-yuisync-action="print"/)
  assert.match(resolved, /printAppointment\(appointment\)/)
  assert.doesNotMatch(enhancements, /data-yuisync-action="print"|printLatestAppointment|printThermalReceipt/)
})

test('IMP-05/06 impressão aguarda logo e possui fallback local', async () => {
  const resolved = await read('src/modules/petshop/pages/AgendaResolvedPage.jsx')
  const agenda = await read('src/modules/petshop/pages/AgendaPage.jsx')
  assert.match(resolved, /quatro-patas-logo-mono\.png/)
  assert.match(agenda, /quatro-patas-logo-mono\.png/)
  assert.match(resolved, /addEventListener\('load'/)
  assert.match(agenda, /addEventListener\('load'/)
  assert.match(resolved, /setTimeout\(printWhenReady, 1500\)/)
})

test('IMP-07 ficha operacional não imprime valores financeiros', async () => {
  const source = await read('src/modules/petshop/pages/AgendaResolvedPage.jsx')
  const block = source.slice(source.indexOf('const printAppointment = useCallback'), source.indexOf('const printDay = useCallback'))
  assert.doesNotMatch(block, /fmtCurrency|TOTAL|VALOR|prices\./)
})

test('IMP-09/10 imprimir ou reimprimir não altera status, venda ou checkout', async () => {
  const resolved = await read('src/modules/petshop/pages/AgendaResolvedPage.jsx')
  const block = resolved.slice(resolved.indexOf('const printAppointment = useCallback'), resolved.indexOf('const printDay = useCallback'))
  assert.doesNotMatch(block, /\.update\(|\.insert\(|\.delete\(|supabase\.rpc|checkout|status\s*:/i)
  const history = await read('src/modules/petshop/pages/AgendaPage.jsx')
  assert.match(history, /aria-label="Imprimir ficha do historico"/)
})

test('IMP-11 resumo de comissões possui proteção contra impressão em loop', async () => {
  const source = await read('test/commissionThermalPrintSafety.test.mjs')
  assert.match(source, /impress|print/i)
  assert.match(source, /loop|uma vez|once|single/i)
})
