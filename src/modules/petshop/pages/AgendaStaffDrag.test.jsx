import React from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import AgendaResolvedPage from './AgendaResolvedPage'

const mocks = vi.hoisted(() => ({ update: vi.fn(), load: vi.fn() }))
vi.mock('../../../context/AuthContext', () => ({ useAuthCtx: () => ({ storeSettings: {} }) }))
vi.mock('../../../shared/hooks/useAppointments', async () => {
  const date = new Date()
  date.setHours(9, 0, 0, 0)
  return {
    useAppointments: () => ({
      appointments: [{ id: 'one', scheduled_at: date.toISOString(), duration_min: 60,
        status: 'agendado', responsible_staff_key: 'ana', responsible_staff_name: 'Ana', pets: { pet_name: 'Rex' } }],
      update: mocks.update, load: mocks.load, serviceLabel: () => 'Banho',
      statusBadge: () => ({ label: 'Agendado' }),
    }),
  }
})
vi.mock('./AgendaPage', () => ({
  default: () => (
    <div className="page">
      <div data-yuisync-native-agenda-card="true" data-yuisync-native-appointment-id="one" className="relative">
        <button className="w-full text-left"><p>Rex</p></button>
      </div>
      <button aria-label="Agendar as 09:00 com Bia" data-responsible-staff-key="bia" data-responsible-staff-name="Bia"/>
    </div>
  ),
}))
afterEach(cleanup)

it('arrastar para outra esteticista no mesmo horário altera o responsável', async () => {
  mocks.update.mockResolvedValue(undefined)
  const { container } = render(<AgendaResolvedPage/>)
  const card = container.querySelector('[data-yuisync-native-agenda-card]')
  const slot = container.querySelector('[aria-label="Agendar as 09:00 com Bia"]')
  slot.getBoundingClientRect = () => ({ top: 100, bottom: 130, left: 300, right: 550, width: 250, height: 30 })
  await waitFor(() => expect(card).toHaveAttribute('data-yuisync-movable', 'true'))
  fireEvent(card, new MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 20, clientY: 20 }))
  fireEvent(document, new MouseEvent('pointermove', { bubbles: true, clientX: 400, clientY: 115 }))
  fireEvent(document, new MouseEvent('pointerup', { bubbles: true, clientX: 400, clientY: 115 }))
  await waitFor(() => expect(mocks.update).toHaveBeenCalledWith('one', expect.objectContaining({
    responsible_staff_key: 'bia', responsible_staff_name: 'Bia',
  })))
})
