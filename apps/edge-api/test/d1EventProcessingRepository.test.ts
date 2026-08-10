import { env } from 'cloudflare:workers'
import { beforeEach, describe, expect, it } from 'vitest'

import {
  ASYNC_CANARY_EVENT_NAME_V1,
  parseAsyncCanaryEventV1,
} from '../../../shared/contracts/v1/index'
import {
  D1EventProcessingRepository,
  EventProcessingRepositoryError,
} from '../src/adapters/d1EventProcessingRepository'

const testEnv = env as EdgeEnv & { DB: D1Database }

function canaryEvent(suffix: string, idempotencyKey = `idempotency-${suffix}`) {
  return parseAsyncCanaryEventV1({
    type: 'domain_event',
    version: 1,
    event_id: `event-${suffix}`,
    event_name: ASYNC_CANARY_EVENT_NAME_V1,
    event_version: 1,
    tenant_id: 'tenant-async-tests',
    aggregate: {
      type: 'system.async_canary',
      id: `aggregate-${suffix}`,
      version: 0,
    },
    occurred_at: '2026-08-06T14:15:00.000Z',
    correlation_id: `correlation-${suffix}`,
    idempotency_key: idempotencyKey,
    payload: {
      probe_id: `probe-${suffix}`,
    },
  })
}

function claimRequest(
  event: ReturnType<typeof canaryEvent>,
  claimToken: string,
  nowMs = 1_000,
  leaseDurationMs = 5_000,
) {
  return {
    event,
    claimToken,
    nowMs,
    leaseDurationMs,
  }
}

beforeEach(async () => {
  await testEnv.DB.prepare('DELETE FROM _yuisync_event_processing').run()
})

describe('D1EventProcessingRepository in workerd', () => {
  it('permite somente um claim concorrente para a mesma chave', async () => {
    const repository = new D1EventProcessingRepository(testEnv.DB)
    const event = canaryEvent('concurrent')

    const results = await Promise.all([
      repository.claim(claimRequest(event, 'claim-concurrent-a')),
      repository.claim(claimRequest(event, 'claim-concurrent-b')),
    ])

    expect(results.map((result) => result.kind).sort()).toEqual([
      'claimed',
      'duplicate',
    ])
    expect(results.find((result) => result.kind === 'claimed')).toMatchObject({
      attemptCount: 1,
      leaseExpiresAtMs: 6_000,
    })
    expect(results.find((result) => result.kind === 'duplicate')).toMatchObject({
      status: 'processing',
      attemptCount: 1,
    })
  })

  it('não reprocessa um evento concluído', async () => {
    const repository = new D1EventProcessingRepository(testEnv.DB)
    const event = canaryEvent('succeeded')

    await expect(repository.claim(claimRequest(event, 'claim-success'))).resolves.toMatchObject({
      kind: 'claimed',
      attemptCount: 1,
    })
    await expect(repository.markSucceeded({
      tenantId: event.tenant_id,
      idempotencyKey: event.idempotency_key,
      claimToken: 'claim-success',
      nowMs: 2_000,
    })).resolves.toBe(true)

    await expect(repository.claim(claimRequest(
      event,
      'claim-after-success',
      3_000,
    ))).resolves.toEqual({
      kind: 'duplicate',
      status: 'succeeded',
      attemptCount: 1,
    })
  })

  it('permite redelivery após falha categorizada', async () => {
    const repository = new D1EventProcessingRepository(testEnv.DB)
    const event = canaryEvent('retry')

    await repository.claim(claimRequest(event, 'claim-retry-1'))
    await expect(repository.markFailed({
      tenantId: event.tenant_id,
      idempotencyKey: event.idempotency_key,
      claimToken: 'claim-retry-1',
      nowMs: 2_000,
      errorCode: 'temporary dependency failure with details',
    })).resolves.toBe(true)

    await expect(repository.claim(claimRequest(
      event,
      'claim-retry-2',
      3_000,
    ))).resolves.toEqual({
      kind: 'claimed',
      attemptCount: 2,
      leaseExpiresAtMs: 8_000,
    })

    const row = await testEnv.DB
      .prepare(`
        SELECT status, attempt_count, last_error_code
        FROM _yuisync_event_processing
        WHERE tenant_id = ? AND idempotency_key = ?
      `)
      .bind(event.tenant_id, event.idempotency_key)
      .first<{
        status: string
        attempt_count: number
        last_error_code: string | null
      }>()

    expect(row).toEqual({
      status: 'processing',
      attempt_count: 2,
      last_error_code: null,
    })
  })

  it('recupera lease expirada sem roubar um processamento ativo', async () => {
    const repository = new D1EventProcessingRepository(testEnv.DB)
    const event = canaryEvent('lease')

    await repository.claim(claimRequest(event, 'claim-lease-1', 1_000, 2_000))

    await expect(repository.claim(claimRequest(
      event,
      'claim-lease-active',
      2_999,
      2_000,
    ))).resolves.toEqual({
      kind: 'duplicate',
      status: 'processing',
      attemptCount: 1,
    })

    await expect(repository.claim(claimRequest(
      event,
      'claim-lease-expired',
      3_000,
      2_000,
    ))).resolves.toEqual({
      kind: 'claimed',
      attemptCount: 2,
      leaseExpiresAtMs: 5_000,
    })
  })

  it('rejeita reutilização da chave para outro evento sem expor dados', async () => {
    const repository = new D1EventProcessingRepository(testEnv.DB)
    const first = canaryEvent('original', 'shared-idempotency-key')
    const conflicting = canaryEvent('conflicting', 'shared-idempotency-key')

    await repository.claim(claimRequest(first, 'claim-original'))

    await expect(repository.claim(claimRequest(
      conflicting,
      'claim-conflicting',
    ))).rejects.toBeInstanceOf(EventProcessingRepositoryError)
    await expect(repository.claim(claimRequest(
      conflicting,
      'claim-conflicting',
    ))).rejects.toMatchObject({
      code: 'IDEMPOTENCY_CONFLICT',
      message: 'Asynchronous event processing state could not be persisted.',
    })
  })

  it('falha de forma categorizada quando o binding não existe', async () => {
    const repository = new D1EventProcessingRepository()

    await expect(repository.claim(claimRequest(
      canaryEvent('missing-db'),
      'claim-missing-db',
    ))).rejects.toMatchObject({
      code: 'DATABASE_NOT_CONFIGURED',
      message: 'Asynchronous event processing state could not be persisted.',
    })
  })
})
