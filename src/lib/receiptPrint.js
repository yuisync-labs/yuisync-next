import { printThermalReceipt } from './thermalPrint'

const FORMAT_CONFIG = {
  '58': { label: '58 mm', paperWidth: '58mm', contentWidth: '52mm', padding: '3mm' },
  '80': { label: '80 mm', paperWidth: '80mm', contentWidth: '72mm', padding: '4mm' },
  a4: { label: 'A4 / PDF', paperWidth: '210mm', contentWidth: '190mm', padding: '10mm' },
}

export function escapeReceiptHtml(value = '') {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

export function normalizeReceiptFormat(value, fallback = '80') {
  if (value === '58' || value === '80' || value === 'a4') return value
  if (fallback === '58' || fallback === '80' || fallback === 'a4') return fallback
  return '80'
}

export function isSafeReceiptImageSource(value) {
  const source = String(value || '').trim()
  if (!source) return false
  if (/^data:image\/(?:png|jpeg|webp);base64,[a-z0-9+/=\s]+$/i.test(source)) return true
  if (/^https:\/\//i.test(source)) return true
  if (/^\/(?!\/)/.test(source)) return true
  return false
}

export function resolveReceiptIdentity(settings = {}, tenantName = '') {
  const logoCandidate = settings.logo_url || settings.receipt_logo_data_url || settings.store_logo_url || ''
  const legacyAddress = [settings.store_address, settings.store_neighborhood, settings.store_city]
    .map((part) => String(part || '').trim())
    .filter(Boolean)
    .join(' - ')
  const format = settings.receipt_format || settings.printer_width

  return {
    name: String(settings.business_name || settings.store_name || tenantName || 'Estabelecimento').trim() || 'Estabelecimento',
    phone: String(settings.business_phone || settings.store_phone || '').trim(),
    address: String(settings.business_address || legacyAddress || '').trim(),
    email: String(settings.business_email || '').trim(),
    taxId: String(settings.business_tax_id || '').trim(),
    footer: String(settings.receipt_footer || '').trim(),
    logoUrl: isSafeReceiptImageSource(logoCandidate) ? String(logoCandidate).trim() : '',
    defaultFormat: normalizeReceiptFormat(format, '80'),
  }
}

function identityHeader(identity) {
  return `
    <header class="receipt-identity center">
      ${identity.logoUrl ? `<img class="receipt-logo" src="${escapeReceiptHtml(identity.logoUrl)}" alt="Logo da empresa"/>` : ''}
      <div class="receipt-store-name">${escapeReceiptHtml(identity.name)}</div>
      ${identity.address ? `<div class="receipt-store-line">${escapeReceiptHtml(identity.address)}</div>` : ''}
      ${identity.phone ? `<div class="receipt-store-line">${escapeReceiptHtml(identity.phone)}</div>` : ''}
      ${identity.email ? `<div class="receipt-store-line">${escapeReceiptHtml(identity.email)}</div>` : ''}
      ${identity.taxId ? `<div class="receipt-store-line">${escapeReceiptHtml(identity.taxId)}</div>` : ''}
    </header>
  `
}

export function buildReceiptDocument({ storeSettings = {}, tenantName = '', title, bodyHtml = '' }) {
  const identity = resolveReceiptIdentity(storeSettings, tenantName)
  return `<!doctype html>
<html lang="pt-BR" data-receipt-format="${identity.defaultFormat}">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>${escapeReceiptHtml(title || 'Comprovante operacional')}</title>
  <style id="yuisync-page-style"></style>
  <style>
    * { box-sizing: border-box; }
    :root { --paper-width: 80mm; --content-width: 72mm; --paper-padding: 4mm; }
    html[data-receipt-format="58"] { --paper-width: 58mm; --content-width: 52mm; --paper-padding: 3mm; }
    html[data-receipt-format="80"] { --paper-width: 80mm; --content-width: 72mm; --paper-padding: 4mm; }
    html[data-receipt-format="a4"] { --paper-width: 210mm; --content-width: 190mm; --paper-padding: 10mm; }
    html, body { margin: 0; min-height: 0; background: #f3f4f6; color: #111; font-family: Arial, Helvetica, sans-serif; }
    body { overflow-x: auto; }
    .preview-toolbar { position: sticky; top: 0; z-index: 10; display: flex; flex-wrap: wrap; gap: 8px; align-items: center; justify-content: center; padding: 10px; background: #111827; color: #fff; font-size: 13px; }
    .preview-toolbar button { border: 1px solid #4b5563; border-radius: 8px; background: #1f2937; color: #fff; padding: 7px 10px; font: inherit; font-weight: 700; cursor: pointer; }
    .preview-toolbar button[aria-pressed="true"] { background: #fff; color: #111827; }
    .preview-toolbar .print { background: #10b981; border-color: #10b981; color: #052e25; }
    .paper { width: var(--paper-width); max-width: none; min-height: 0; margin: 18px auto; padding: var(--paper-padding); background: #fff; box-shadow: 0 10px 30px rgba(0,0,0,.14); }
    .receipt { width: var(--content-width); max-width: 100%; min-width: 0; margin: 0 auto; overflow: visible; }
    .center { text-align: center; }
    .receipt-logo { display: block; width: auto; max-width: min(56mm, 85%); max-height: 22mm; margin: 0 auto 2.5mm; object-fit: contain; }
    .receipt-store-name { font-size: 14px; line-height: 1.2; font-weight: 900; overflow-wrap: anywhere; }
    .receipt-store-line { margin-top: 2px; font-size: 9px; line-height: 1.35; overflow-wrap: anywhere; }
    .receipt-title { margin: 3mm 0 2mm; border-top: 1px dashed #111; border-bottom: 1px dashed #111; padding: 1.8mm 0; font-size: 12px; line-height: 1.25; font-weight: 900; text-transform: uppercase; overflow-wrap: anywhere; }
    .receipt-operational-note { margin: 0 0 3mm; font-size: 8px; line-height: 1.3; color: #444; text-align: center; }
    .receipt-section, .details, .appointment { margin-top: 3mm; }
    .receipt-section-title, .appointment-title { margin-bottom: 1.2mm; font-size: 9px; font-weight: 900; text-transform: uppercase; letter-spacing: .03em; }
    .receipt-row, .line, .appointment-line { display: grid; grid-template-columns: minmax(18mm, 30%) minmax(0, 1fr); gap: 2mm; padding: .8mm 0; font-size: 10px; line-height: 1.35; border-bottom: 1px dotted #bbb; }
    .receipt-row > strong, .line > strong, .appointment-line > strong { font-size: 8.5px; text-transform: uppercase; }
    .receipt-row > span, .line > span, .appointment-line > span { min-width: 0; overflow-wrap: anywhere; }
    .receipt-rule { border-top: 1px dashed #111; margin: 2.5mm 0; }
    .receipt-table-wrap { width: 100%; overflow: visible; }
    .receipt-table, table { width: 100%; border-collapse: collapse; table-layout: fixed; font-size: 9px; }
    .receipt-table th, .receipt-table td, table th, table td { padding: 1.4mm .8mm; border-bottom: 1px dotted #aaa; text-align: left; vertical-align: top; overflow-wrap: anywhere; word-break: break-word; }
    .receipt-table th, table th { font-size: 7.5px; text-transform: uppercase; border-bottom: 1px solid #111; }
    .receipt-table .money, .money { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
    .receipt-table .qty { width: 9mm; text-align: center; }
    .receipt-total { display: flex; justify-content: space-between; gap: 4mm; padding-top: 1.5mm; font-size: 12px; font-weight: 900; }
    .receipt-meta { margin-bottom: 2.5mm; font-size: 9px; line-height: 1.4; color: #333; overflow-wrap: anywhere; }
    .receipt-footer { margin-top: 4mm; text-align: center; font-size: 8px; line-height: 1.35; color: #444; white-space: pre-line; overflow-wrap: anywhere; }
    html[data-receipt-format="58"] .receipt-row, html[data-receipt-format="58"] .line, html[data-receipt-format="58"] .appointment-line { grid-template-columns: 16mm minmax(0,1fr); gap: 1mm; font-size: 9px; }
    html[data-receipt-format="58"] .receipt-table, html[data-receipt-format="58"] table { font-size: 7.5px; }
    html[data-receipt-format="58"] .receipt-table th, html[data-receipt-format="58"] .receipt-table td, html[data-receipt-format="58"] table th, html[data-receipt-format="58"] table td { padding: 1.1mm .45mm; }
    html[data-receipt-format="58"] .receipt-table .money { white-space: normal; text-align: right; }
    html[data-receipt-format="58"] .receipt-store-name { font-size: 12px; }
    html[data-receipt-format="a4"] .receipt-store-name { font-size: 18px; }
    html[data-receipt-format="a4"] .receipt-store-line { font-size: 10px; }
    html[data-receipt-format="a4"] .receipt-title { font-size: 15px; }
    html[data-receipt-format="a4"] .receipt-table, html[data-receipt-format="a4"] table { font-size: 10px; }
    @media print {
      html, body { background: #fff !important; min-height: 0 !important; overflow: visible !important; }
      .preview-toolbar { display: none !important; }
      .paper { width: var(--paper-width); min-height: 0 !important; margin: 0 auto; padding: var(--paper-padding); box-shadow: none; break-after: avoid-page; }
      .receipt { min-height: 0 !important; overflow: visible !important; }
      .receipt-table tr, .receipt-section, .appointment { break-inside: avoid; page-break-inside: avoid; }
    }
  </style>
</head>
<body>
  <div class="preview-toolbar" aria-label="Formato do comprovante">
    <span>Prévia:</span>
    ${Object.entries(FORMAT_CONFIG).map(([format, config]) => `<button type="button" data-receipt-format-button="${format}">${config.label}</button>`).join('')}
    <button type="button" class="print" data-receipt-print>Imprimir / Salvar PDF</button>
  </div>
  <div class="paper">
    <main class="receipt">
      ${identityHeader(identity)}
      <div class="receipt-title center">${escapeReceiptHtml(title || 'Comprovante operacional')}</div>
      <div class="receipt-operational-note">Comprovante operacional — sem validade fiscal.</div>
      ${bodyHtml}
      ${identity.footer ? `<div class="receipt-footer">${escapeReceiptHtml(identity.footer)}</div>` : ''}
      <div class="receipt-footer">Gerado em ${escapeReceiptHtml(new Date().toLocaleString('pt-BR'))}</div>
    </main>
  </div>
</body>
</html>`
}

export function applyReceiptPreviewFormat(printWindow, format) {
  const normalized = normalizeReceiptFormat(format, '80')
  const config = FORMAT_CONFIG[normalized]
  const root = printWindow?.document?.documentElement
  if (!root) return normalized
  root.dataset.receiptFormat = normalized
  const style = printWindow.document.getElementById('yuisync-page-style')
  if (style) {
    style.textContent = normalized === 'a4'
      ? '@page { size: A4 portrait; margin: 0; }'
      : `@page { size: ${config.paperWidth} auto; margin: 0; }`
  }
  printWindow.document.querySelectorAll('[data-receipt-format-button]').forEach((button) => {
    button.setAttribute('aria-pressed', String(button.getAttribute('data-receipt-format-button') === normalized))
  })
  return normalized
}

export function openReceiptPreview({ storeSettings = {}, tenantName = '', title, bodyHtml = '', initialFormat } = {}) {
  const printWindow = window.open('', '_blank', 'width=1080,height=820')
  if (!printWindow) return false
  const identity = resolveReceiptIdentity(storeSettings, tenantName)
  printWindow.document.write(buildReceiptDocument({ storeSettings, tenantName, title, bodyHtml }))
  printWindow.document.close()

  const format = normalizeReceiptFormat(initialFormat || identity.defaultFormat, identity.defaultFormat)
  applyReceiptPreviewFormat(printWindow, format)
  printWindow.document.querySelectorAll('[data-receipt-format-button]').forEach((button) => {
    button.addEventListener('click', () => applyReceiptPreviewFormat(printWindow, button.getAttribute('data-receipt-format-button')))
  })
  printWindow.document.querySelector('[data-receipt-print]')?.addEventListener('click', () => {
    printThermalReceipt(printWindow, { closeAfterPrint: false })
  })
  printWindow.focus()
  return true
}
