import { afterEach, describe, expect, it } from 'vitest'
import {
  appointmentPriceBreakdown,
  chooseAgendaSlot,
  findAgendaCardCandidate,
  moneyNumber,
  slotTimeFromAria,
} from './agendaOperationalCore'

const transportOptions = [
  { id: 'buscar_e_levar', fee: 20, active: true },
  { id: 'somente_buscar', fee: 15, active: true },
]

const originalWindow = globalThis.window
afterEach(() => {
  globalThis.window = originalWindow
})

describe('agenda operational core', () => {
  it('mantem R$ 55,00 de servico e soma R$ 20,00 do MotoDog', () => {
    const result = appointmentPriceBreakdown({
      price: 55,
      transport_mode: 'buscar_e_levar',
      service_items: [{ unit_price: 55 }],
    }, transportOptions)

    expect(result).toEqual({ service: 55, transport: 20, total: 75 })
  })

  it('nao soma transporte duas vezes quando o total ja esta reconciliado', () => {
    const result = appointmentPriceBreakdown({
      price: 75,
      transport_mode: 'buscar_e_levar',
      service_items: [{ unit_price: 55 }],
    }, transportOptions)

    expect(result).toEqual({ service: 55, transport: 20, total: 75 })
  })

  it('mantem apenas o valor da tosa quando o pacote cobre somente o MotoDog', () => {
    const result = appointmentPriceBreakdown({
      price: 130,
      transport_mode: 'buscar_e_levar',
      service_items: [{ name: 'Tosa tesoura', unit_price: 130, benefit_used: false }],
      subscription_benefits: [{ kind: 'transport', key: 'motodog', status: 'reserved' }],
    }, transportOptions)

    expect(result).toEqual({ service: 130, transport: 0, total: 130 })
  })

  it('separa o transporte de um total legado sem snapshots de servico', () => {
    const result = appointmentPriceBreakdown({
      price: 75,
      transport_mode: 'buscar_e_levar',
      service_items: [],
    }, transportOptions)

    expect(result).toEqual({ service: 55, transport: 20, total: 75 })
  })

  it('interpreta valores no formato brasileiro', () => {
    expect(moneyNumber('R$ 1.234,56')).toBe(1234.56)
  })

  it('seleciona a faixa de dez minutos mais proxima do ponteiro', () => {
    globalThis.window = { innerHeight: 800 }
    const slot0900 = {
      getBoundingClientRect: () => ({ left: 100, right: 700, top: 100, bottom: 124 }),
      getAttribute: () => 'Agendar as 09:00',
    }
    const slot0910 = {
      getBoundingClientRect: () => ({ left: 100, right: 700, top: 124, bottom: 148 }),
      getAttribute: () => 'Agendar as 09:10',
    }

    const selected = chooseAgendaSlot([slot0900, slot0910], 350, 138)
    expect(selected).toBe(slot0910)
    expect(slotTimeFromAria(selected)).toBe('09:10')
  })

  it('seleciona o centro mais proximo quando faixas visuais se sobrepoem', () => {
    globalThis.window = { innerHeight: 800 }
    const slot0830 = {
      getBoundingClientRect: () => ({ left: 100, right: 700, top: 100, bottom: 180 }),
      getAttribute: () => 'Agendar as 08:30',
    }
    const slot0850 = {
      getBoundingClientRect: () => ({ left: 100, right: 700, top: 140, bottom: 220 }),
      getAttribute: () => 'Agendar as 08:50',
    }

    const selected = chooseAgendaSlot([slot0830, slot0850], 350, 188)
    expect(selected).toBe(slot0850)
    expect(slotTimeFromAria(selected)).toBe('08:50')
  })

  it('distingue agendamento ativo e concluido com mesmo pet e horario', () => {
    const active = { textContent: '09:00 - 10:00 Agendado TOBY' }
    const finished = { textContent: '09:00 - 10:00 Concluido TOBY' }
    const used = new Set()

    const activeMatch = findAgendaCardCandidate([finished, active], {
      interval: '09:00 - 10:00',
      petName: 'TOBY',
      statusLabel: 'Agendado',
    }, used)
    used.add(activeMatch)

    const finishedMatch = findAgendaCardCandidate([finished, active], {
      interval: '09:00 - 10:00',
      petName: 'TOBY',
      statusLabel: 'Concluido',
    }, used)

    expect(activeMatch).toBe(active)
    expect(finishedMatch).toBe(finished)
  })
})
