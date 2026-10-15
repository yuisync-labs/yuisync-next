import React, { useState } from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { AgendaStaffControls } from './AgendaStaffControls'
import { persistPetshopTeamSettings } from '../lib/teamSettingsOperations'

const mocks = vi.hoisted(() => ({ auth: null }))
vi.mock('../../../context/AuthContext', () => ({ useAuthCtx: () => mocks.auth }))
vi.mock('../../../context/ModuleContext', () => ({ useModuleCtx: () => ({ activeModuleId: 'petshop' }) }))
vi.mock('../lib/teamSettingsOperations', () => ({
  persistPetshopTeamSettings: vi.fn(), OPERATIONAL_STAFF_TEMPLATE_KEY: '__petshop_operational_staff',
}))
afterEach(() => { cleanup(); vi.clearAllMocks() })

const staff = [
  { key: 'esteticista-1', name: 'Thaiane', active: true },
  { key: 'esteticista-2', name: 'Estefanea', active: true },
  { key: 'esteticista-3', name: 'Neto', active: true },
]
function Harness() {
  const [settings, setSettings] = useState({ petshop_operational_staff: staff, message_templates: { preserved: 'yes' } })
  mocks.auth = {
    storeSettings: settings, activeTenantId: 'tenant',
    updateStoreSettings: (patch) => setSettings((current) => ({ ...current, ...patch })),
  }
  return <AgendaStaffControls />
}

it('desativa e reativa Neto na agenda usando a mesma configuracao de equipe', async () => {
  vi.mocked(persistPetshopTeamSettings).mockImplementation(async ({ staff: nextStaff }) => ({ petshop_operational_staff: nextStaff }))
  render(<Harness />)
  fireEvent.click(screen.getByRole('checkbox', { name: 'Neto' }))
  await waitFor(() => expect(screen.getByRole('checkbox', { name: 'Neto' })).toBeEnabled())
  expect(screen.getByRole('checkbox', { name: 'Neto' })).not.toBeChecked()
  expect(persistPetshopTeamSettings).toHaveBeenLastCalledWith(expect.objectContaining({
    tenantId: 'tenant', moduleId: 'petshop',
    staff: [staff[0], staff[1], { ...staff[2], active: false }],
  }))
  fireEvent.click(screen.getByRole('checkbox', { name: 'Neto' }))
  await waitFor(() => expect(screen.getByRole('checkbox', { name: 'Neto' })).toBeEnabled())
  expect(screen.getByRole('checkbox', { name: 'Neto' })).toBeChecked()
})

it('restaura os marcadores e informa quando o salvamento falha', async () => {
  vi.mocked(persistPetshopTeamSettings).mockRejectedValue(new Error('Falha ao salvar'))
  render(<Harness />)
  fireEvent.click(screen.getByRole('checkbox', { name: 'Thaiane' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Falha ao salvar')
  expect(screen.getByRole('checkbox', { name: 'Thaiane' })).toBeChecked()
  expect(screen.getByRole('checkbox', { name: 'Neto' })).toBeEnabled()
})
