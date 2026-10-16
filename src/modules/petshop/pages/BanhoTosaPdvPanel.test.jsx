import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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
    const query = { select: () => query, eq: () => query, in: () => query, limit: () => query, then: resolve => Promise.resolve({ data: sales }).then(resolve) }
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

it('confirma pagamentos de 15/10 e 16/10, recarrega todos os pagos e não duplica confirmação', async () => {
  let selectedDay = '2026-10-15'
  const paid = new Map()
  const rows = day => ['a', 'b'].map(id => ({ id: `${day}-${id}`, price: 55, status: 'concluido', service_group: 'banho_tosa',
    scheduled_at: `${day}T12:00:00Z`, pets: { pet_name: `Pet ${id}`, owner_name: 'Tutor' }, service_items: [{ name: 'Banho', unit_price: 55 }] }))
  sessionStorage.setItem(APPOINTMENT_CHECKOUT_SESSION_KEY, JSON.stringify({ appointment_id: 'missing', date: selectedDay }))
  vi.mocked(listAppointmentsCommand).mockImplementation(async ({ filters }) => {
    selectedDay = new Date(filters.start).toLocaleDateString('en-CA')
    return rows(selectedDay)
  })
  mocks.from.mockImplementation(() => {
    const q = { select: () => q, eq: () => q, in: () => q, limit: vi.fn(() => q), then: resolve => Promise.resolve({ data: [...paid.values()] }).then(resolve) }
    return q
  })
  let finish
  mocks.rpc.mockImplementation(async (name, args) => {
    if (name !== 'checkout_petshop_appointment_transaction') return { data: {} }
    await new Promise(resolve => { finish = resolve })
    const id = args.p_payload.appointment_id
    paid.set(id, { id: `sale-${id}`, appointment_id: id, total_price: 55 })
    return { data: { sale_id: `sale-${id}` } }
  })
  const { container } = render(<BanhoTosaPdvPanel />)
  for (const day of ['2026-10-15', '2026-10-16']) {
    if (day.endsWith('16')) fireEvent.change(container.querySelector('input[type="date"]'), { target: { value: day } })
    await waitFor(() => expect(container.querySelector(`[data-yuisync-appointment-checkout="${day}-a"]`)).toBeInTheDocument())
    for (const id of ['a', 'b']) {
      const card = () => within(container.querySelector(`[data-yuisync-appointment-checkout="${day}-${id}"]`))
      fireEvent.click(card().getByRole('button', { name: /Conferir pagamento/ }))
      const confirm = card().getByRole('button', { name: 'Confirmar pagamento' })
      fireEvent.click(confirm); fireEvent.click(confirm)
      await waitFor(() => expect(confirm).toBeDisabled())
      finish()
      await waitFor(() => expect(card().getByText('Lancado no caixa')).toBeInTheDocument())
    }
  }
  expect(mocks.rpc.mock.calls.filter(([name]) => name === 'checkout_petshop_appointment_transaction')).toHaveLength(4)
})
