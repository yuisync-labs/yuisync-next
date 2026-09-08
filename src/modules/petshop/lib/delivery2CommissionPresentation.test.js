import { describe, expect, it } from 'vitest'

import { commissionBaseSourceLabel } from './teamCommissionSummary'

describe('Delivery 2 commission presentation', () => {
  it('makes persisted and reconstructed bases visibly different', () => {
    expect(commissionBaseSourceLabel('appointment_snapshot')).toBe('Valor gravado no atendimento')
    expect(commissionBaseSourceLabel('package_appointment_snapshot')).toBe('Base de pacote gravada no atendimento')
    expect(commissionBaseSourceLabel('package_current_plan_allocation')).toBe('Base reconstruída pelo plano atual')
  })
})
