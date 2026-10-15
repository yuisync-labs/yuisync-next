import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { useAppointments } from './useAppointments'
import { listAppointmentsCommand, updateAppointmentCommand } from '../../modules/petshop/lib/appointmentCommands'

vi.mock('../../context/AuthContext', () => ({ useAuthCtx: () => ({ activeTenantId: 'tenant' }) }))
vi.mock('../../context/ModuleContext', () => ({ useModuleCtx: () => ({ activeModuleId: 'petshop' }) }))
vi.mock('../../lib/supabase', () => ({ supabase: {}, todayISO: () => '2026-10-15', getTimezoneOffset: () => '-03:00' }))
vi.mock('../../modules/petshop/lib/appointmentCommands', () => ({
  listAppointmentsCommand: vi.fn(), updateAppointmentCommand: vi.fn(),
  createAppointmentCommand: vi.fn(), getAppointmentCommand: vi.fn(), removeAppointmentCommand: vi.fn(),
}))
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.clearAllMocks() })
const row = { id: 'bebe', status: 'agendado', scheduled_at: '2026-10-15T12:00:00Z', price: 90 }
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r }); return { promise, resolve } }

it('nao restaura card antigo depois de concluir e sincroniza as duas instancias da agenda', async () => {
  const initial = ['buddy', 'chewie', 'belinha'].map(id => ({ ...row, id, status: 'concluido' }))
  vi.mocked(listAppointmentsCommand).mockResolvedValue([...initial, row])
  vi.mocked(updateAppointmentCommand).mockResolvedValue({ ...row, status: 'concluido' })
  vi.spyOn(window, 'confirm').mockReturnValue(true)
  const { result } = renderHook(() => ({ agenda: useAppointments(), operations: useAppointments() }))
  await act(async () => {
    await result.current.agenda.load({ date: '2026-10-15' })
    await result.current.operations.load({ date: '2026-10-15' })
  })
  const oldRead = deferred()
  vi.mocked(listAppointmentsCommand).mockReturnValueOnce(oldRead.promise)
  let loading
  act(() => { loading = result.current.agenda.load({ date: '2026-10-15' }) })
  await act(async () => { await result.current.operations.updateStatus('bebe', 'concluido') })
  await act(async () => { oldRead.resolve([...initial, row]); await loading })
  expect(result.current.agenda.appointments.filter(a => a.status === 'concluido')).toHaveLength(4)
  expect(result.current.operations.appointments.filter(a => a.status === 'concluido')).toHaveLength(4)
  expect(result.current.agenda.loading).toBe(false)
})

it('ignora a resposta de uma data anterior quando a data seguinte ja carregou', async () => {
  const first = deferred(), second = deferred()
  vi.mocked(listAppointmentsCommand).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
  const { result } = renderHook(useAppointments)
  let a, b
  act(() => { a = result.current.load({ date: '2026-10-14' }); b = result.current.load({ date: '2026-10-15' }) })
  await act(async () => { second.resolve([row]); await b })
  await act(async () => { first.resolve([{ ...row, id: 'yesterday' }]); await a })
  expect(result.current.appointments.map(a => a.id)).toEqual(['bebe'])
})
