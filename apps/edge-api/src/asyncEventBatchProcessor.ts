import type {
  EventProcessingRepositoryPort,
} from '../../../server/application/ports/messaging'
import {
  parseSupportedAsyncEventV1,
  type SupportedAsyncEventV1,
} from './asyncEvents'

export type AsyncQueueMessage = Readonly<{
  id: string
  attempts: number
  body: unknown
  ack(): void
  retry(options?: Readonly<{ delaySeconds?: number }>): void
}>

export type AsyncEventHandler = (event: SupportedAsyncEventV1) => Promise<void>

export type AsyncEventObservation = (
  event: string,
  fields: Readonly<Record<string, string | number | boolean | null>>,
) => void

export type AsyncEventBatchProcessorOptions = Readonly<{
  messages: readonly AsyncQueueMessage[]
  repository: EventProcessingRepositoryPort
  handleEvent: AsyncEventHandler
  nowMs?: () => number
  createClaimToken?: (message: AsyncQueueMessage) => string
  leaseDurationMs?: number
  retryDelaySeconds?: number
  observe?: AsyncEventObservation
}>

export type AsyncEventBatchProcessingSummary = Readonly<{
  acknowledged: number
  retried: number
}>

const DEFAULT_LEASE_DURATION_MS = 30_000
const DEFAULT_RETRY_DELAY_SECONDS = 15

function retryMessage(message: AsyncQueueMessage, delaySeconds: number): 'retried' {
  message.retry({ delaySeconds })
  return 'retried'
}

async function processMessage(
  message: AsyncQueueMessage,
  options: Omit<AsyncEventBatchProcessorOptions, 'messages'> & Required<Pick<
    AsyncEventBatchProcessorOptions,
    'nowMs' | 'createClaimToken' | 'leaseDurationMs' | 'retryDelaySeconds'
  >>,
): Promise<'acknowledged' | 'retried'> {
  let event: SupportedAsyncEventV1

  try {
    event = parseSupportedAsyncEventV1(message.body)
  } catch {
    options.observe?.('edge.queue.message.rejected', {
      message_id: message.id,
      attempts: message.attempts,
      reason: 'EVENT_UNSUPPORTED_OR_INVALID',
    })
    return retryMessage(message, options.retryDelaySeconds)
  }

  const claimToken = options.createClaimToken(message)
  let claim

  try {
    claim = await options.repository.claim({
      event,
      claimToken,
      nowMs: options.nowMs(),
      leaseDurationMs: options.leaseDurationMs,
    })
  } catch {
    options.observe?.('edge.queue.message.retry_scheduled', {
      message_id: message.id,
      event_id: event.event_id,
      tenant_id: event.tenant_id,
      reason: 'IDEMPOTENCY_UNAVAILABLE',
    })
    return retryMessage(message, options.retryDelaySeconds)
  }

  if (claim.kind === 'duplicate') {
    if (claim.status === 'succeeded') {
      message.ack()
      options.observe?.('edge.queue.message.duplicate_acked', {
        message_id: message.id,
        event_id: event.event_id,
        tenant_id: event.tenant_id,
        attempt_count: claim.attemptCount,
      })
      return 'acknowledged'
    }

    options.observe?.('edge.queue.message.retry_scheduled', {
      message_id: message.id,
      event_id: event.event_id,
      tenant_id: event.tenant_id,
      reason: 'PROCESSING_IN_PROGRESS',
    })
    return retryMessage(message, options.retryDelaySeconds)
  }

  try {
    await options.handleEvent(event)
  } catch {
    try {
      await options.repository.markFailed({
        tenantId: event.tenant_id,
        idempotencyKey: event.idempotency_key,
        claimToken,
        nowMs: options.nowMs(),
        errorCode: 'ASYNC_HANDLER_FAILED',
      })
    } catch {
      // A retry remains safe because the claim lease will eventually expire.
    }

    options.observe?.('edge.queue.message.retry_scheduled', {
      message_id: message.id,
      event_id: event.event_id,
      tenant_id: event.tenant_id,
      reason: 'HANDLER_FAILED',
    })
    return retryMessage(message, options.retryDelaySeconds)
  }

  try {
    const completed = await options.repository.markSucceeded({
      tenantId: event.tenant_id,
      idempotencyKey: event.idempotency_key,
      claimToken,
      nowMs: options.nowMs(),
    })

    if (!completed) {
      options.observe?.('edge.queue.message.retry_scheduled', {
        message_id: message.id,
        event_id: event.event_id,
        tenant_id: event.tenant_id,
        reason: 'CLAIM_LOST',
      })
      return retryMessage(message, options.retryDelaySeconds)
    }
  } catch {
    options.observe?.('edge.queue.message.retry_scheduled', {
      message_id: message.id,
      event_id: event.event_id,
      tenant_id: event.tenant_id,
      reason: 'COMPLETION_UNAVAILABLE',
    })
    return retryMessage(message, options.retryDelaySeconds)
  }

  message.ack()
  options.observe?.('edge.queue.message.acked', {
    message_id: message.id,
    event_id: event.event_id,
    tenant_id: event.tenant_id,
    attempt_count: claim.attemptCount,
  })
  return 'acknowledged'
}

export async function processAsyncEventBatch(
  options: AsyncEventBatchProcessorOptions,
): Promise<AsyncEventBatchProcessingSummary> {
  const resolved = {
    ...options,
    nowMs: options.nowMs ?? Date.now,
    createClaimToken: options.createClaimToken ?? (() => crypto.randomUUID()),
    leaseDurationMs: options.leaseDurationMs ?? DEFAULT_LEASE_DURATION_MS,
    retryDelaySeconds: options.retryDelaySeconds ?? DEFAULT_RETRY_DELAY_SECONDS,
  }

  const outcomes = await Promise.all(
    options.messages.map((message) => processMessage(message, resolved)),
  )

  return outcomes.reduce<AsyncEventBatchProcessingSummary>((summary, outcome) => ({
    acknowledged: summary.acknowledged + (outcome === 'acknowledged' ? 1 : 0),
    retried: summary.retried + (outcome === 'retried' ? 1 : 0),
  }), {
    acknowledged: 0,
    retried: 0,
  })
}
