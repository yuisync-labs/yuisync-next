import { describe, expect, it } from 'vitest'

import {
  ASYNC_CANARY_EVENT_NAME_V1,
  parseAsyncCanaryEventV1,
  type DomainEventEnvelopeV1,
} from '../../../shared/contracts/v1/index'
import {
  CloudflareQueueEventPublisher,
  QueuePublisherError,
} from '../src/adapters/cloudflareQueueEventPublisher'

function canaryEvent() {
  return parseAsyncCanaryEventV1({
    type: 'domain_event',
    version: 1,
    event_id: 'event-async-canary-001',
    event_name: ASYNC_CANARY_EVENT_NAME_V1,
    event_version: 1,
    tenant_id: 'tenant-staging-001',
    aggregate: {
      type: 'system.async_canary',
      id: 'async-canary-001',
      version: 0,
    },
    occurred_at: '2026-08-06T14:10:00.000Z',
    correlation_id: 'correlation-async-canary-001',
    idempotency_key: 'idempotency-async-canary-001',
    payload: {
      probe_id: 'probe-001',
    },
  })
}

describe('CloudflareQueueEventPublisher', () => {
  it('valida e publica o envelope sem modificar seu conteúdo', async () => {
    const sent: DomainEventEnvelopeV1[] = []
    const queue = {
      async send(event: DomainEventEnvelopeV1) {
        sent.push(event)
      },
    } as unknown as Queue<DomainEventEnvelopeV1>
    const publisher = new CloudflareQueueEventPublisher(queue)
    const event = canaryEvent()

    await expect(publisher.publish(event)).resolves.toEqual({
      event_id: event.event_id,
      accepted: true,
      duplicate: false,
    })
    expect(sent).toEqual([event])
  })

  it('falha de forma categorizada sem binding configurado', async () => {
    const publisher = new CloudflareQueueEventPublisher()

    await expect(publisher.publish(canaryEvent())).rejects.toMatchObject({
      name: 'QueuePublisherError',
      code: 'QUEUE_NOT_CONFIGURED',
      message: 'Asynchronous event publication failed.',
    })
  })

  it('não expõe detalhes de falha do transporte', async () => {
    const queue = {
      async send() {
        throw new Error('sensitive transport detail')
      },
    } as unknown as Queue<DomainEventEnvelopeV1>
    const publisher = new CloudflareQueueEventPublisher(queue)

    await expect(publisher.publish(canaryEvent())).rejects.toBeInstanceOf(QueuePublisherError)
    await expect(publisher.publish(canaryEvent())).rejects.toMatchObject({
      code: 'QUEUE_UNAVAILABLE',
      message: 'Asynchronous event publication failed.',
    })
  })
})
