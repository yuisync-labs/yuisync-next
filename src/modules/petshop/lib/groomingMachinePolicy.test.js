import { describe, expect, it } from 'vitest'

import { appointmentRequiresGroomingMachineNumber } from './groomingMachinePolicy'

describe('appointmentRequiresGroomingMachineNumber', () => {
  it.each([
    [{ service_type: 'tosa_maquina' }, true],
    [{ service_items: [{ name: 'Tosa total' }] }, true],
    [{ service_items: [{ name: 'Tosa tesoura' }] }, false],
    [{ service_items: [{ name: 'Tosa com detalhe' }] }, false],
    [{ service_items: [{ name: 'Tosa higiênica' }] }, false],
  ])('classifica o uso de maquina a partir do servico, sem depender do card', (appointment, expected) => {
    expect(appointmentRequiresGroomingMachineNumber(appointment)).toBe(expected)
  })
})
