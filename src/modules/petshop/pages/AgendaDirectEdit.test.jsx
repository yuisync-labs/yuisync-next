import React from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import AgendaPage from './AgendaPage'

const mocks = vi.hoisted(() => ({
  appointments: [], load: vi.fn(), update: vi.fn(),
  loadServices: vi.fn().mockResolvedValue([{ code: 'banho', name: 'Banho', group_type: 'banho_tosa', default_price: 50 }]),
  loadSubscriptions: vi.fn().mockResolvedValue([]),
}))
vi.mock('../../../shared/hooks/useAppointments', () => ({ useAppointments: () => ({
  appointments: mocks.appointments, loading: false, load: mocks.load, update: mocks.update,
  create: vi.fn(), updateStatus: vi.fn(), remove: vi.fn(), serviceLabel: () => 'Banho',
  statusBadge: status => ({ label: status === 'concluido' ? 'Concluído' : 'Agendado', cls: '' }),
}) }))
vi.mock('../../../shared/hooks/useClients', () => ({ useClients: () => ({ clients: [], load: mocks.load, search: vi.fn() }) }))
vi.mock('../hooks/usePetshopAdvanced', () => ({ usePetshopAdvanced: () => ({ loadPetshopServices: mocks.loadServices }) }))
vi.mock('../hooks/useCatalogPlans', () => ({ useCatalogPlans: () => ({ loadSubscriptions: mocks.loadSubscriptions }) }))
vi.mock('../../../context/ModuleContext', () => ({ useModuleCtx: () => ({ activeModuleId: 'petshop' }) }))
vi.mock('../../../context/AuthContext', () => ({ useAuthCtx: () => ({ storeSettings: {
  petshop_operational_staff: [{ key: 'a', name: 'Ana', active: true }, { key: 'b', name: 'Bia', active: true }],
} }) }))
afterEach(cleanup)
beforeEach(() => {
  vi.clearAllMocks()
  const day = new Date(); day.setHours(9, 0, 0, 0)
  mocks.appointments = [{ id: 'appt', scheduled_at: day.toISOString(), duration_min: 60,
    status: 'agendado', service_group: 'banho_tosa', service_type: 'banho', responsible_staff_key: null,
    service_items: [{ code: 'banho', name: 'Banho', unit_price: 50 }],
    pets: { id: 'pet', pet_name: 'Rex', owner_name: 'Maria', species: 'dog' } }]
})

it('opens editing directly and preserves filters and the empty responsible person', async () => {
  const { container } = render(<AgendaPage/>)
  await waitFor(() => expect(mocks.loadServices).toHaveBeenCalled())
  const search = screen.getByLabelText('Buscar pet ou tutor')
  fireEvent.change(search, { target: { value: 'Rex' } })
  fireEvent.click(container.querySelector('[data-yuisync-native-appointment-id="appt"] .yuisync-card-content'))
  expect(screen.getByRole('heading', { name: 'Editar Agendamento' })).toBeInTheDocument()
  expect(screen.getByLabelText('Responsavel pelo atendimento')).toHaveValue('')
  expect(document.querySelector('[data-qa="agenda-appointment-panel"]')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Fechar agendamento' }))
  expect(screen.queryByRole('heading', { name: 'Editar Agendamento' })).not.toBeInTheDocument()
  expect(search).toHaveValue('Rex')
  expect(mocks.update).not.toHaveBeenCalled()
})

it('opens a completed appointment from daily history directly in editing', async () => {
  mocks.appointments[0].status = 'concluido'
  render(<AgendaPage/>)
  fireEvent.click(await screen.findByRole('button', { name: /Rex.*Concluído/ }))
  expect(screen.getByRole('heading', { name: 'Editar Agendamento' })).toBeInTheDocument()
  expect(screen.getByLabelText('Status do agendamento')).toHaveValue('concluido')
  expect(document.querySelector('[data-qa="agenda-appointment-panel"]')).toBeNull()
})
