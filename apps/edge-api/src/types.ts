export type EdgeVariables = {
  requestId: string
  startedAt: number
}

export type EdgeDatabaseBindings = {
  EDGE_DATABASE_ENABLED?: string
  HYPERDRIVE?: {
    connectionString: string
  }
}

export type EdgeAppEnvironment = {
  Bindings: EdgeEnv & EdgeDatabaseBindings
  Variables: EdgeVariables
}
