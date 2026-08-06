import { describe, expect, it, vi } from 'vitest'

import {
  handleAsyncQueue,
  isAsyncQueueEnabled,
} from '../src/queueHandler'

describe('queue handler feature gate', () => {
  it('habilita somente o valor booleano explícito', () => {
    expect(isAsyncQueueEnabled('true')).toBe(true)
    expect(isAsyncQueueEnabled(' TRUE ')).toBe(true)
    expect(isAsyncQueueEnabled('false')).toBe(false)
    expect(isAsyncQueueEnabled(undefined)).toBe(false)
  })

  it('agenda retry de todo o lote sem acessar D1 quando está desligado', async () => {
    const firstRetry = vi.fn()
    const secondRetry = vi.fn()
    const batch = {
      queue: 'test-events',
      messages: [
        { id: 'message-disabled-1', retry: firstRetry },
        { id: 'message-disabled-2', retry: secondRetry },
      ],
    } as unknown as MessageBatch<unknown>

    await handleAsyncQueue(batch, {
      EDGE_ASYNC_ENABLED: 'false',
    } as unknown as EdgeEnv)

    expect(firstRetry).toHaveBeenCalledWith({ delaySeconds: 300 })
    expect(secondRetry).toHaveBeenCalledWith({ delaySeconds: 300 })
  })
})
