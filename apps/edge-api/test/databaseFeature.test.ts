import { describe, expect, it } from 'vitest'

import {
  hasD1Binding,
  isEdgeDatabaseEnabled,
} from '../src/databaseFeature'

describe('Edge database feature gate', () => {
  it('permanece desligado quando a flag não é true', () => {
    expect(isEdgeDatabaseEnabled(undefined)).toBe(false)
    expect(isEdgeDatabaseEnabled('')).toBe(false)
    expect(isEdgeDatabaseEnabled('1')).toBe(false)
    expect(isEdgeDatabaseEnabled('yes')).toBe(false)
  })

  it('aceita somente true sem diferenciar caixa e espaços', () => {
    expect(isEdgeDatabaseEnabled('true')).toBe(true)
    expect(isEdgeDatabaseEnabled(' TRUE ')).toBe(true)
  })

  it('considera D1 configurado somente quando o binding existe', () => {
    expect(hasD1Binding(undefined)).toBe(false)
    expect(hasD1Binding({} as D1Database)).toBe(true)
  })
})
