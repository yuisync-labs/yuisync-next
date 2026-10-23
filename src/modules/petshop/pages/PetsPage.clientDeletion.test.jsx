import React from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import PetsPage from './PetsPage'

const mocks = vi.hoisted(() => ({
  removeTutor: vi.fn(), remove: vi.fn(), load: vi.fn(),
  pets: [
    { id: 'pet-1', tutor_group_id: 'tutor-1', owner_name: 'Marina', pet_name: 'Lua', phone: '11999990000', species: 'dog' },
    { id: 'pet-2', tutor_group_id: 'tutor-1', owner_name: 'Marina', pet_name: 'Sol', phone: '11999990000', species: 'dog' },
  ],
}))
vi.mock('../../../shared/hooks/useClients', () => ({ useClients: () => ({ clients: mocks.pets, load: mocks.load, removeTutor: mocks.removeTutor, remove: mocks.remove, speciesIcon: () => () => null }) }))
vi.mock('../../../shared/hooks/useAppointments', () => ({ useAppointments: () => ({ appointments: [], serviceLabel: x => x, statusBadge: () => ({}) }) }))
vi.mock('../hooks/usePetshopAdvanced', () => ({ usePetshopAdvanced: () => ({ loadPlans: async () => [], loadClientSubscriptions: async () => [], saveClientSubscription: vi.fn() }) }))
vi.mock('../../../context/ModuleContext', () => ({ useModuleCtx: () => ({ activeModuleId: 'petshop' }) }))
vi.mock('../../../context/AuthContext', () => ({ useAuthCtx: () => ({ activeTenantId: 'tenant' }) }))
vi.mock('../../../lib/supabase', () => ({ fmtCurrency: x => x, fmtDate: x => x }))
vi.mock('../../../lib/api', () => ({ importLegacyRows: vi.fn() }))
vi.mock('../../../shared/lib/legacyImport', () => ({ parseLegacyClients: vi.fn() }))

beforeEach(() => { vi.resetAllMocks(); mocks.load.mockResolvedValue(undefined) })
afterEach(cleanup)

async function openEditor() {
  render(<PetsPage />)
  fireEvent.click(await screen.findByRole('button', { name: 'Editar cliente', exact: true }))
}

it('confirma antes de excluir e permite cancelar mantendo os dados editados', async () => {
  await openEditor()
  const tutorInput = screen.getByDisplayValue('Marina')
  fireEvent.change(tutorInput, { target: { value: 'Marina alterada' } })
  fireEvent.click(screen.getByRole('button', { name: 'Excluir cliente', exact: true }))
  expect(screen.getByRole('dialog', { name: 'Excluir cliente Marina?' })).toHaveTextContent('todos os seus pets')
  expect(mocks.removeTutor).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Cancelar', exact: true }))
  expect(screen.queryByRole('dialog', { name: 'Excluir cliente Marina?' })).not.toBeInTheDocument()
  expect(screen.getByDisplayValue('Marina alterada')).toBeVisible()
  expect(mocks.removeTutor).not.toHaveBeenCalled()
})

it('aguarda o banco, bloqueia cliques repetidos e fecha o editor após sucesso', async () => {
  let finish
  mocks.removeTutor.mockImplementation(() => new Promise(resolve => { finish = resolve }))
  await openEditor()
  fireEvent.click(screen.getByRole('button', { name: 'Excluir cliente', exact: true }))
  fireEvent.click(screen.getByRole('button', { name: 'Confirmar exclusão' }))
  expect(mocks.removeTutor).toHaveBeenCalledExactlyOnceWith('pet-1')
  expect(screen.getByRole('button', { name: 'Excluindo...' })).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: 'Excluindo...' }))
  expect(mocks.removeTutor).toHaveBeenCalledTimes(1)
  await act(async () => finish())
  expect(screen.queryByText('Editar cliente e pet')).not.toBeInTheDocument()
  expect(mocks.remove).not.toHaveBeenCalled()
})

it('mostra falha do banco sem fechar a confirmação e permite tentar de novo', async () => {
  mocks.removeTutor.mockRejectedValueOnce(new Error('Falha ao excluir'))
  await openEditor()
  fireEvent.click(screen.getByRole('button', { name: 'Excluir cliente', exact: true }))
  fireEvent.click(screen.getByRole('button', { name: 'Confirmar exclusão' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Falha ao excluir')
  await waitFor(() => expect(screen.getByRole('button', { name: 'Confirmar exclusão' })).toBeEnabled())
  expect(screen.getByRole('dialog')).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: 'Confirmar exclusão' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(mocks.removeTutor).toHaveBeenCalledTimes(2)
})
