import { describe, expect, it } from 'vitest'
import { buildReceiptDocument, escapeReceiptHtml, normalizeReceiptFormat, resolveReceiptIdentity } from '../src/lib/receiptPrint.js'

describe('shared receipt contract', () => {
  it('supports 58, 80 and A4 formats', () => {
    expect(normalizeReceiptFormat('58')).toBe('58')
    expect(normalizeReceiptFormat('80')).toBe('80')
    expect(normalizeReceiptFormat('a4')).toBe('a4')
  })

  it('escapes user-controlled identity and body values', () => {
    expect(escapeReceiptHtml('<script>"x"&</script>')).toBe('&lt;script&gt;&quot;x&quot;&amp;&lt;/script&gt;')
    const html = buildReceiptDocument({ storeSettings: { business_name: '<b>Loja</b>', receipt_footer: '<img>' }, title: '<Venda>', bodyHtml: '<div>safe caller markup</div>' })
    expect(html).toContain('&lt;b&gt;Loja&lt;/b&gt;')
    expect(html).toContain('&lt;img&gt;')
    expect(html).toContain('&lt;Venda&gt;')
  })

  it('keeps tenant identities independent', () => {
    const a = resolveReceiptIdentity({ business_name: 'Tenant A', logo_url: '/a.png', receipt_format: '58' })
    const b = resolveReceiptIdentity({ business_name: 'Tenant B', logo_url: '/b.png', receipt_format: 'a4' })
    expect(a).toMatchObject({ name: 'Tenant A', logoUrl: '/a.png', defaultFormat: '58' })
    expect(b).toMatchObject({ name: 'Tenant B', logoUrl: '/b.png', defaultFormat: 'a4' })
    expect(a.logoUrl).not.toBe(b.logoUrl)
  })

  it('renders the selected preview format without inventing a static tenant logo', () => {
    const html = buildReceiptDocument({
      storeSettings: { business_name: 'Tenant sem logo', receipt_format: 'a4' },
      title: 'Comprovante',
      bodyHtml: '<div>Conteudo operacional</div>',
    })
    expect(html).toContain('data-receipt-format="a4"')
    expect(html).toContain('58 mm')
    expect(html).toContain('80 mm')
    expect(html).toContain('A4 / PDF')
    expect(html).not.toContain('quatro-patas-logo-mono.png')
  })
})