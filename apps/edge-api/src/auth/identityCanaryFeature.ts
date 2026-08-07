import { hasD1Binding, isEdgeDatabaseEnabled } from '../databaseFeature'
import type { EdgeIdentityBindings } from '../types'

export function isIdentityCanaryEnabled(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === 'true'
}

export type IdentityCanaryConfiguration = Readonly<{
  ready: boolean
  missing: readonly string[]
}>

type IdentityCanaryEnvironment = EdgeIdentityBindings & Readonly<{
  EDGE_DATABASE_ENABLED?: string
  DB?: D1Database
}>

export function getIdentityCanaryConfiguration(
  env: IdentityCanaryEnvironment,
): IdentityCanaryConfiguration {
  const missing: string[] = []

  if (!isEdgeDatabaseEnabled(env.EDGE_DATABASE_ENABLED)) {
    missing.push('EDGE_DATABASE_ENABLED')
  }
  if (!hasD1Binding(env.DB)) {
    missing.push('DB')
  }
  if (!String(env.SUPABASE_URL || '').trim()) {
    missing.push('SUPABASE_URL')
  }
  if (!String(env.SUPABASE_PUBLISHABLE_KEY || '').trim()) {
    missing.push('SUPABASE_PUBLISHABLE_KEY')
  }

  return {
    ready: missing.length === 0,
    missing,
  }
}
