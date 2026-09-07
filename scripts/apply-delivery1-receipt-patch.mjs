import fs from 'node:fs'

function read(path) { return fs.readFileSync(path, 'utf8') }
function write(path, value) { fs.writeFileSync(path, value) }
function replaceOnce(text, search, replacement, label) {
  const count = typeof search === 'string' ? text.split(search).length - 1 : [...text.matchAll(new RegExp(search.source, search.flags.includes('g') ? search.flags : `${search.flags}g`))].length
  if (count !== 1) throw new Error(`${label}: expected 1 match, got ${count}`)
  return text.replace(search, replacement)
}
function replaceCount(text, search, replacement, expected, label) {
  const count = text.split(search).length - 1
  if (count !== expected) throw new Error(`${label}: expected ${expected} matches, got ${count}`)
  return text.split(search).join(replacement)
}

// Agenda operacional resolvida
{
  const path = 'src/modules/petshop/pages/AgendaResolvedPage.jsx'
  let text = read(path)
  text = replaceOnce(text,
    "import { printThermalReceipt } from '../../../lib/thermalPrint'",
    "import { openReceiptPreview } from '../../../lib/receiptPrint'",
    'AgendaResolved import')
  text = replaceOnce(text,
    /function receiptShell\([\s\S]*?\nfunction findScrollableAncestor/,
    'function findScrollableAncestor',
    'AgendaResolved local receipt shell')
  text = replaceCount(text,
    'writeAndPrint(receiptShell({ storeSettings, title, content }))',
    'openReceiptPreview({ storeSettings, title, bodyHtml: content })',
    2,
    'AgendaResolved preview calls')
  write(path, text)
}

// Agenda modal de ficha
{
  const path = 'src/modules/petshop/pages/AgendaPage.jsx'
  let text = read(path)
  text = replaceOnce(text,
    "import { printThermalReceipt } from '../../../lib/thermalPrint'",
    "import { openReceiptPreview } from '../../../lib/receiptPrint'",
    'AgendaPage import')
  const start = text.indexOf('function ReceiptModal(')
  const end = text.indexOf('// ── Modal de Agendamento', start)
  if (start < 0 || end < 0) throw new Error('AgendaPage ReceiptModal block not found')
  let block = text.slice(start, end)
  block = replaceOnce(block,
    /  const handlePrint = \(\) => \{[\s\S]*?\n  \}\n\n  return createPortal\(/,
`  const handlePrint = () => {
    const row = (label, value) => \`<div class="receipt-row"><strong>\${escapeReceiptHtml(label)}</strong><span>\${escapeReceiptHtml(value || 'Nao informado')}</span></div>\`
    const bodyHtml = \`
      <section class="receipt-section">
        \${row('Tutor', pet.owner_name)}
        \${row('Pet', pet.pet_name)}
        \${row('Raca', pet.breed || pet.species)}
        \${row('Data e hora', \`\${date} - \${interval}\`)}
        \${row('Servico', serviceLabel(appt))}
        \${row('Resp.', responsible)}
        \${row('Obs.', appt.notes || 'Nenhuma observacao')}
      </section>
    \`
    openReceiptPreview({ storeSettings, title, bodyHtml })
  }

  return createPortal(`,
    'AgendaPage ReceiptModal print')
  block = block.replace('Ficha 80 mm', 'Ficha / comprovante')
  text = text.slice(0, start) + block + text.slice(end)
  write(path, text)
}

// Vendas: comprovante operacional usa snapshots persistidos.
{
  const path = 'src/modules/petshop/pages/VendasPage.jsx'
  let text = read(path)
  text = replaceOnce(text,
    "import { printThermalReceipt } from '../../../lib/thermalPrint'",
    "import { printThermalReceipt } from '../../../lib/thermalPrint'\nimport { escapeReceiptHtml, openReceiptPreview } from '../../../lib/receiptPrint'",
    'Vendas receipt import')
  text = replaceOnce(text,
    "    discount: Number(saleRow?.discount || 0),\n    total: Number(saleRow?.total_price || 0),",
    "    subtotal: Number(saleRow?.subtotal || 0),\n    discount: Number(saleRow?.discount || 0),\n    total: Number(saleRow?.total_price || 0),",
    'Vendas historical subtotal snapshot')
  text = replaceOnce(text,
    "        discount: Number(discount) || 0,\n        total: Number(createdSale?.total_price ?? total),",
    "        subtotal: Number(createdSale?.subtotal ?? 0),\n        discount: Number(createdSale?.discount ?? discount ?? 0),\n        total: Number(createdSale?.total_price ?? total),",
    'Vendas created snapshot')
  const start = text.indexOf('function SuccessModal(')
  const end = text.indexOf('  const handleOpenFiscalConsult = () => {', start)
  if (start < 0 || end < 0) throw new Error('Vendas SuccessModal print block not found')
  const prefix = text.slice(0, start)
  let block = text.slice(start, end)
  block = replaceOnce(block,
    /  const handlePrint = \(\) => \{[\s\S]*?\n  \}\n\n$/,
`  const handlePrint = () => {
    const itemRows = (sale.cart || []).map((item) => \`
      <tr>
        <td class="qty">\${escapeReceiptHtml(item.quantity)}</td>
        <td>\${escapeReceiptHtml(item.product?.name || item.name || 'Produto')}</td>
        <td class="money">\${escapeReceiptHtml(fmtCurrency(Number(item.unit_price || 0)))}</td>
      </tr>
    \`).join('')
    const bodyHtml = \`
      <div class="receipt-meta">Venda #\${escapeReceiptHtml(String(sale.id || '').slice(0, 8).toUpperCase())}</div>
      <div class="receipt-table-wrap"><table class="receipt-table"><thead><tr><th class="qty">Qtd</th><th>Item</th><th class="money">Unit.</th></tr></thead><tbody>\${itemRows || '<tr><td colspan="3">Sem itens.</td></tr>'}</tbody></table></div>
      <div class="receipt-section">
        <div class="receipt-row"><strong>Subtotal</strong><span class="money">\${escapeReceiptHtml(fmtCurrency(Number(sale.subtotal || 0)))}</span></div>
        \${Number(sale.discount || 0) > 0 ? \`<div class="receipt-row"><strong>Desconto</strong><span class="money">-\${escapeReceiptHtml(fmtCurrency(Number(sale.discount)))}</span></div>\` : ''}
        \${Number(sale.deliveryFee || 0) > 0 ? \`<div class="receipt-row"><strong>Entrega</strong><span class="money">\${escapeReceiptHtml(fmtCurrency(Number(sale.deliveryFee)))}</span></div>\` : ''}
        <div class="receipt-total"><span>Total</span><span>\${escapeReceiptHtml(fmtCurrency(Number(sale.total || 0)))}</span></div>
      </div>
      <div class="receipt-section">
        <div class="receipt-row"><strong>Pagamento</strong><span>\${escapeReceiptHtml(sale.payment || '-')}</span></div>
        <div class="receipt-row"><strong>Cliente</strong><span>\${escapeReceiptHtml(sale.customer || 'Balcao')}</span></div>
      </div>
    \`
    openReceiptPreview({ storeSettings, title: 'COMPROVANTE DE VENDA', bodyHtml })
  }

`,
    'Vendas operational receipt')
  text = prefix + block + text.slice(end)
  write(path, text)
}

// Ordens: identidade/layout comum, valores permanecem do snapshot da venda.
{
  const path = 'src/modules/petshop/pages/OrdensEntregaPage.jsx'
  let text = read(path)
  text = replaceOnce(text,
    "import { printThermalReceipt } from '../../../lib/thermalPrint'",
    "import { openReceiptPreview } from '../../../lib/receiptPrint'",
    'Ordens receipt import')
  text = replaceOnce(text,
    /function printOrderReceipt\(order, storeSettings = \{\}, fallbackItems = \[\]\) \{[\s\S]*?\n\}\n\nfunction OrderCard/,
`function printOrderReceipt(order, storeSettings = {}, fallbackItems = []) {
  const address = completeClientAddress(order) || orderOriginAddress(order)
  const directItems = orderItems(order)
  const items = directItems.length ? directItems : fallbackItems
  const publicNotes = visibleOrderNotes(order)
  const createdAt = order.created_at ? new Date(order.created_at).toLocaleString('pt-BR') : new Date().toLocaleString('pt-BR')
  const total = Number(order.sale?.total_price || 0)
  const subtotal = Number(order.sale?.subtotal || 0)
  const discount = Number(order.sale?.discount || 0)
  const orderLabel = String(order.id || '').slice(0, 8)
  const saleLabel = String(order.sale_id || '').slice(0, 8) || '-'
  const itemRows = items.length ? items.map((item) => item.raw ? \`
    <tr><td class="qty">1</td><td>\${escapeHtml(item.raw)}</td><td class="money">-</td><td class="money">-</td></tr>
  \` : \`
    <tr><td class="qty">\${escapeHtml(item.quantity)}</td><td>\${escapeHtml(item.name)}</td><td class="money">\${escapeHtml(fmtCurrency(item.unitPrice))}</td><td class="money">\${escapeHtml(fmtCurrency(item.subtotal))}</td></tr>
  \`).join('') : '<tr><td colspan="4">Sem itens vinculados nesta ordem.</td></tr>'
  const bodyHtml = \`
    <div class="receipt-meta">Data: \${escapeHtml(createdAt)} · Ordem #\${escapeHtml(orderLabel)} · Venda #\${escapeHtml(saleLabel)} · Status: \${escapeHtml(order.status || '-')}</div>
    <section class="receipt-section">
      <div class="receipt-section-title">Cliente</div>
      <div class="receipt-row"><strong>Nome</strong><span>\${escapeHtml(order.client?.owner_name || order.sale?.customer_name || 'Cliente')}</span></div>
      <div class="receipt-row"><strong>Telefone</strong><span>\${escapeHtml(order.contact_phone || order.client?.phone || '-')}</span></div>
      \${order.client?.owner_cpf ? \`<div class="receipt-row"><strong>CPF</strong><span>\${escapeHtml(order.client.owner_cpf)}</span></div>\` : ''}
      \${address ? \`<div class="receipt-row"><strong>Endereco</strong><span>\${escapeHtml(address)}</span></div>\` : ''}
    </section>
    <section class="receipt-section"><div class="receipt-section-title">Itens</div><div class="receipt-table-wrap"><table class="receipt-table"><thead><tr><th class="qty">Qtd</th><th>Descricao</th><th class="money">Unit.</th><th class="money">Total</th></tr></thead><tbody>\${itemRows}</tbody></table></div></section>
    <section class="receipt-section">
      \${subtotal > 0 ? \`<div class="receipt-row"><strong>Subtotal</strong><span class="money">\${escapeHtml(fmtCurrency(subtotal))}</span></div>\` : ''}
      \${discount > 0 ? \`<div class="receipt-row"><strong>Desconto</strong><span class="money">-\${escapeHtml(fmtCurrency(discount))}</span></div>\` : ''}
      <div class="receipt-total"><span>Total</span><span>\${escapeHtml(fmtCurrency(total))}</span></div>
      <div class="receipt-row"><strong>Pagamento</strong><span>\${escapeHtml(order.sale?.payment_method || '-')}</span></div>
      \${paymentStatus(order) !== 'nao_aplicavel' ? \`<div class="receipt-row"><strong>Status pgto.</strong><span>\${escapeHtml(paymentStatus(order))}</span></div>\` : ''}
      \${publicNotes ? \`<div class="receipt-row"><strong>Observacao</strong><span>\${escapeHtml(publicNotes)}</span></div>\` : ''}
    </section>
  \`
  openReceiptPreview({
    storeSettings,
    title: order.order_type === 'servico' ? 'ORDEM DE SERVICO' : 'CONFERENCIA / ORDEM DE ENTREGA',
    bodyHtml,
  })
}

function OrderCard`,
    'Ordens shared receipt')
  write(path, text)
}

// Comissoes: linha e totais continuam vindo dos snapshots de comissao.
{
  const path = 'src/modules/petshop/pages/EquipePage.jsx'
  let text = read(path)
  text = replaceOnce(text,
    "import { fmtCurrency } from '../../../lib/supabase'",
    "import { fmtCurrency } from '../../../lib/supabase'\nimport { openReceiptPreview } from '../../../lib/receiptPrint'",
    'Equipe receipt import')
  text = replaceOnce(text,
    /function openPrintDocument\([\s\S]*?\n\}\n\nfunction CommissionHistoryModal/,
    'function CommissionHistoryModal',
    'Equipe local print shell')
  const start = text.indexOf('function CommissionHistoryModal(')
  const end = text.indexOf('\n\n  return createPortal', start)
  if (start < 0 || end < 0) throw new Error('Equipe CommissionHistoryModal block not found')
  let block = text.slice(start, end)
  block = replaceOnce(block,
    "function CommissionHistoryModal({ row, items, range, onClose }) {",
    "function CommissionHistoryModal({ row, items, range, onClose }) {\n  const { storeSettings } = useAuthCtx()",
    'Equipe modal settings')
  block = replaceOnce(block,
    /  function printHistory\(\) \{[\s\S]*?\n  \}\n$/,
`  function printHistory() {
    const rows = lineRows.map(({ appointment, line }) => \`<tr>
      <td>\${escapeHtml(dateLabel(appointment.scheduled_at))}</td>
      <td>\${escapeHtml(appointment.client?.owner_name || '-')}</td>
      <td>\${escapeHtml(appointment.client?.pet_name || '-')}</td>
      <td>\${escapeHtml(line.label)}</td>
      <td class="money">\${escapeHtml(fmtCurrency(line.revenue))}</td>
      <td class="money">\${escapeHtml(fmtCurrency(line.commission))}</td>
    </tr>\`).join('')
    const bodyHtml = \`
      <div class="receipt-meta">Responsavel: \${escapeHtml(responsibleName)} · Periodo: \${escapeHtml(dateLabel(range.startDate))} a \${escapeHtml(dateLabel(range.endDate))}</div>
      <div class="receipt-table-wrap"><table class="receipt-table"><thead><tr><th>Data</th><th>Tutor</th><th>Pet</th><th>Servico</th><th class="money">Valor</th><th class="money">Comissao</th></tr></thead>
      <tbody>\${rows || '<tr><td colspan="6">Nenhum atendimento no periodo.</td></tr>'}</tbody>
      <tfoot><tr><td colspan="4"><strong>Totais</strong></td><td class="money"><strong>\${escapeHtml(fmtCurrency(revenue))}</strong></td><td class="money"><strong>\${escapeHtml(fmtCurrency(commission))}</strong></td></tr></tfoot></table></div>
    \`
    openReceiptPreview({ storeSettings, title: \`CONFERENCIA - \${responsibleName}\`, bodyHtml, initialFormat: 'a4' })
  }
`,
    'Equipe commission receipt')
  text = text.slice(0, start) + block + text.slice(end)
  write(path, text)
}

// Atualiza o teste antigo de Agenda para o contrato compartilhado.
write('test/agendaPrintCleanup.test.mjs', `import fs from 'node:fs'\nimport path from 'node:path'\nimport { describe, expect, it } from 'vitest'\n\nconst root = process.cwd()\nconst agendaResolved = fs.readFileSync(path.join(root, 'src/modules/petshop/pages/AgendaResolvedPage.jsx'), 'utf8')\nconst agendaPage = fs.readFileSync(path.join(root, 'src/modules/petshop/pages/AgendaPage.jsx'), 'utf8')\n\ndescribe('Agenda receipt migration', () => {\n  it('routes both active Agenda print surfaces through the shared receipt preview', () => {\n    expect(agendaResolved).toContain("from '../../../lib/receiptPrint'")\n    expect(agendaResolved).toContain('openReceiptPreview({ storeSettings, title, bodyHtml: content })')\n    expect(agendaPage).toContain("from '../../../lib/receiptPrint'")\n    expect(agendaPage).toContain('openReceiptPreview({ storeSettings, title, bodyHtml })')\n  })\n\n  it('removes the hard-coded 80mm shell, forced logo and print timeout', () => {\n    for (const source of [agendaResolved, agendaPage]) {\n      expect(source).not.toContain('function receiptShell')\n      expect(source).not.toContain('window.setTimeout(printWhenReady, 1500)')\n      expect(source).not.toContain('/brand/quatro-patas-logo-mono.png')\n    }\n  })\n\n  it('keeps the operational Agenda ficha free of financial recalculation', () => {\n    const receiptStart = agendaPage.indexOf('function ReceiptModal')\n    const receiptEnd = agendaPage.indexOf('// ── Modal de Agendamento', receiptStart)\n    const receiptSource = agendaPage.slice(receiptStart, receiptEnd)\n    expect(receiptSource).not.toContain('fmtCurrency')\n    expect(receiptSource).not.toContain('price')\n    expect(receiptSource).not.toContain('commission')\n  })\n})\n`)

write('test/tenantReceiptSettingsStatic.test.mjs', `import fs from 'node:fs'\nimport path from 'node:path'\nimport { describe, expect, it } from 'vitest'\n\nconst root = process.cwd()\nconst api = fs.readFileSync(path.join(root, 'apps/edge-api/src/appSettingsApi.ts'), 'utf8')\nconst compat = fs.readFileSync(path.join(root, 'apps/edge-api/src/compatApi.ts'), 'utf8')\nconst auth = fs.readFileSync(path.join(root, 'src/context/AuthContext.jsx'), 'utf8')\nconst sales = fs.readFileSync(path.join(root, 'src/modules/petshop/pages/VendasPage.jsx'), 'utf8')\nconst orders = fs.readFileSync(path.join(root, 'src/modules/petshop/pages/OrdensEntregaPage.jsx'), 'utf8')\nconst team = fs.readFileSync(path.join(root, 'src/modules/petshop/pages/EquipePage.jsx'), 'utf8')\n\ndescribe('tenant receipt settings contract', () => {\n  it('allows exactly the migrated company/receipt fields through the native patch', () => {\n    for (const field of ['business_name','business_address','business_phone','business_email','business_tax_id','logo_url','receipt_format','receipt_footer']) {\n      expect(api).toContain(\`'\${field}'\`)\n    }\n    expect(api).toContain("if (!canAdminModule(scope.membership, scope.moduleId)) return json({ code: 'FORBIDDEN' }, 403)")\n    expect(api).toContain("raw !== '58' && raw !== '80' && raw !== 'a4'")\n    expect(api).toContain('const extensions = parseExtensions(extensionRow)')\n  })\n\n  it('blocks legacy compat from writing migrated settings and clears branding on tenant change', () => {\n    expect(compat).toContain('NATIVE_COMPANY_SETTING_FIELDS')\n    expect(compat).toContain('body.payload = stripNativeCompanySettings(body.payload)')\n    expect(auth).toContain('setStoreSettings(neutralStoreSettings(tenantName))')\n    expect(auth).toContain('if (activeTenantIdRef.current !== requestedTenantId) return')\n  })\n\n  it('routes Vendas, Ordens and Comissoes to the shared receipt layer', () => {\n    expect(sales).toContain('openReceiptPreview({ storeSettings')\n    expect(sales).toContain('fmtCurrency(Number(sale.subtotal || 0))')\n    expect(sales).not.toContain('sale.total + (sale.discount || 0) - (sale.deliveryFee || 0)')\n    expect(orders).toContain('openReceiptPreview({')\n    expect(team).toContain("initialFormat: 'a4'")\n  })\n})\n`)

write('test/receiptPrintContract.test.mjs', `import { describe, expect, it } from 'vitest'\nimport { buildReceiptDocument, escapeReceiptHtml, normalizeReceiptFormat, resolveReceiptIdentity } from '../src/lib/receiptPrint.js'\n\ndescribe('shared receipt contract', () => {\n  it('supports 58, 80 and A4 formats', () => {\n    expect(normalizeReceiptFormat('58')).toBe('58')\n    expect(normalizeReceiptFormat('80')).toBe('80')\n    expect(normalizeReceiptFormat('a4')).toBe('a4')\n  })\n\n  it('escapes user-controlled identity and body values', () => {\n    expect(escapeReceiptHtml('<script>"x"&</script>')).toBe('&lt;script&gt;&quot;x&quot;&amp;&lt;/script&gt;')\n    const html = buildReceiptDocument({ storeSettings: { business_name: '<b>Loja</b>', receipt_footer: '<img>' }, title: '<Venda>', bodyHtml: '<div>safe caller markup</div>' })\n    expect(html).toContain('&lt;b&gt;Loja&lt;/b&gt;')\n    expect(html).toContain('&lt;img&gt;')\n    expect(html).toContain('&lt;Venda&gt;')\n  })\n\n  it('keeps tenant identities independent', () => {\n    const a = resolveReceiptIdentity({ business_name: 'Tenant A', logo_url: '/a.png', receipt_format: '58' })\n    const b = resolveReceiptIdentity({ business_name: 'Tenant B', logo_url: '/b.png', receipt_format: 'a4' })\n    expect(a).toMatchObject({ name: 'Tenant A', logoUrl: '/a.png', defaultFormat: '58' })\n    expect(b).toMatchObject({ name: 'Tenant B', logoUrl: '/b.png', defaultFormat: 'a4' })\n    expect(a.logoUrl).not.toBe(b.logoUrl)\n  })\n})\n`)

console.log('Delivery 1 receipt patches applied successfully.')
