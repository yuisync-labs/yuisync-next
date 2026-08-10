export type AuthDatabaseBindings = {
  EDGE_BETTER_AUTH_ENABLED?: string
  AUTH_DB?: D1Database
  BETTER_AUTH_SECRET?: string
}

export type AuthDatabaseReadiness = 'disabled' | 'configured' | 'not_configured'

export function getAuthDatabaseReadiness(bindings: AuthDatabaseBindings): AuthDatabaseReadiness {
  if (bindings.EDGE_BETTER_AUTH_ENABLED !== 'true') return 'disabled'
  if (!bindings.AUTH_DB || typeof bindings.BETTER_AUTH_SECRET !== 'string' || bindings.BETTER_AUTH_SECRET.length < 32) {
    return 'not_configured'
  }
  return 'configured'
}

export function requireAuthDatabase(bindings: AuthDatabaseBindings): D1Database {
  if (getAuthDatabaseReadiness(bindings) !== 'configured' || !bindings.AUTH_DB) {
    throw new Error('Auth database is not configured.')
  }
  return bindings.AUTH_DB
}