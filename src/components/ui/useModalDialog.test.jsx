import { useState } from 'react'
import { createPortal } from 'react-dom'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { useModalDialog } from './useModalDialog'

function Dialog({ onClose }) {
  const ref = useModalDialog(onClose)
  return createPortal(<div ref={ref} role="dialog" tabIndex={-1}>
    <button onClick={onClose}>Fechar</button><input aria-label="Data"/><button>Salvar</button>
  </div>, document.body)
}
function Fixture() {
  const [open, setOpen] = useState(false)
  return <><button onClick={() => setOpen(true)}>Abrir</button>{open && <Dialog onClose={() => setOpen(false)}/>}</>
}
describe('modal keyboard isolation', () => {
  it('focuses, traps both directions, closes on Escape and restores the trigger', () => {
    const root = document.createElement('div')
    root.id = 'root'
    document.body.append(root)
    const view = render(<Fixture/>, { container: root })
    const trigger = screen.getByText('Abrir')
    trigger.focus()
    fireEvent.click(trigger)
    expect(document.activeElement).toBe(screen.getByText('Fechar'))
    expect(root.inert).toBe(true)
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(screen.getByText('Salvar'))
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(document.activeElement).toBe(screen.getByText('Fechar'))
    act(() => screen.getByLabelText('Data').focus())
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(root.inert).toBe(false)
    expect(document.activeElement).toBe(trigger)
    view.unmount()
    root.remove()
  })
})
