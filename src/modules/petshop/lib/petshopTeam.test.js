import { describe, expect, it } from 'vitest'
import { findService, normalizeService, normalizeServices } from './petshopTeam'

describe('petshop service canonical codes', () => {
  it('preserves an explicit catalog code instead of rewriting separators', () => {
    const service = normalizeService({
      id: 'svc-small',
      code: 'banho-pequeno-e2e-123',
      name: 'Banho Pequeno QA',
      group_type: 'banho_tosa',
    })

    expect(service.code).toBe('banho-pequeno-e2e-123')
  })

  it('still resolves normalized aliases without mutating the stored code', () => {
    const services = normalizeServices([{
      id: 'svc-small',
      code: 'banho-pequeno-e2e-123',
      name: 'Banho Pequeno QA',
      group_type: 'banho_tosa',
    }])

    expect(findService(services, 'banho-pequeno-e2e-123').code).toBe('banho-pequeno-e2e-123')
    expect(findService(services, 'banho_pequeno_e2e_123').code).toBe('banho-pequeno-e2e-123')
  })
})
