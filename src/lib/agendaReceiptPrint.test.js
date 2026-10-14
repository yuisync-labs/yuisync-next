import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { printThermalReceipt, receiptShell, writeAndPrint } from './agendaReceiptPrint'

beforeEach(() => vi.useFakeTimers())
afterEach(() => { vi.restoreAllMocks(); vi.clearAllTimers(); vi.useRealTimers() })

const printWindow = (images = []) => {
  const target = new EventTarget()
  return { closed: false, document: { images, write: vi.fn(), close: vi.fn() },
    focus: vi.fn(), print: vi.fn(), close: vi.fn(),
    addEventListener: target.addEventListener.bind(target), dispatchEvent: target.dispatchEvent.bind(target),
    requestAnimationFrame: callback => callback() }
}

it('uses the legacy 80 mm layout, monochrome logo and configured logo precedence', () => {
  const doc = new DOMParser().parseFromString(receiptShell({
    storeSettings: { receipt_logo_data_url: '/preferred.png', logo_url: '/other.png' },
    title: 'AGENDA DO DIA <teste>', content: '<section>Conteúdo</section>',
  }), 'text/html')
  expect(doc.querySelector('img').getAttribute('src')).toBe('/preferred.png')
  expect(doc.querySelector('.title').textContent).toBe('AGENDA DO DIA <teste>')
  expect(doc.querySelector('.receipt section').textContent).toBe('Conteúdo')
  expect(doc.querySelector('style').textContent).toContain('width: 80mm')
  expect(doc.querySelector('style').textContent).toContain('width: 72mm')
  expect(doc.querySelector('style').textContent).toContain('grayscale(1) contrast(2)')
  expect(doc.querySelector('style').textContent).not.toMatch(/@page\s*\{[^}]*size:/)
})

it('uses the existing monochrome brand asset when no logo is configured', () => {
  const html = receiptShell({ title: 'FICHA DE AGENDAMENTO', content: '' })
  expect(html).toContain(`${window.location.origin}/brand/quatro-patas-logo-mono.png`)
})

it('waits for the logo, prints once and closes only after printing finishes', () => {
  const image = Object.assign(new EventTarget(), { complete: false })
  const popup = printWindow([image])
  expect(printThermalReceipt(popup)).toBe(true)
  expect(popup.print).not.toHaveBeenCalled()
  image.dispatchEvent(new Event('load'))
  expect(popup.print).toHaveBeenCalledOnce()
  expect(popup.close).not.toHaveBeenCalled()
  popup.dispatchEvent(new Event('afterprint'))
  vi.advanceTimersByTime(399)
  expect(popup.close).not.toHaveBeenCalled()
  vi.advanceTimersByTime(1)
  expect(popup.close).toHaveBeenCalledOnce()
  vi.advanceTimersByTime(1500)
  expect(popup.print).toHaveBeenCalledOnce()
})

it('still prints if the logo fails or never finishes downloading', () => {
  const image = Object.assign(new EventTarget(), { complete: false })
  const popup = printWindow([image])
  printThermalReceipt(popup)
  vi.advanceTimersByTime(1200)
  expect(popup.print).toHaveBeenCalledOnce()
  image.dispatchEvent(new Event('error'))
  expect(popup.print).toHaveBeenCalledOnce()
})

it('writes the legacy document to the popup and handles popup blocking', () => {
  const popup = printWindow()
  vi.spyOn(window, 'open').mockReturnValue(popup)
  expect(writeAndPrint('<html>Ficha</html>')).toBe(true)
  expect(popup.document.write).toHaveBeenCalledWith('<html>Ficha</html>')
  expect(popup.document.close).toHaveBeenCalledOnce()
  vi.advanceTimersByTime(260)
  expect(popup.print).toHaveBeenCalledOnce()
  window.open.mockReturnValue(null)
  expect(writeAndPrint('<html>Ficha</html>')).toBe(false)
})
