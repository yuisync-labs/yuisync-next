import { describe, expect, it } from 'vitest'

import {
  appointmentHistoryRows,
  appointmentPanelAction,
  appointmentPaymentPresentation,
} from './agendaPanelPresentation'

describe('agenda appointment panel presentation', () => {
  it('maps only operational forward actions', () => {
    expect(appointmentPanelAction('agendado')).toEqual({ status: 'confirmado', label: 'Confirmar' })
    expect(appointmentPanelAction('confirmado')).toEqual({ status: 'em_andamento', label: 'Iniciar' })
    expect(appointmentPanelAction('em_andamento')).toEqual({ status: 'concluido', label: 'Concluir' })
    expect(appointmentPanelAction('concluido')).toBeNull()
  })

  it('orders client history newest first, marks the current row and applies a hard limit', () => {
    const rows = appointmentHistoryRows([
      { id: 'old', scheduled_at: '2026-09-01T12:00:00.000Z' },
      { id: 'current', scheduled_at: '2026-09-03T12:00:00.000Z' },
      { id: 'new', scheduled_at: '2026-09-04T12:00:00.000Z' },
    ], 'current', 2)

    expect(rows.map((row) => row.id)).toEqual(['new', 'current'])
    expect(rows[1].current).toBe(true)
  })

  it('distinguishes package coverage from pending payment without changing financial values', () => {
    expect(appointmentPaymentPresentation({
      appointment: { status: 'concluido' },
      usesPackage: true,
      total: 0,
    })).toMatchObject({ label: 'Coberto pelo pacote', tone: 'success' })

    expect(appointmentPaymentPresentation({
      appointment: { status: 'concluido' },
      needsPayment: true,
      total: 125.5,
    })).toMatchObject({ label: 'Recebimento pendente', tone: 'warning', detail: 'Valor operacional: 125.5' })
  })
})
