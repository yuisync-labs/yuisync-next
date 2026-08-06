import { describe, expect, it } from 'vitest'

import {
  ASYNC_CANARY_EVENT_NAME_V1,
  parseAsyncCanaryEventV1,
} from '../../../shared/contracts/v1/index'

function validEvent() {
  return {
    type: 'domain_event' as const,
    version: 1 as const,
    event_id: 'event-async-canary-001',
    event_name: ASYNC_CANARY_EVENT_NAME_V1,
    event_version: 1 as const,
    tenant_id: 'tenant-staging-001',
    aggregate: {
      type: 'system.async_canary' as const,
      id: 'async-canary-001',
      version: 0,
    },
    occurred_at: '2026-08-06T14:10:00.000Z',
    correlation_id: 'correlation-async-canary-001',
    idempotency_key: 'idempotency-async-canary-001',
    payload: {
      probe_id: 'probe-001',
    },
  }
}

describe('AsyncCanaryEventV1', () => {
  it('aceita o envelope canário versionado', () => {
    expect(parseAsyncCanaryEventV1(validEvent())).toEqual(validEvent())
  })

  it('rejeita nome de evento, versão ou payload incompatível', () => {
    expect(() => parseAsyncCanaryEventV1({
      ...validEvent(),
      event_name: 'system.async_canary.completed.v1',
    })).toThrow()

    expect(() => parseAsyncCanaryEventV1({
      ...validEvent(),
      event_version: 2,
    })).toThrow()

    expect(() => parseAsyncCanaryEventV1({
      ...validEvent(),
      payload: {},
    })).toThrow()
  })
})
