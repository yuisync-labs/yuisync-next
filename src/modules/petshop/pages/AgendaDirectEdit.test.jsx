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
  mocks.loadServices.mockResolvedValue([{ code: 'banho', name: 'Banho', group_type: 'banho_tosa', default_price: 50 }])
  const day = new Date(); day.setHours(9, 0, 0, 0)
  mocks.appointments = [{ id: 'appt', scheduled_at: day.toISOString(), duration_min: 60,
    status: 'agendado', service_group: 'banho_tosa', service_type: 'banho', responsible_staff_key: null,
    service_items: [{ code: 'banho', name: 'Banho', unit_price: 50 }],
    pets: { id: 'pet', pet_name: 'Rex', owner_name: 'Maria', species: 'dog' } }]
})

it('usa as regras do catálogo ao trocar o banho de um agendamento existente', async () => {
  mocks.appointments[0].pets.weight_kg = 7
  mocks.loadServices.mockResolvedValue([
    { code: 'banho', name: 'Banho pequeno', group_type: 'banho_tosa', default_price: 55, min_weight_kg: 0, max_weight_kg: 10.099, species_target: 'dog' },
    { code: 'medio', name: 'Banho médio', group_type: 'banho_tosa', default_price: 65, min_weight_kg: 10.1, max_weight_kg: 22.1, species_target: 'dog' },
    { code: 'gato', name: 'Banho gato', group_type: 'banho_tosa', default_price: 65, min_weight_kg: null, max_weight_kg: null, species_target: 'cat' },
    { code: 'alternativo', name: 'Banho alternativo', group_type: 'banho_tosa', default_price: 60, min_weight_kg: 0, max_weight_kg: 10.099, species_target: 'dog' },
  ])
  mocks.update.mockResolvedValue({})
  const { container } = render(<AgendaPage/>)
  await waitFor(() => expect(mocks.loadServices).toHaveBeenCalled())
  fireEvent.click(container.querySelector('[data-yuisync-native-appointment-id="appt"] .yuisync-card-content'))
  expect(screen.getByText('Peso cadastrado: 7 kg')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Adicionar outro servico' }))
  expect(screen.getByRole('option', { name: /Banho médio/ })).toBeDisabled()
  expect(screen.getByText('Faixa de peso: 10,1 a 22,1 kg')).toBeInTheDocument()
  expect(screen.getByRole('option', { name: /Banho gato/ })).toBeDisabled()
  fireEvent.click(screen.getByRole('option', { name: /Banho alternativo/ }))
  fireEvent.click(screen.getByRole('button', { name: 'Remover Banho pequeno' }))
  fireEvent.click(screen.getByRole('button', { name: /Salvar/ }))
  await waitFor(() => expect(mocks.update).toHaveBeenCalledWith('appt', expect.objectContaining({ services: [{ code: 'alternativo' }] })))
  expect(screen.queryByRole('heading', { name: 'Editar Agendamento' })).not.toBeInTheDocument()
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
