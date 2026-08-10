import { describe, expect, it } from 'vitest'

import { parseBearerToken } from '../src/auth/bearerToken'

describe('parseBearerToken', () => {
  it('classifica header ausente ou vazio como missing', () => {
    expect(parseBearerToken(undefined)).toEqual({ kind: 'missing' })
    expect(parseBearerToken(null)).toEqual({ kind: 'missing' })
    expect(parseBearerToken('   ')).toEqual({ kind: 'missing' })
  })

  it('aceita o esquema Bearer sem depender de casing', () => {
    expect(parseBearerToken('Bearer abc.def.ghi')).toEqual({
      kind: 'token',
      token: 'abc.def.ghi',
    })
    expect(parseBearerToken('bearer token-value')).toEqual({
      kind: 'token',
      token: 'token-value',
    })
  })

  it('rejeita esquemas e formatos ambíguos', () => {
    expect(parseBearerToken('Basic abc')).toEqual({ kind: 'malformed' })
    expect(parseBearerToken('Bearer')).toEqual({ kind: 'malformed' })
    expect(parseBearerToken('Bearer token extra')).toEqual({ kind: 'malformed' })
  })

  it('rejeita token excessivamente grande', () => {
    expect(parseBearerToken(`Bearer ${'x'.repeat(8_193)}`)).toEqual({
      kind: 'malformed',
    })
  })
})
