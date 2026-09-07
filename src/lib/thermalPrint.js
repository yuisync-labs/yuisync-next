/**
 * Aguarda todas as imagens do documento antes de abrir a caixa de impressão.
 * Cada imagem precisa terminar com `load` ou `error`; nao existe timeout que
 * force a impressao antes do documento estar estabilizado.
 */
export function waitForPrintImages(printWindow) {
  const images = [...(printWindow?.document?.images || [])]
  const pending = images.filter((image) => !image.complete)
  if (!pending.length) return Promise.resolve()

  return Promise.all(pending.map((image) => new Promise((resolve) => {
    const finish = () => resolve()
    image.addEventListener('load', finish, { once: true })
    image.addEventListener('error', finish, { once: true })
  }))).then(() => undefined)
}

export function printThermalReceipt(printWindow, options = {}) {
  if (!printWindow || printWindow.closed) return false
  const { closeAfterPrint = true } = options
  const nextFrame = printWindow.requestAnimationFrame || ((callback) => setTimeout(callback, 0))

  nextFrame(async () => {
    await waitForPrintImages(printWindow)
    if (printWindow.closed) return

    if (closeAfterPrint) {
      printWindow.addEventListener('afterprint', () => {
        if (!printWindow.closed) printWindow.close()
      }, { once: true })
    }

    printWindow.focus()
    printWindow.print()
  })
  return true
}
