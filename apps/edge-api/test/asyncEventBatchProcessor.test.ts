import { describe, expect, it, vi } from 'vitest'

import {
  ASYNC_CANARY_EVENT_NAME_V1,
  parseAsyncCanaryEventV1,
  type DomainEventEnvelopeV1,
} from '../../../shared/contracts/v1/index'
import type {
  EventProcessingClaimRequest,
  EventProcessingClaimResult,
  EventProcessingFailureRequest,
  EventProcessingRepositoryPort,
  EventProcessingTransitionRequest,
} from '../../../server/application/ports/messaging'
import {
  processAsyncEventBatch,
  type AsyncQueueMessage,
} from '../src/asyncEventBatchProcessor'

class TestMessage implements AsyncQueueMessage {
  readonly id: string
  readonly attempts: number
  readonly body: unknown
  acknowledged = false
  retryOptions: Readonly<{ delaySeconds?: number }> | undefined

  constructor(id: string, body: unknown, attempts = 1) {
    this.id = id
    this.body = body
    this.attempts = attempts
  }

  ack(): void {
    this.acknowledged = true
  }

  retry(options?: Readonly<{ delaySeconds?: number }>): void {
    this.retryOptions = options
  }
}

class TestRepository implements EventProcessingRepositoryPort {
  claimResult: EventProcessingClaimResult = {
    kind: 'claimed',
    attemptCount: 1,
    leaseExpiresAtMs: 31_000,
  }
  claimError: Error | null = null
  markSucceededResult = true
  claims: EventProcessingClaimRequest[] = []
  succeeded: EventProcessingTransitionRequest[] = []
  failed: EventProcessingFailureRequest[] = []

  async claim(request: EventProcessingClaimRequest): Promise<EventProcessingClaimResult> {
    this.claims.push(request)
    if (this.claimError) {
      throw this.claimError
    }
    return this.claimResult
  }

  async markSucceeded(request: EventProcessingTransitionRequest): Promise<boolean> {
    this.succeeded.push(request)
    return this.markSucceededResult
  }

  async markFailed(request: EventProcessingFailureRequest): Promise<boolean> {
    this.failed.push(request)
    return true
  }
}

function canaryEvent(suffix: string) {
  return parseAsyncCanaryEventV1({
    type: 'domain_event',
    version: 1,
    event_id: `event-${suffix}`,
    event_name: ASYNC_CANARY_EVENT_NAME_V1,
    event_version: 1,
    tenant_id: 'tenant-batch-tests',
    aggregate: {
      type: 'system.async_canary',
      id: `aggregate-${suffix}`,
      version: 0,
    },
    occurred_at: '2026-08-06T14:25:00.000Z',
    correlation_id: `correlation-${suffix}`,
    idempotency_key: `idempotency-${suffix}`,
    payload: {
      probe_id: `probe-${suffix}`,
    },
  })
}

function unsupportedEvent(): DomainEventEnvelopeV1 {
  return {
    ...canaryEvent('unsupported'),
    event_name: 'catalog.product.updated.v1',
    aggregate: {
      type: 'catalog.product',
      id: 'product-unsupported',
      version: 1,
    },
    payload: {},
  }
}

describe('processAsyncEventBatch', () => {
  it('acknowledges sucesso e agenda retry individual para poison message', async () => {
    const repository = new TestRepository()
    const valid = new TestMessage('message-valid', canaryEvent('valid'))
    const unsupported = new TestMessage('message-unsupported', unsupportedEvent())
    const handler = vi.fn(async () => undefined)

    await expect(processAsyncEventBatch({
      messages: [valid, unsupported],
      repository,
      handleEvent: handler,
      nowMs: () => 1_000,
      createClaimToken: (message) => `claim-${message.id}`,
    })).resolves.toEqual({
      acknowledged: 1,
      retried: 1,
    })

    expect(valid.acknowledged).toBe(true)
    expect(valid.retryOptions).toBeUndefined()
    expect(unsupported.acknowledged).toBe(false)
    expect(unsupported.retryOptions).toEqual({ delaySeconds: 15 })
    expect(handler).toHaveBeenCalledTimes(1)
    expect(repository.succeeded).toHaveLength(1)
  })

  it('acknowledges redelivery já concluída sem executar o handler', async () => {
    const repository = new TestRepository()
    repository.claimResult = {
      kind: 'duplicate',
      status: 'succeeded',
      attemptCount: 1,
    }
    const message = new TestMessage('message-duplicate', canaryEvent('duplicate'), 2)
    const handler = vi.fn(async () => undefined)

    await processAsyncEventBatch({
      messages: [message],
      repository,
      handleEvent: handler,
    })

    expect(message.acknowledged).toBe(true)
    expect(message.retryOptions).toBeUndefined()
    expect(handler).not.toHaveBeenCalled()
    expect(repository.succeeded).toHaveLength(0)
  })

  it('não concorre com claim ativo e agenda nova entrega', async () => {
    const repository = new TestRepository()
    repository.claimResult = {
      kind: 'duplicate',
      status: 'processing',
      attemptCount: 1,
    }
    const message = new TestMessage('message-processing', canaryEvent('processing'), 2)

    await processAsyncEventBatch({
      messages: [message],
      repository,
      handleEvent: async () => undefined,
      retryDelaySeconds: 20,
    })

    expect(message.acknowledged).toBe(false)
    expect(message.retryOptions).toEqual({ delaySeconds: 20 })
  })

  it('marca falha categorizada e agenda retry quando o handler falha', async () => {
    const repository = new TestRepository()
    const message = new TestMessage('message-handler-failure', canaryEvent('failure'))

    await processAsyncEventBatch({
      messages: [message],
      repository,
      handleEvent: async () => {
        throw new Error('sensitive handler detail')
      },
      nowMs: () => 2_000,
      createClaimToken: () => 'claim-handler-failure',
    })

    expect(repository.failed).toEqual([{
      tenantId: 'tenant-batch-tests',
      idempotencyKey: 'idempotency-failure',
      claimToken: 'claim-handler-failure',
      nowMs: 2_000,
      errorCode: 'ASYNC_HANDLER_FAILED',
    }])
    expect(message.acknowledged).toBe(false)
    expect(message.retryOptions).toEqual({ delaySeconds: 15 })
  })

  it('agenda retry sem propagar detalhes quando a idempotência está indisponível', async () => {
    const repository = new TestRepository()
    repository.claimError = new Error('sensitive database detail')
    const message = new TestMessage('message-database-failure', canaryEvent('database-failure'))

    await expect(processAsyncEventBatch({
      messages: [message],
      repository,
      handleEvent: async () => undefined,
    })).resolves.toEqual({
      acknowledged: 0,
      retried: 1,
    })

    expect(message.retryOptions).toEqual({ delaySeconds: 15 })
  })
})
