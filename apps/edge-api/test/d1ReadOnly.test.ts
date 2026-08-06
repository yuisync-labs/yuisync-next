import { describe, expect, it } from 'vitest'

import { D1ReadOnlyAdapter } from '../src/adapters/d1ReadOnly'
import { DatabaseDependencyError } from '../../../server/application/ports/database'

type FakeDatabaseOptions = Readonly<{
  row?: { canary_value: number } | null
  error?: Error
  onPrepare?: (query: string) => void
}>

function createFakeDatabase(options: FakeDatabaseOptions = {}): D1Database {
  return {
    prepare(query: string) {
      options.onPrepare?.(query)
      return {
        async first() {
          if (options.error) throw options.error
          return options.row ?? { canary_value: 1 }
        },
      }
    },
  } as unknown as D1Database
}

describe('D1ReadOnlyAdapter', () => {
  it('executa somente a consulta canário constante', async () => {
    const queries: string[] = []
    const ticks = [10, 14]
    const adapter = new D1ReadOnlyAdapter({
      database: createFakeDatabase({ onPrepare: (query) => queries.push(query) }),
      now: () => ticks.shift() ?? 14,
    })

    await expect(adapter.checkCanary({
      requestId: 'request-d1-ready',
      timeoutMs: 500,
    })).resolves.toEqual({
      status: 'ready',
      readOnly: true,
      latencyMs: 4,
    })

    expect(queries).toEqual(['SELECT 1 AS canary_value'])
  })

  it('falha de forma categorizada quando o binding não existe', async () => {
    const adapter = new D1ReadOnlyAdapter({})

    await expect(adapter.checkCanary({
      requestId: 'request-d1-missing',
      timeoutMs: 500,
    })).rejects.toMatchObject<Partial<DatabaseDependencyError>>({
      name: 'DatabaseDependencyError',
      code: 'DATABASE_NOT_CONFIGURED',
      message: 'Database dependency check failed.',
    })
  })

  it('não expõe detalhes retornados pelo runtime D1', async () => {
    const adapter = new D1ReadOnlyAdapter({
      database: createFakeDatabase({ error: new Error('sensitive database detail') }),
    })

    await expect(adapter.checkCanary({
      requestId: 'request-d1-error',
      timeoutMs: 500,
    })).rejects.toMatchObject<Partial<DatabaseDependencyError>>({
      name: 'DatabaseDependencyError',
      code: 'DATABASE_UNAVAILABLE',
      message: 'Database dependency check failed.',
    })
  })
})
