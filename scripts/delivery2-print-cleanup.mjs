import { readFile, writeFile } from 'node:fs/promises'

const path = 'src/modules/petshop/pages/EquipePage.jsx'
let text = await readFile(path, 'utf8')

function replaceOnce(from, to, label) {
  const count = text.split(from).length - 1
  if (count !== 1) throw new Error(`${label}: expected once, found ${count}`)
  text = text.replace(from, to)
}

replaceOnce(
`  function printCommissionSummary() {
    const bodyRows = displayRows.map((row) => \`<tr>
      <td>\${escapeHtml(row.collaborator_name)}</td>
      <td>\${row.bath_count}</td>
      <td>\${row.machine_grooming_count}</td>
      <td>\${row.scissor_grooming_count}</td>
      <td>\${row.package_count}</td>
      <td>\${row.other_service_count}</td>
      <td class="money">\${escapeHtml(fmtCurrency(row.service_revenue))}</td>
      <td class="money">\${escapeHtml(fmtCurrency(row.total_commission))}</td>
    </tr>\`).join('')
    openPrintDocument('Resumo geral de comissoes', \`
      <h1>Resumo geral de comissoes</h1>
      <div class="meta">Periodo: \${escapeHtml(dateLabel(range.startDate))} a \${escapeHtml(dateLabel(range.endDate))}</div>
      <table><thead><tr><th>Esteticista</th><th>Banhos</th><th>Tosa maquina/total</th><th>Tosa tesoura</th><th>Pacote</th><th>Outros</th><th>Receita</th><th>Total a pagar</th></tr></thead>
      <tbody>\${bodyRows || '<tr><td colspan="8">Sem producao no periodo.</td></tr>'}</tbody>
      <tfoot><tr class="total"><td colspan="6">Totais do periodo</td><td class="money">\${escapeHtml(fmtCurrency(totals.serviceRevenue))}</td><td class="money">\${escapeHtml(fmtCurrency(totals.commission))}</td></tr></tfoot></table>
    \`)
  }`,
`  function printCommissionSummary() {
    const bodyRows = displayRows.map((row) => \`<tr>
      <td>\${escapeHtml(row.collaborator_name)}</td>
      <td>\${row.bath_count}</td>
      <td>\${row.machine_grooming_count}</td>
      <td>\${row.scissor_grooming_count}</td>
      <td>\${row.package_count}</td>
      <td>\${row.other_service_count}</td>
      <td class="money">\${escapeHtml(fmtCurrency(row.service_revenue))}</td>
      <td class="money">\${escapeHtml(fmtCurrency(row.total_commission))}</td>
    </tr>\`).join('')
    const bodyHtml = \`
      <div class="receipt-meta">Periodo: \${escapeHtml(dateLabel(range.startDate))} a \${escapeHtml(dateLabel(range.endDate))}</div>
      <div class="receipt-table-wrap"><table class="receipt-table"><thead><tr><th>Esteticista</th><th>Banhos</th><th>Tosa maquina/total</th><th>Tosa tesoura</th><th>Pacote</th><th>Outros</th><th>Receita</th><th>Total a pagar</th></tr></thead>
      <tbody>\${bodyRows || '<tr><td colspan="8">Sem producao no periodo.</td></tr>'}</tbody>
      <tfoot><tr><td colspan="6"><strong>Totais do periodo</strong></td><td class="money"><strong>\${escapeHtml(fmtCurrency(totals.serviceRevenue))}</strong></td><td class="money"><strong>\${escapeHtml(fmtCurrency(totals.commission))}</strong></td></tr></tfoot></table></div>
    \`
    openReceiptPreview({ storeSettings, title: 'RESUMO GERAL DE COMISSOES', bodyHtml, initialFormat: 'a4' })
  }`,
'commission summary print helper')

replaceOnce(
`  function printDeliverySummary() {
    const total = deliveryRows.reduce((sum, row) => sum + Number(row.delivery_value || 0), 0)
    const bodyRows = deliveryRows.map((row) => \`<tr>
      <td>\${escapeHtml(dateLabel(row.occurred_at))}</td>
      <td>\${escapeHtml(row.staff_name || 'Sem motoboy')}</td>
      <td>\${escapeHtml(row.client_name)}</td>
      <td>\${escapeHtml(row.pet_name || '-')}</td>
      <td>\${escapeHtml(row.source_label)}</td>
      <td class="money">\${escapeHtml(fmtCurrency(row.delivery_value))}</td>
    </tr>\`).join('')
    openPrintDocument('Resumo de entregas', \`
      <h1>Resumo de entregas e MotoDog</h1>
      <div class="meta">Periodo: \${escapeHtml(dateLabel(range.startDate))} a \${escapeHtml(dateLabel(range.endDate))}</div>
      <table><thead><tr><th>Data</th><th>Motoboy</th><th>Cliente</th><th>Pet</th><th>Origem</th><th>Valor integral</th></tr></thead>
      <tbody>\${bodyRows || '<tr><td colspan="6">Sem entregas concluidas no periodo.</td></tr>'}</tbody>
      <tfoot><tr class="total"><td colspan="5">Total das entregas</td><td class="money">\${escapeHtml(fmtCurrency(total))}</td></tr></tfoot></table>
    \`)
  }`,
`  function printDeliverySummary() {
    const total = deliveryRows.reduce((sum, row) => sum + Number(row.delivery_value || 0), 0)
    const bodyRows = deliveryRows.map((row) => \`<tr>
      <td>\${escapeHtml(dateLabel(row.occurred_at))}</td>
      <td>\${escapeHtml(row.staff_name || 'Sem motoboy')}</td>
      <td>\${escapeHtml(row.client_name)}</td>
      <td>\${escapeHtml(row.pet_name || '-')}</td>
      <td>\${escapeHtml(row.source_label)}</td>
      <td class="money">\${escapeHtml(fmtCurrency(row.delivery_value))}</td>
    </tr>\`).join('')
    const bodyHtml = \`
      <div class="receipt-meta">Periodo: \${escapeHtml(dateLabel(range.startDate))} a \${escapeHtml(dateLabel(range.endDate))}</div>
      <div class="receipt-table-wrap"><table class="receipt-table"><thead><tr><th>Data</th><th>Motoboy</th><th>Cliente</th><th>Pet</th><th>Origem</th><th>Valor integral</th></tr></thead>
      <tbody>\${bodyRows || '<tr><td colspan="6">Sem entregas concluidas no periodo.</td></tr>'}</tbody>
      <tfoot><tr><td colspan="5"><strong>Total das entregas</strong></td><td class="money"><strong>\${escapeHtml(fmtCurrency(total))}</strong></td></tr></tfoot></table></div>
    \`
    openReceiptPreview({ storeSettings, title: 'RESUMO DE ENTREGAS E MOTODOG', bodyHtml, initialFormat: 'a4' })
  }`,
'delivery summary print helper')

if (text.includes('openPrintDocument')) throw new Error('stale openPrintDocument reference remains')
await writeFile(path, text, 'utf8')
console.log('Delivery 2 print cleanup applied.')
