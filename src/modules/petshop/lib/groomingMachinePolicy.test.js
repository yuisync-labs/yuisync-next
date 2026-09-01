import { describe, expect, it } from 'vitest'

import { appointmentRequiresGroomingMachineNumber } from './groomingMachinePolicy'

describe('appointmentRequiresGroomingMachineNumber', () => {
  it.each([
    [{ service_type: 'tosa_maquina' }, true],
    [{ service_items: [{ name: 'Tosa na máquina 0 a 10 kg' }] }, true],
    [{ service_items: [{ name: 'Tosa máquina' }] }, true],
    [{ service_items: [{ name: 'Tosa total' }] }, false],
    [{ service_items: [{ name: 'Tosa completa' }] }, false],
    [{ service_items: [{ name: 'Tosa tesoura' }] }, false],
    [{ service_items: [{ name: 'Tosa com detalhe' }] }, false],
    [{ service_items: [{ name: 'Tosa com detalhes' }] }, false],
    [{ service_items: [{ name: 'Tosa higiênica com detalhes 0 a 10 kg' }] }, false],
    [{ service_items: [{ name: 'Tosa higiênica' }] }, false],
  ])('classifica o uso de maquina a partir do servico, sem depender do card', (appointment, expected) => {
    expect(appointmentRequiresGroomingMachineNumber(appointment)).toBe(expected)
  })
})
