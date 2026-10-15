import React from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ClientHistoryGroomingEnhancer } from './ClientHistoryGroomingEnhancer'

const mocks = vi.hoisted(() => ({ save: vi.fn() }))
vi.mock('../../../context/AuthContext', () => ({ useAuthCtx: () => ({ activeTenantId: 'tenant' }) }))
vi.mock('../../../context/ModuleContext', () => ({ useModuleCtx: () => ({ activeModuleId: 'petshop' }) }))
vi.mock('../../../lib/supabase', () => ({ supabase: { from: () => {
  let writing = false
  const q = { select: () => q, eq: () => q, update: () => { writing = true; return q },
    then: resolve => (writing ? mocks.save() : Promise.resolve({ data: [], error: null })).then(resolve) }
  return q
} } }))
afterEach(() => { cleanup(); document.querySelector('[data-test-machine-card]')?.remove(); vi.clearAllMocks() })

it('continua a conclusao no card atual quando o anterior foi substituido durante o salvamento da maquina', async () => {
  let resolve
  mocks.save.mockImplementation(() => new Promise(r => { resolve = r }))
  const card = document.createElement('div')
  card.dataset.testMachineCard = 'true'
  card.dataset.yuisyncAppointmentId = 'bebe'
  card.dataset.yuisyncRequiresMachineNumber = 'true'
  card.innerHTML = '<button data-yuisync-action="complete">Concluir tosa BEBÊ</button>'
  document.body.append(card)
  render(<ClientHistoryGroomingEnhancer />)
  fireEvent.click(card.firstElementChild)
  fireEvent.click(await screen.findByRole('button', { name: '10', exact: true }))
  fireEvent.click(screen.getByRole('button', { name: 'Concluir atendimento' }))
  await waitFor(() => expect(mocks.save).toHaveBeenCalledOnce())
  const replacement = card.firstElementChild.cloneNode(true)
  card.replaceChildren(replacement)
  const completed = vi.fn()
  replacement.addEventListener('click', completed)
  await act(async () => resolve({ data: null, error: null }))
  expect(completed).toHaveBeenCalledOnce()
  expect(screen.queryByRole('heading', { name: 'Concluir tosa' })).not.toBeInTheDocument()
})
