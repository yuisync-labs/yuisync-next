import type { CoordinationDurableObject } from './coordination/coordinationDurableObject'

export type EdgeVariables = {
  requestId: string
  startedAt: number
}

export type EdgeDatabaseBindings = {
  EDGE_DATABASE_ENABLED?: string
  DB?: D1Database
}

export type EdgeCoordinationBindings = {
  EDGE_COORDINATION_ENABLED?: string
  COORDINATOR?: DurableObjectNamespace<CoordinationDurableObject>
}

export type EdgeIdentityBindings = {
  EDGE_IDENTITY_CANARY_ENABLED?: string
  SUPABASE_URL?: string
  SUPABASE_PUBLISHABLE_KEY?: string
}

export type EdgeFoundationMigrationBindings = {
  EDGE_FOUNDATION_MIGRATION_ENABLED?: string
  FOUNDATION_MIGRATION_TOKEN?: string
}

export type EdgeAppEnvironment = {
  Bindings: EdgeEnv
    & EdgeDatabaseBindings
    & EdgeCoordinationBindings
    & EdgeIdentityBindings
    & EdgeFoundationMigrationBindings
  Variables: EdgeVariables
}
