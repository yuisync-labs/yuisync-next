import {
  parseDomainEventEnvelopeV1,
  type DomainEventEnvelopeV1,
} from '../../../../shared/contracts/v1/index'
import type {
  DomainEventPublisherPort,
  EventPublishReceipt,
} from '../../../../server/application/ports/messaging'

type QueueSender = Pick<Queue<DomainEventEnvelopeV1>, 'send'>

export type QueuePublisherErrorCode =
  | 'QUEUE_NOT_CONFIGURED'
  | 'QUEUE_UNAVAILABLE'

export class QueuePublisherError extends Error {
  readonly code: QueuePublisherErrorCode

  constructor(code: QueuePublisherErrorCode) {
    super('Asynchronous event publication failed.')
    this.name = 'QueuePublisherError'
    this.code = code
  }
}

export class CloudflareQueueEventPublisher implements DomainEventPublisherPort {
  private readonly queue?: QueueSender

  constructor(queue?: QueueSender) {
    this.queue = queue
  }

  async publish(event: DomainEventEnvelopeV1): Promise<EventPublishReceipt> {
    const validated = parseDomainEventEnvelopeV1(event)

    if (!this.queue) {
      throw new QueuePublisherError('QUEUE_NOT_CONFIGURED')
    }

    try {
      await this.queue.send(validated)
    } catch {
      throw new QueuePublisherError('QUEUE_UNAVAILABLE')
    }

    return {
      event_id: validated.event_id,
      accepted: true,
      duplicate: false,
    }
  }
}
