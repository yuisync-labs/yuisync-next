import { describe, expect, it } from 'vitest'

import { isValidReadOnlyCanary } from '../src/databaseCanary'

describe('read-only database canary', () => {
  it('aceita somente a resposta constante em transação read-only', () => {
    expect(isValidReadOnlyCanary({
      transaction_read_only: 'on',
      canary_value: 1,
    })).toBe(true)
  })

  it('rejeita ausência, escrita habilitada ou valor canário incorreto', () => {
    expect(isValidReadOnlyCanary(undefined)).toBe(false)
    expect(isValidReadOnlyCanary({
      transaction_read_only: 'off',
      canary_value: 1,
    })).toBe(false)
    expect(isValidReadOnlyCanary({
      transaction_read_only: 'on',
      canary_value: 0,
    })).toBe(false)
  })
})
