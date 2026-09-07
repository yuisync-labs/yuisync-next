import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()
const agendaResolved = fs.readFileSync(path.join(root, 'src/modules/petshop/pages/AgendaResolvedPage.jsx'), 'utf8')
const agendaPage = fs.readFileSync(path.join(root, 'src/modules/petshop/pages/AgendaPage.jsx'), 'utf8')

describe('Agenda receipt migration', () => {
  it('routes both active Agenda print surfaces through the shared receipt preview', () => {
    expect(agendaResolved).toContain("from '../../../lib/receiptPrint'")
    expect(agendaResolved).toContain('openReceiptPreview({ storeSettings, title, bodyHtml: content })')
    expect(agendaPage).toContain("from '../../../lib/receiptPrint'")
    expect(agendaPage).toContain('openReceiptPreview({ storeSettings, title, bodyHtml })')
  })

  it('removes the hard-coded 80mm shell, forced logo and print timeout', () => {
    for (const source of [agendaResolved, agendaPage]) {
      expect(source).not.toContain('function receiptShell')
      expect(source).not.toContain('window.setTimeout(printWhenReady, 1500)')
      expect(source).not.toContain('/brand/quatro-patas-logo-mono.png')
    }
  })

  it('keeps the operational Agenda ficha free of financial recalculation', () => {
    const receiptStart = agendaPage.indexOf('function ReceiptModal')
    const receiptEnd = agendaPage.indexOf('// ── Modal de Agendamento', receiptStart)
    const receiptSource = agendaPage.slice(receiptStart, receiptEnd)
    expect(receiptSource).not.toContain('fmtCurrency')
    expect(receiptSource).not.toContain('price')
    expect(receiptSource).not.toContain('commission')
  })
})
