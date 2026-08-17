import type { AuthDatabaseBindings } from './auth/authDatabaseFeature'
import type { CoordinationDurableObject } from './coordination/coordinationDurableObject'
import type { AuthMigrationBindings } from './migration/authMigrationHttp'
import type { OperationalMigrationBindings } from './migration/operationalMigrationHttp'

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

export type EdgeFinalAuthBindings = {
  EDGE_AUTH_TRUSTED_ORIGINS?: string
}

export type EdgeWhatsappBindings = {
  WHATSAPP_VERIFY_TOKEN?: string
  WHATSAPP_APP_ID?: string
  WHATSAPP_APP_SECRET?: string
  WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID?: string
  WHATSAPP_EMBEDDED_SIGNUP_REDIRECT_URI?: string
  WHATSAPP_CREDENTIAL_ENCRYPTION_KEY?: string
  WHATSAPP_GRAPH_VERSION?: string
}

export type EdgeAppEnvironment = {
  Bindings: EdgeEnv
    & EdgeDatabaseBindings
    & EdgeCoordinationBindings
    & EdgeIdentityBindings
    & EdgeFoundationMigrationBindings
    & AuthDatabaseBindings
    & AuthMigrationBindings
    & OperationalMigrationBindings
    & EdgeFinalAuthBindings
    & EdgeWhatsappBindings
  Variables: EdgeVariables
}
