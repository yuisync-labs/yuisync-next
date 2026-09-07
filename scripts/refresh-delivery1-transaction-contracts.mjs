import fs from 'node:fs'

const path = 'test/transactionalStatic.test.mjs'
let text = fs.readFileSync(path, 'utf8')

function replaceNamedTest(startTitle, nextTitle, replacement) {
  const start = text.indexOf(`test('${startTitle}'`)
  const end = text.indexOf(`test('${nextTitle}'`, start)
  if (start < 0 || end < 0) {
    throw new Error(`Could not locate contract block: ${startTitle}`)
  }
  const block = text.slice(start, end)
  if (!block.trimEnd().endsWith('})')) {
    throw new Error(`Unexpected contract shape: ${startTitle}`)
  }
  text = text.slice(0, start) + replacement.trim() + '\n\n' + text.slice(end)
}

replaceNamedTest(
  'ordem impressa usa a largura nativa da Print iD sem forcar altura',
  'ordem PetBot persiste e exibe o ponto de referência da entrega',
  String.raw`
test('ordem impressa usa a camada compartilhada e preserva dados operacionais', async () => {
  const source = await read('src/modules/petshop/pages/OrdensEntregaPage.jsx')
  assert.match(source, /openReceiptPreview\(\{/)
  assert.match(source, /storeSettings,/)
  assert.match(source, /CONFERENCIA \/ ORDEM DE ENTREGA/)
  assert.match(source, /receipt-table/)
  assert.match(source, /completeClientAddress/)
  assert.match(source, /order\.delivery_reference/)
  assert.match(source, /client\.address/)
  assert.match(source, /client\.neighborhood/)
  assert.match(source, /const address = completeClientAddress\(order\) \|\| orderOriginAddress\(order\)/)
  assert.doesNotMatch(source, /quatro-patas-logo-mono\.png/)
  assert.doesNotMatch(source, /const width = '80mm'/)
})`,
)

replaceNamedTest(
  'todos os comprovantes usam a largura 80mm da Print iD',
  'importacao legado preserva historico e oculta registros arquivados',
  String.raw`
test('comprovantes operacionais usam a camada compartilhada com 58mm, 80mm e A4', async () => {
  const receipt = await read('src/lib/receiptPrint.js')
  const thermal = await read('src/lib/thermalPrint.js')
  const receiptFiles = [
    'src/modules/petshop/pages/AgendaPage.jsx',
    'src/modules/petshop/pages/AgendaResolvedPage.jsx',
    'src/modules/petshop/pages/VendasPage.jsx',
    'src/modules/petshop/pages/OrdensEntregaPage.jsx',
    'src/modules/petshop/pages/EquipePage.jsx',
  ]

  for (const file of receiptFiles) {
    const source = await read(file)
    assert.match(source, /openReceiptPreview/)
  }

  assert.match(receipt, /'58': \{ label: '58 mm'/)
  assert.match(receipt, /'80': \{ label: '80 mm'/)
  assert.match(receipt, /a4: \{ label: 'A4 \/ PDF'/)
  assert.match(receipt, /data-receipt-format/)
  assert.match(receipt, /@page \{ size: A4 portrait; margin: 0; \}/)
  assert.match(receipt, /Comprovante operacional/)
  assert.doesNotMatch(receipt, /quatro-patas-logo-mono\.png/)
  assert.match(thermal, /waitForPrintImages/)
  assert.doesNotMatch(thermal, /setTimeout\([^\n]*1500/)
})`,
)

fs.writeFileSync(path, text)
console.log('Delivery 1 transaction receipt contracts refreshed.')
