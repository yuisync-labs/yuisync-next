/**
 * A Print iD controla avanço e corte pelo próprio driver. O navegador só
 * prepara o recibo em 80mm e não deve forçar uma altura de página via CSS.
 */
export function printThermalReceipt(printWindow) {
  if (!printWindow || printWindow.closed) return false

  let printStarted = false
  let closeScheduled = false

  const closeAfterPrint = () => {
    if (closeScheduled) return
    closeScheduled = true
    setTimeout(() => {
      try {
        if (!printWindow.closed) printWindow.close()
      } catch {
        // A impressão já foi entregue ao navegador; falha ao fechar a aba não deve afetá-la.
      }
    }, 400)
  }

  const printWhenReady = () => {
    if (printStarted || printWindow.closed) return
    printStarted = true

    try {
      if (typeof printWindow.addEventListener === 'function') {
        printWindow.addEventListener('afterprint', closeAfterPrint, { once: true })
      } else {
        printWindow.onafterprint = closeAfterPrint
      }
      printWindow.focus()
      printWindow.print()
    } catch (error) {
      printStarted = false
      throw error
    }
  }

  const nextFrame = typeof printWindow.requestAnimationFrame === 'function'
    ? (callback) => printWindow.requestAnimationFrame(callback)
    : (callback) => setTimeout(callback, 0)

  nextFrame(() => {
    const images = [...printWindow.document.images]
    if (images.length === 0 || images.every((image) => image.complete)) {
      setTimeout(printWhenReady, 180)
      return
    }

    let readyTriggered = false
    let remaining = images.filter((image) => !image.complete).length
    const finish = () => {
      if (readyTriggered) return
      remaining -= 1
      if (remaining > 0) return
      readyTriggered = true
      printWhenReady()
    }

    images
      .filter((image) => !image.complete)
      .forEach((image) => {
        image.addEventListener('load', finish, { once: true })
        image.addEventListener('error', finish, { once: true })
      })

    // Se a logo travar na rede, ainda abre a impressão sem encerrar a janela antes da hora.
    setTimeout(() => {
      if (readyTriggered) return
      readyTriggered = true
      printWhenReady()
    }, 1200)
  })

  return true
}

import { escapeReceiptHtml as escapeHtml } from './receiptPrint'

export function receiptShell({ storeSettings, title, content }) {
  const logo = String(
    storeSettings?.receipt_logo_data_url
    || storeSettings?.store_logo_url
    || storeSettings?.logo_url
    || `${window.location.origin}/brand/quatro-patas-logo-mono.png`,
  )
  const header = `<img class="print-logo" src="${escapeHtml(logo)}" alt="Logo da empresa"/>`

  return `
    <html>
      <head>
        <meta charset="utf-8"/>
        <title>${escapeHtml(title)}</title>
        <style>
          @page { margin: 0; }
          * { box-sizing: border-box; }
          html, body { width: 80mm; margin: 0; padding: 0; color: #000; background: #fff; }
          body { font-family: Arial, Helvetica, sans-serif; padding: 3mm 2mm; }
          .receipt { width: 72mm; max-width: 72mm; margin: 0 auto; }
          .center { text-align: center; }
          .print-logo { display:block; width:auto; max-width:56mm; max-height:22mm; margin:0 auto 2.5mm; object-fit:contain; filter:grayscale(1) contrast(2); }
          .store { font-size: 15px; font-weight: 900; text-transform: uppercase; }
          .store-line { margin-top: 1px; font-size: 9px; line-height: 1.25; overflow-wrap: anywhere; }
          .title { margin: 3mm 0 2mm; border-top: 1px dashed #000; border-bottom: 1px dashed #000; padding: 1.6mm 0; font-size: 13.5px; font-weight: 900; }
          .details { border-top: 1px solid #000; border-bottom: 1px solid #000; padding: 1.5mm 0; }
          .line { display: grid; grid-template-columns: 18mm minmax(0, 1fr); gap: 1.5mm; padding: .8mm 0; font-size: 11px; line-height: 1.32; }
          .line strong { font-size: 10px; text-transform: uppercase; }
          .line span { min-width: 0; font-weight: 700; overflow-wrap: anywhere; }
          .appointment { padding: 1.8mm 0; border-bottom: 1px dashed #000; page-break-inside: avoid; }
          .appointment-title { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 2mm; font-size: 11px; font-weight: 900; }
          .appointment-line { margin-top: .8mm; font-size: 10px; line-height: 1.32; overflow-wrap: anywhere; }
          .footer { margin-top: 3mm; font-size: 8.5px; line-height: 1.3; }
          @media print { body { position: absolute; inset: 0 auto auto 0; } }
        </style>
      </head>
      <body>
        <main class="receipt">
          <div class="center">
            ${header}
            <div class="title">${escapeHtml(title)}</div>
          </div>
          ${content}
          <div class="footer center">Impresso em ${escapeHtml(new Date().toLocaleString('pt-BR'))}</div>
        </main>
      </body>
    </html>
  `
}

export function writeAndPrint(html) {
  const printWindow = window.open('', '_blank')
  if (!printWindow) return false
  printWindow.document.write(html)
  printWindow.document.close()

  let printed = false
  const printWhenReady = () => {
    if (printed) return
    printed = true
    printThermalReceipt(printWindow)
  }
  const images = [...printWindow.document.images]
  const pendingImages = images.filter((image) => !image.complete)
  if (pendingImages.length === 0) {
    window.setTimeout(printWhenReady, 80)
  } else {
    let remaining = pendingImages.length
    const settleImage = () => {
      remaining -= 1
      if (remaining <= 0) window.setTimeout(printWhenReady, 80)
    }
    pendingImages.forEach((image) => {
      image.addEventListener('load', settleImage, { once: true })
      image.addEventListener('error', settleImage, { once: true })
    })
    window.setTimeout(printWhenReady, 1500)
  }
  return true
}

