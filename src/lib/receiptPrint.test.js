import { describe, expect, it } from 'vitest'

import { buildReceiptDocument, resolveReceiptIdentity } from './receiptPrint'

describe('receipt printing', () => {
  it('keeps 80 mm as the default persisted format', () => {
    expect(resolveReceiptIdentity({}, 'YuiSync').defaultFormat).toBe('80')
  })

  it('opens a clean print document without the preview HUD', () => {
    const document = buildReceiptDocument({
      tenantName: 'YuiSync',
      title: 'Ficha de agendamento',
      bodyHtml: '<div class="line"><strong>Pet</strong><span>Mago</span></div>',
    })

    expect(document).toContain('data-receipt-format="80"')
    expect(document).not.toContain('data-receipt-print')
    expect(document).not.toContain('Prévia:')
    expect(document).not.toContain('Imprimir / Salvar PDF')
  })
})
