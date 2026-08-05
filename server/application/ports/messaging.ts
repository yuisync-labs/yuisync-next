import type { DomainEventEnvelopeV1 } from '../../../shared/contracts/v1/index'

export type EventPublishReceipt = Readonly<{
  event_id: string
  accepted: boolean
  duplicate: boolean
}>

export interface DomainEventPublisherPort {
  publish(event: DomainEventEnvelopeV1): Promise<EventPublishReceipt>
}
