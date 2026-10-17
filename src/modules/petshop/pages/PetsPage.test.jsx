import React from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import PetsPage from './PetsPage'

const mocks = vi.hoisted(() => ({ remove: vi.fn(), load: vi.fn(), subscriptions: [], clientsError: null }))
vi.mock('../../../shared/hooks/useClients', () => ({
  useClients: () => ({
    clients: [
      { id: 'rex', tutor_group_id: 'tutor', owner_name: 'Maria', pet_name: 'Rex', species: 'dog' },
      { id: 'luna', tutor_group_id: 'tutor', owner_name: 'Maria', pet_name: 'Luna', species: 'dog' },
    ], loading: false, error: mocks.clientsError, load: mocks.load, remove: mocks.remove, speciesIcon: () => () => null,
  }),
}))
vi.mock('../../../shared/hooks/useAppointments', () => ({
  useAppointments: () => ({ appointments: [], load: mocks.load, serviceLabel: () => '', statusBadge: () => ({}) }),
}))
vi.mock('../hooks/usePetshopAdvanced', () => ({
  usePetshopAdvanced: () => ({
    loadPlans: async () => [], loadClientSubscriptions: async () => mocks.subscriptions,
  }),
}))
vi.mock('../../../context/ModuleContext', () => ({ useModuleCtx: () => ({ activeModuleId: 'petshop' }) }))
vi.mock('../../../context/AuthContext', () => ({ useAuthCtx: () => ({ profile: { role: 'user' } }) }))
afterEach(cleanup)
beforeEach(() => { vi.clearAllMocks(); mocks.subscriptions = []; mocks.clientsError = null })

it('mostra falha no carregamento de clientes para não sugerir que os cadastros sumiram', async () => {
  mocks.clientsError = 'Não foi possível carregar todos os cadastros. Atualize a lista.'
  render(<PetsPage/>)
  expect(screen.getByRole('alert')).toHaveTextContent('Não foi possível carregar todos os cadastros')
})

async function openRemoval() {
  render(<PetsPage/>)
  await waitFor(() => expect(mocks.load).toHaveBeenCalled())
  fireEvent.click(screen.getByRole('button', { name: /Rex.*Abrir/ }))
  fireEvent.click(screen.getByRole('button', { name: 'Remover pet' }))
  return screen.getByRole('dialog', { name: 'Remover Rex?' })
}
it('pede confirmação e permite cancelar sem remover', async () => {
  await openRemoval()
  expect(screen.getByRole('dialog', { name: 'Remover Rex?' })).toHaveTextContent('Remover Rex?')
  fireEvent.click(screen.getByRole('button', { name: 'Cancelar', exact: true }))
  expect(mocks.remove).not.toHaveBeenCalled()
  expect(screen.queryByRole('dialog', { name: 'Remover Rex?' })).not.toBeInTheDocument()
})
it('remove somente o pet escolhido e fecha os detalhes após sucesso', async () => {
  mocks.remove.mockResolvedValueOnce(undefined)
  const dialog = await openRemoval()
  fireEvent.click(dialog.querySelector('button:last-child'))
  await waitFor(() => expect(mocks.remove).toHaveBeenCalledWith('rex'))
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Remover Rex?' })).not.toBeInTheDocument())
  expect(screen.queryByRole('button', { name: 'Fechar detalhes' })).not.toBeInTheDocument()
})
it('mantém confirmação aberta com erro e permite tentar novamente', async () => {
  mocks.remove.mockRejectedValueOnce(new Error('Falha de conexão'))
  const dialog = await openRemoval()
  fireEvent.click(dialog.querySelector('button:last-child'))
  expect(await screen.findByRole('alert')).toHaveTextContent('Falha de conexão')
  expect(screen.getByRole('dialog', { name: 'Remover Rex?' })).toBeInTheDocument()
  expect(dialog.querySelector('button:last-child')).not.toBeDisabled()
})

it('avisa sobre pacote ativo sem cancelá-lo automaticamente', async () => {
  mocks.subscriptions = [{ client_id: 'rex', status: 'active', subscription_plans: { name: 'Mensal' } }]
  await openRemoval()
  expect(screen.getByRole('dialog', { name: 'Remover Rex?' })).toHaveTextContent('A remoção do cadastro não cancela o pacote')
})

it('bloqueia novas confirmações enquanto a remoção está pendente', async () => {
  let finish
  mocks.remove.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
  const dialog = await openRemoval()
  const confirm = dialog.querySelector('button:last-child')
  fireEvent.click(confirm)
  expect(confirm).toBeDisabled()
  fireEvent.click(confirm)
  expect(mocks.remove).toHaveBeenCalledTimes(1)
  finish()
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Remover Rex?' })).not.toBeInTheDocument())
})

it('abre os detalhes como dialogo com todas as acoes e fecha por Escape', async () => {
  render(<PetsPage/>)
  await waitFor(() => expect(mocks.load).toHaveBeenCalled())
  fireEvent.click(screen.getByRole('button', { name: /Rex.*Abrir/ }))
  const dialog = screen.getByRole('dialog', { name: 'Detalhes de Rex' })
  expect(dialog).toHaveTextContent('Maria')
  expect(screen.getByRole('button', { name: 'Fechar detalhes' })).toHaveFocus()
  expect(screen.getByRole('button', { name: 'Adicionar outro pet para Maria' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Remover pet' })).toBeInTheDocument()
  fireEvent.keyDown(dialog, { key: 'Escape' })
  expect(screen.queryByRole('dialog', { name: 'Detalhes de Rex' })).not.toBeInTheDocument()
})
