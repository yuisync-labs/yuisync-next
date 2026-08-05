export type EdgeVariables = {
  requestId: string
  startedAt: number
}

export type EdgeAppEnvironment = {
  Bindings: EdgeEnv
  Variables: EdgeVariables
}
