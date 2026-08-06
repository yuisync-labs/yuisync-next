import type { AsyncCanaryEventV1 } from '../../../shared/contracts/v1/index'
import { D1EventProcessingRepository } from './adapters/d1EventProcessingRepository'
import {
  processAsyncEventBatch,
  type AsyncEventObservation,
} from './asyncEventBatchProcessor'
import type { SupportedAsyncEventV1 } from './asyncEvents'
import { emitEdgeLog } from './observability'

async function handleSupportedAsyncEvent(event: SupportedAsyncEventV1): Promise<void> {
  const canary = event as AsyncCanaryEventV1

  emitEdgeLog('info', 'edge.async_canary.processed', {
    event_id: canary.event_id,
    tenant_id: canary.tenant_id,
    correlation_id: canary.correlation_id,
    probe_id: canary.payload.probe_id,
  })
}

const observeQueue: AsyncEventObservation = (event, fields) => {
  const level = event.endsWith('.retry_scheduled') || event.endsWith('.rejected')
    ? 'warn'
    : 'info'
  emitEdgeLog(level, event, fields)
}

export async function handleAsyncQueue(
  batch: MessageBatch<unknown>,
  env: EdgeEnv,
): Promise<void> {
  const repository = new D1EventProcessingRepository(env.DB)
  const summary = await processAsyncEventBatch({
    messages: batch.messages,
    repository,
    handleEvent: handleSupportedAsyncEvent,
    observe: observeQueue,
  })

  emitEdgeLog('info', 'edge.queue.batch.completed', {
    queue: batch.queue,
    message_count: batch.messages.length,
    acknowledged: summary.acknowledged,
    retried: summary.retried,
  })
}
