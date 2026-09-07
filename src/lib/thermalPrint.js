/**
 * Aguarda todas as imagens do documento antes de abrir a caixa de impressão.
 * O fechamento da janela acontece somente depois do evento `afterprint`, nunca
 * por um timeout curto que possa interromper o diálogo do navegador.
 */
export function waitForPrintImages(printWindow, timeoutMs = 2500) {
  const images = [...(printWindow?.document?.images || [])]
  const pending = images.filter((image) => !image.complete)
  if (!pending.length) return Promise.resolve()

  const allSettled = Promise.all(pending.map((image) => new Promise((resolve) => {
    const finish = () => resolve()
    image.addEventListener('load', finish, { once: true })
    image.addEventListener('error', finish, { once: true })
  })))

  return Promise.race([
    allSettled,
    new Promise((resolve) => setTimeout(resolve, Math.max(250, timeoutMs))),
  ]).then(() => undefined)
}

export function printThermalReceipt(printWindow, options = {}) {
  if (!printWindow || printWindow.closed) return false
  const { closeAfterPrint = true, imageTimeoutMs = 2500 } = options
  const nextFrame = printWindow.requestAnimationFrame || ((callback) => setTimeout(callback, 0))

  nextFrame(async () => {
    await waitForPrintImages(printWindow, imageTimeoutMs)
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
