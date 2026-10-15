import { expect, it, vi, afterEach } from 'vitest'
import { appointmentServiceEligibility, serviceFitsPetWeight } from './appointmentServices'
import { updateAppointmentCommand } from './appointmentCommands'

afterEach(() => vi.unstubAllGlobals())

it('prioriza gramas e usa o mesmo arredondamento do servidor nas fronteiras', () => {
  const service = { min_weight_grams: 10100, max_weight_grams: 22100, min_weight_kg: 0, max_weight_kg: 100 }
  expect(serviceFitsPetWeight(service, 7)).toBe(false)
  expect(serviceFitsPetWeight(service, 10.0996)).toBe(true)
  expect(serviceFitsPetWeight(service, 22.1004)).toBe(true)
  expect(serviceFitsPetWeight(service, 22.101)).toBe(false)
})

it('respeita restrições removidas e permite peso desconhecido como o servidor', () => {
  expect(appointmentServiceEligibility({ name: 'Banho porte grande', min_weight_kg: null, max_weight_kg: null, species_target: null }, { species: 'cat', weight_kg: 7 }).eligible).toBe(true)
  expect(serviceFitsPetWeight({ min_weight_kg: 10.1 }, null)).toBe(true)
  expect(serviceFitsPetWeight({ name: 'Banho porte grande' }, 7)).toBe(false)
})

it('traduz uma recusa de peso do servidor sem perder o código', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 409, json: async () => ({ code: 'SERVICE_WEIGHT_MISMATCH' }) }))
  await expect(updateAppointmentCommand({ tenantId: 'tenant', appointmentId: 'appt', payload: {} }))
    .rejects.toMatchObject({ code: 'SERVICE_WEIGHT_MISMATCH', message: expect.stringContaining('Confira o peso no cadastro') })
})
