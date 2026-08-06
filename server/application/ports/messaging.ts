import type { DomainEventEnvelopeV1 } from '../../../shared/contracts/v1/index'

export type EventPublishReceipt = Readonly<{
  event_id: string
  accepted: boolean
  duplicate: boolean
}>

export interface DomainEventPublisherPort {
  publish(event: DomainEventEnvelopeV1): Promise<EventPublishReceipt>
}

export type EventProcessingStatus = 'processing' | 'succeeded' | 'failed'

export type EventProcessingClaimRequest = Readonly<{
  event: DomainEventEnvelopeV1
  claimToken: string
  nowMs: number
  leaseDurationMs: number
}>

export type EventProcessingClaimResult =
  | Readonly<{
    kind: 'claimed'
    attemptCount: number
    leaseExpiresAtMs: number
  }>
  | Readonly<{
    kind: 'duplicate'
    status: 'processing' | 'succeeded'
    attemptCount: number
  }>

export type EventProcessingTransitionRequest = Readonly<{
  tenantId: string
  idempotencyKey: string
  claimToken: string
  nowMs: number
}>

export type EventProcessingFailureRequest = EventProcessingTransitionRequest & Readonly<{
  errorCode: string
}>

export interface EventProcessingRepositoryPort {
  claim(request: EventProcessingClaimRequest): Promise<EventProcessingClaimResult>
  markSucceeded(request: EventProcessingTransitionRequest): Promise<boolean>
  markFailed(request: EventProcessingFailureRequest): Promise<boolean>
}
