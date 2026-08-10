import {
  DatabaseDependencyError,
  type DatabaseCanaryRequest,
  type DatabaseCanaryResult,
  type ReadOnlyDatabasePort,
} from '../../../../server/application/ports/database'
import { isValidD1Canary } from '../databaseCanary'

type D1ReadOnlyAdapterOptions = Readonly<{
  database?: D1Database
  now?: () => number
}>

const TIMEOUT_TOKEN = Symbol('d1-timeout')

async function withTimeout<T>(operation: Promise<T>, timeoutMs: number): Promise<T | typeof TIMEOUT_TOKEN> {
  let timer: ReturnType<typeof setTimeout> | undefined

  try {
    return await Promise.race([
      operation,
      new Promise<typeof TIMEOUT_TOKEN>((resolve) => {
        timer = setTimeout(() => resolve(TIMEOUT_TOKEN), timeoutMs)
      }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

export class D1ReadOnlyAdapter implements ReadOnlyDatabasePort {
  private readonly database?: D1Database
  private readonly now: () => number

  constructor(options: D1ReadOnlyAdapterOptions) {
    this.database = options.database
    this.now = options.now ?? (() => performance.now())
  }

  async checkCanary(request: DatabaseCanaryRequest): Promise<DatabaseCanaryResult> {
    if (!this.database) {
      throw new DatabaseDependencyError('DATABASE_NOT_CONFIGURED')
    }

    const timeoutMs = Math.max(100, Math.trunc(request.timeoutMs))
    const startedAt = this.now()

    try {
      const result = await withTimeout(
        this.database
          .prepare('SELECT 1 AS canary_value')
          .first<{ canary_value: number }>(),
        timeoutMs,
      )

      if (result === TIMEOUT_TOKEN) {
        throw new DatabaseDependencyError('DATABASE_TIMEOUT')
      }

      if (!isValidD1Canary(result ?? undefined)) {
        throw new DatabaseDependencyError('DATABASE_UNAVAILABLE')
      }

      return {
        status: 'ready',
        readOnly: true,
        latencyMs: Math.max(0, Math.round(this.now() - startedAt)),
      }
    } catch (error) {
      if (error instanceof DatabaseDependencyError) throw error
      throw new DatabaseDependencyError('DATABASE_UNAVAILABLE')
    }
  }
}
