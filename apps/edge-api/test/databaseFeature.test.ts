import { describe, expect, it } from 'vitest'

import {
  hasHyperdriveBinding,
  isEdgeDatabaseEnabled,
} from '../src/databaseFeature'

describe('Edge database feature gate', () => {
  it('permanece desligado quando o binding não existe ou é inválido', () => {
    expect(isEdgeDatabaseEnabled(undefined)).toBe(false)
    expect(isEdgeDatabaseEnabled('')).toBe(false)
    expect(isEdgeDatabaseEnabled('1')).toBe(false)
    expect(isEdgeDatabaseEnabled('yes')).toBe(false)
  })

  it('aceita somente true sem diferenciar caixa e espaços', () => {
    expect(isEdgeDatabaseEnabled('true')).toBe(true)
    expect(isEdgeDatabaseEnabled(' TRUE ')).toBe(true)
  })

  it('considera Hyperdrive configurado somente com connection string', () => {
    expect(hasHyperdriveBinding(undefined)).toBe(false)
    expect(hasHyperdriveBinding({ connectionString: '' })).toBe(false)
    expect(hasHyperdriveBinding({ connectionString: '   ' })).toBe(false)
    expect(hasHyperdriveBinding({ connectionString: 'postgres://binding' })).toBe(true)
  })
})
