import { DateTime } from 'luxon'
import { describe, expect, it } from 'vitest'
import {
  petshopDateLabel,
  petshopDateTimeLabel,
  petshopMonthRange,
} from './petshopDateTime'

describe('petshopDateTime', () => {
  it('preserva datas civis dos filtros sem deslocar para o dia anterior', () => {
    expect(petshopDateLabel('2026-08-01')).toBe('01/08/2026')
    expect(petshopDateLabel('2026-08-31')).toBe('31/08/2026')
  })

  it('converte instantes UTC para o fuso operacional do petshop', () => {
    expect(petshopDateLabel('2026-09-01T01:30:00.000Z')).toBe('31/08/2026')
    expect(petshopDateTimeLabel('2026-09-01T01:30:00.000Z')).toBe('31/08/2026 22:30:00')
  })

  it('calcula o periodo mensal no fuso de Sao Paulo', () => {
    const now = DateTime.fromISO('2026-08-18T12:00:00', { zone: 'America/Sao_Paulo' })
    expect(petshopMonthRange(now)).toEqual({
      startDate: '2026-08-01',
      endDate: '2026-08-31',
    })
  })
})
