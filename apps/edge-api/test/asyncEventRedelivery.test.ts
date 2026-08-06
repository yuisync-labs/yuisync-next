import { env } from 'cloudflare:workers'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  ASYNC_CANARY_EVENT_NAME_V1,
  parseAsyncCanaryEventV1,
} from '../../../shared/contracts/v1/index'
import { D1EventProcessingRepository } from '../src/adapters/d1EventProcessingRepository'
import {
  processAsyncEventBatch,
  type AsyncQueueMessage,
} from '../src/asyncEventBatchProcessor'

const testEnv = env as EdgeEnv & { DB: D1Database }

class TestMessage implements AsyncQueueMessage {
  readonly id: string
  readonly attempts: number
  readonly body: unknown
  acknowledged = false
  retried = false

  constructor(id: string, body: unknown, attempts = 1) {
    this.id = id
    this.body = body
    this.attempts = attempts
  }

  ack(): void {
    this.acknowledged = true
  }

  retry(): void {
    this.retried = true
  }
}

function canaryEvent(suffix: string) {
  return parseAsyncCanaryEventV1({
    type: 'domain_event',
    version: 1,
    event_id: `event-redelivery-${suffix}`,
    event_name: ASYNC_CANARY_EVENT_NAME_V1,
    event_version: 1,
    tenant_id: 'tenant-redelivery-tests',
    aggregate: {
      type: 'system.async_canary',
      id: `aggregate-redelivery-${suffix}`,
      version: 0,
    },
    occurred_at: '2026-08-06T14:30:00.000Z',
    correlation_id: `correlation-redelivery-${suffix}`,
    idempotency_key: `idempotency-redelivery-${suffix}`,
    payload: {
      probe_id: `probe-redelivery-${suffix}`,
    },
  })
}

beforeEach(async () => {
  await testEnv.DB.prepare('DELETE FROM _yuisync_event_processing').run()
})

describe('async event redelivery with D1 in workerd', () => {
  it('acknowledges redelivery concluída sem repetir o efeito', async () => {
    const repository = new D1EventProcessingRepository(testEnv.DB)
    const event = canaryEvent('completed')
    const handler = vi.fn(async () => undefined)
    const first = new TestMessage('message-completed-1', event)

    await processAsyncEventBatch({
      messages: [first],
      repository,
      handleEvent: handler,
      nowMs: () => 1_000,
      createClaimToken: () => 'claim-completed-1',
    })

    expect(first.acknowledged).toBe(true)
    expect(handler).toHaveBeenCalledTimes(1)

    const redelivery = new TestMessage('message-completed-2', event, 2)
    await processAsyncEventBatch({
      messages: [redelivery],
      repository,
      handleEvent: handler,
      nowMs: () => 2_000,
      createClaimToken: () => 'claim-completed-2',
    })

    expect(redelivery.acknowledged).toBe(true)
    expect(redelivery.retried).toBe(false)
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('reclama o evento após falha e conclui na entrega seguinte', async () => {
    const repository = new D1EventProcessingRepository(testEnv.DB)
    const event = canaryEvent('failed-then-success')
    const first = new TestMessage('message-failed-1', event)

    await processAsyncEventBatch({
      messages: [first],
      repository,
      handleEvent: async () => {
        throw new Error('transient failure')
      },
      nowMs: () => 3_000,
      createClaimToken: () => 'claim-failed-1',
    })

    expect(first.acknowledged).toBe(false)
    expect(first.retried).toBe(true)

    const handler = vi.fn(async () => undefined)
    const redelivery = new TestMessage('message-failed-2', event, 2)
    await processAsyncEventBatch({
      messages: [redelivery],
      repository,
      handleEvent: handler,
      nowMs: () => 4_000,
      createClaimToken: () => 'claim-failed-2',
    })

    expect(redelivery.acknowledged).toBe(true)
    expect(handler).toHaveBeenCalledTimes(1)

    const row = await testEnv.DB
      .prepare(`
        SELECT status, attempt_count
        FROM _yuisync_event_processing
        WHERE tenant_id = ? AND idempotency_key = ?
      `)
      .bind(event.tenant_id, event.idempotency_key)
      .first<{ status: string; attempt_count: number }>()

    expect(row).toEqual({
      status: 'succeeded',
      attempt_count: 2,
    })
  })
})
