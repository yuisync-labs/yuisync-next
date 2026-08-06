import { describe, expect, it } from 'vitest'

import { isValidD1Canary } from '../src/databaseCanary'

describe('D1 database canary', () => {
  it('aceita somente o valor constante esperado', () => {
    expect(isValidD1Canary({ canary_value: 1 })).toBe(true)
    expect(isValidD1Canary({ canary_value: '1' })).toBe(true)
  })

  it('rejeita ausência ou valor canário incorreto', () => {
    expect(isValidD1Canary(undefined)).toBe(false)
    expect(isValidD1Canary({ canary_value: 0 })).toBe(false)
    expect(isValidD1Canary({ canary_value: null })).toBe(false)
  })
})
