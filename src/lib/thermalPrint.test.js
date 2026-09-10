import { describe, expect, it, vi } from 'vitest'

import { printThermalReceipt } from './thermalPrint'

function createPrintWindow({ images = [], closed = false } = {}) {
  return {
    closed,
    document: { images },
    addEventListener: vi.fn(),
    close: vi.fn(),
    focus: vi.fn(),
    print: vi.fn(),
    requestAnimationFrame: vi.fn((callback) => callback()),
  }
}

describe('printThermalReceipt', () => {
  it('prints synchronously when preview images are already ready', () => {
    const printWindow = createPrintWindow({ images: [{ complete: true }] })

    expect(printThermalReceipt(printWindow, { closeAfterPrint: false })).toBe(true)
    expect(printWindow.requestAnimationFrame).not.toHaveBeenCalled()
    expect(printWindow.focus).toHaveBeenCalledOnce()
    expect(printWindow.print).toHaveBeenCalledOnce()
  })

  it('does not try to print a closed preview', () => {
    const printWindow = createPrintWindow({ closed: true })

    expect(printThermalReceipt(printWindow)).toBe(false)
    expect(printWindow.print).not.toHaveBeenCalled()
  })
})
