import { describe, expect, it } from 'vitest'
import { getAuthDatabaseReadiness, requireAuthDatabase } from '../src/auth/authDatabaseFeature'

describe('AUTH_DB feature gate', () => {
  it('fica disabled por padrão', () => {
    expect(getAuthDatabaseReadiness({})).toBe('disabled')
  })

  it('não ativa sem DB e secret forte', () => {
    expect(getAuthDatabaseReadiness({ EDGE_BETTER_AUTH_ENABLED: 'true' })).toBe('not_configured')
    expect(getAuthDatabaseReadiness({ EDGE_BETTER_AUTH_ENABLED: 'true', AUTH_DB: {} as D1Database, BETTER_AUTH_SECRET: 'short' })).toBe('not_configured')
  })

  it('só configura com flag exata, AUTH_DB e secret', () => {
    const database = {} as D1Database
    const bindings = { EDGE_BETTER_AUTH_ENABLED: 'true', AUTH_DB: database, BETTER_AUTH_SECRET: 'x'.repeat(32) }
    expect(getAuthDatabaseReadiness(bindings)).toBe('configured')
    expect(requireAuthDatabase(bindings)).toBe(database)
  })

  it('require falha fechado quando incompleto', () => {
    expect(() => requireAuthDatabase({ EDGE_BETTER_AUTH_ENABLED: 'true' })).toThrow('Auth database is not configured.')
  })
})