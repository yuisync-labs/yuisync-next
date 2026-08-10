export type DatabaseCanaryRequest = Readonly<{
  requestId: string
  timeoutMs: number
}>

export type DatabaseCanaryResult = Readonly<{
  status: 'ready'
  readOnly: true
  latencyMs: number
}>

export type DatabaseDependencyErrorCode =
  | 'DATABASE_DISABLED'
  | 'DATABASE_NOT_CONFIGURED'
  | 'DATABASE_TIMEOUT'
  | 'DATABASE_UNAVAILABLE'
  | 'DATABASE_NOT_READ_ONLY'

export class DatabaseDependencyError extends Error {
  readonly code: DatabaseDependencyErrorCode

  constructor(code: DatabaseDependencyErrorCode) {
    super('Database dependency check failed.')
    this.name = 'DatabaseDependencyError'
    this.code = code
  }
}

export interface ReadOnlyDatabasePort {
  checkCanary(request: DatabaseCanaryRequest): Promise<DatabaseCanaryResult>
}
