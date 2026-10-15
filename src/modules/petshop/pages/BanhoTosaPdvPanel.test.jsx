import React from 'react'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import BanhoTosaPdvPanel from './BanhoTosaPdvPanel'
import { listAppointmentsCommand } from '../lib/appointmentCommands'
import { APPOINTMENT_CHECKOUT_SESSION_KEY } from './appointmentCheckoutFlow'

const mocks = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn() }))
vi.mock('../../../context/AuthContext', () => ({ useAuthCtx: () => ({ activeTenantId: 'tenant', storeSettings: {} }) }))
vi.mock('../../../context/ModuleContext', () => ({ useModuleCtx: () => ({ activeModuleId: 'petshop' }) }))
vi.mock('../lib/appointmentCommands', () => ({ listAppointmentsCommand: vi.fn() }))
vi.mock('../../../lib/supabase', () => ({
  supabase: { from: mocks.from, rpc: mocks.rpc }, fmtCurrency: n => `R$ ${Number(n).toFixed(2)}`,
}))
afterEach(() => { cleanup(); sessionStorage.clear(); vi.restoreAllMocks(); vi.clearAllMocks() })

it('mostra os quatro concluidos, dois pagos e dois pendentes, e abre o pagamento enfileirado', async () => {
  vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(0)
  sessionStorage.setItem(APPOINTMENT_CHECKOUT_SESSION_KEY, JSON.stringify({ appointment_id: 'bebe', date: '2026-10-15' }))
  const rows = [['buddy', 'BUDDY', 70], ['chewie', 'CHEWIE', 75], ['belinha', 'BELINHA', 55], ['bebe', 'BEBÊ', 90]].map(([id, name, price]) => ({
    id, price, client_id: `owner-${id}`, status: 'concluido', service_group: 'banho_tosa',
    scheduled_at: '2026-10-15T12:00:00Z', pets: { pet_name: name, owner_name: `Tutor ${name}` },
    service_items: [{ name: 'Banho/tosa', unit_price: price }],
  }))
  vi.mocked(listAppointmentsCommand).mockResolvedValue(rows)
  const sales = [{ id: 's1', appointment_id: 'buddy', total_price: 70 }, { id: 's2', appointment_id: 'chewie', total_price: 75 }]
  mocks.from.mockImplementation(table => {
    expect(table).toBe('sales')
    const query = { select: () => query, eq: () => query, in: () => query, then: resolve => Promise.resolve({ data: sales }).then(resolve) }
    return query
  })
  mocks.rpc.mockResolvedValue({ data: { appointment: null }, error: null })
  const { container } = render(<BanhoTosaPdvPanel />)
  await waitFor(() => expect(container.querySelectorAll('[data-yuisync-appointment-checkout]')).toHaveLength(4))
  expect(listAppointmentsCommand).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 'tenant', filters: {
    start: new Date('2026-10-15T00:00:00').toISOString(), end: new Date('2026-10-15T23:59:59.999').toISOString(), status: 'concluido',
  } }))
  for (const id of ['buddy', 'chewie']) expect(within(container.querySelector(`[data-yuisync-appointment-checkout="${id}"]`)).getByText('Lancado no caixa')).toBeInTheDocument()
  for (const id of ['belinha', 'bebe']) expect(within(container.querySelector(`[data-yuisync-appointment-checkout="${id}"]`)).getByText('Aguardando pagamento')).toBeInTheDocument()
  expect(await screen.findByRole('button', { name: 'Confirmar pagamento' })).toBeInTheDocument()
  expect(mocks.rpc).toHaveBeenCalledTimes(2)
})
