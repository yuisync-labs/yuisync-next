import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import {
  Client,
  type ClientConfig,
} from 'pg'

import {
  DatabaseDependencyError,
  type DatabaseCanaryRequest,
  type DatabaseCanaryResult,
  type ReadOnlyDatabasePort,
} from '../../../../server/application/ports/database'
import { isValidReadOnlyCanary } from '../databaseCanary'

type PgClientLike = Pick<Client, 'connect' | 'query' | 'end'>

type HyperdrivePostgresAdapterOptions = Readonly<{
  connectionString: string
  createClient?: (config: ClientConfig) => PgClientLike
  now?: () => number
}>

function isTimeoutError(error: unknown): boolean {
  if (!(error instanceof Error)) return false

  const normalized = `${error.name} ${error.message}`.toLowerCase()
  return normalized.includes('timeout') || normalized.includes('timed out')
}

export class HyperdrivePostgresReadOnlyAdapter implements ReadOnlyDatabasePort {
  private readonly connectionString: string
  private readonly createClient: (config: ClientConfig) => PgClientLike
  private readonly now: () => number

  constructor(options: HyperdrivePostgresAdapterOptions) {
    this.connectionString = options.connectionString.trim()
    this.createClient = options.createClient ?? ((config) => new Client(config))
    this.now = options.now ?? (() => performance.now())
  }

  async checkCanary(request: DatabaseCanaryRequest): Promise<DatabaseCanaryResult> {
    if (!this.connectionString) {
      throw new DatabaseDependencyError('DATABASE_NOT_CONFIGURED')
    }

    const timeoutMs = Math.max(100, Math.trunc(request.timeoutMs))
    const startedAt = this.now()
    const client = this.createClient({
      connectionString: this.connectionString,
      application_name: 'yuisync-edge-canary',
      connectionTimeoutMillis: timeoutMs,
      query_timeout: timeoutMs,
      statement_timeout: timeoutMs,
      options: '-c default_transaction_read_only=on',
    })
    let transactionStarted = false

    try {
      await client.connect()
      await client.query('BEGIN READ ONLY')
      transactionStarted = true

      const database = drizzle(client as Client)
      const result = await database.execute<{
        transaction_read_only: string
        canary_value: number
      }>(sql`
        select
          current_setting('transaction_read_only') as transaction_read_only,
          1::integer as canary_value
      `)

      if (!isValidReadOnlyCanary(result.rows[0])) {
        throw new DatabaseDependencyError('DATABASE_NOT_READ_ONLY')
      }

      await client.query('ROLLBACK')
      transactionStarted = false

      return {
        status: 'ready',
        readOnly: true,
        latencyMs: Math.max(0, Math.round(this.now() - startedAt)),
      }
    } catch (error) {
      if (error instanceof DatabaseDependencyError) throw error
      if (isTimeoutError(error)) {
        throw new DatabaseDependencyError('DATABASE_TIMEOUT')
      }
      throw new DatabaseDependencyError('DATABASE_UNAVAILABLE')
    } finally {
      if (transactionStarted) {
        try {
          await client.query('ROLLBACK')
        } catch {
          // The original dependency error remains authoritative.
        }
      }

      try {
        await client.end()
      } catch {
        // Closing failures must not expose driver details or mask the canary result.
      }
    }
  }
}
