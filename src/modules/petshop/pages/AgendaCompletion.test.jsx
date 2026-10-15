import React from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import AgendaResolvedPage from './AgendaResolvedPage'
import { APPOINTMENT_CHECKOUT_SESSION_KEY } from './appointmentCheckoutFlow'

const mocks = vi.hoisted(() => ({ updateStatus: vi.fn(), load: vi.fn() }))
vi.mock('../../../context/AuthContext', () => ({ useAuthCtx: () => ({ storeSettings: {} }) }))
vi.mock('../../../shared/hooks/useAppointments', () => ({ useAppointments: () => ({
  appointments: [{ id: 'bebe', status: 'agendado', price: 90, service_group: 'banho_tosa',
    scheduled_at: new Date().toISOString(), duration_min: 60, pets: { pet_name: 'BEBÊ' } }],
  updateStatus: mocks.updateStatus, load: mocks.load, serviceLabel: () => 'Tosa', statusBadge: () => ({ label: 'Agendado' }),
}) }))
vi.mock('./AgendaPage', () => ({ default: () => <div className="page">
  <div data-yuisync-native-agenda-card="true" data-yuisync-native-appointment-id="bebe" className="relative">
    <button className="w-full text-left">BEBÊ</button>
  </div>
</div> }))
afterEach(() => { cleanup(); sessionStorage.clear(); vi.clearAllMocks() })

it('aguarda a conclusao, impede duplo clique e encaminha ao pagamento so depois do sucesso', async () => {
  let resolve
  mocks.updateStatus.mockImplementation(() => new Promise(r => { resolve = r }))
  const setPage = vi.fn()
  render(<AgendaResolvedPage setPage={setPage} />)
  fireEvent.click(await screen.findByRole('button', { name: 'Concluir agendamento' }))
  expect(screen.getByText('Concluindo atendimento…')).toBeInTheDocument()
  expect(setPage).not.toHaveBeenCalled()
  await waitFor(() => expect(screen.getByRole('button', { name: 'Concluir agendamento' })).toBeDisabled())
  expect(mocks.updateStatus).toHaveBeenCalledTimes(1)
  await act(async () => resolve({ id: 'bebe', status: 'concluido', price: 90, scheduled_at: new Date().toISOString() }))
  expect(setPage).toHaveBeenCalledWith('ordens')
  expect(JSON.parse(sessionStorage.getItem(APPOINTMENT_CHECKOUT_SESSION_KEY)).appointment_id).toBe('bebe')
})

it('mostra a falha e permite tentar de novo sem abrir pagamento indevido', async () => {
  mocks.updateStatus.mockRejectedValue(new Error('Falha ao salvar'))
  const setPage = vi.fn()
  render(<AgendaResolvedPage setPage={setPage} />)
  fireEvent.click(await screen.findByRole('button', { name: 'Concluir agendamento' }))
  expect(await screen.findByText('Falha ao salvar')).toBeInTheDocument()
  await waitFor(() => expect(screen.getByRole('button', { name: 'Concluir agendamento' })).toBeEnabled())
  expect(setPage).not.toHaveBeenCalled()
  expect(sessionStorage.getItem(APPOINTMENT_CHECKOUT_SESSION_KEY)).toBeNull()
})
