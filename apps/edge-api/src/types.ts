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
  EDGE_COORDINATION_CANARY_TOKEN?: string
  COORDINATOR?: DurableObjectNamespace<CoordinationDurableObject>
}

export type EdgeAppEnvironment = {
  Bindings: EdgeEnv & EdgeDatabaseBindings & EdgeCoordinationBindings
  Variables: EdgeVariables
}
