import { describe, expect, it } from 'vitest'

import {
  ASYNC_CANARY_EVENT_NAME_V1,
  LUNA_MESSAGE_RECEIVED_EVENT_NAME_V1,
} from '../../../shared/contracts/v1/index'
import {
  AsyncEventRoutingError,
  isSupportedAsyncEventName,
  parseSupportedAsyncEventV1,
} from '../src/asyncEvents'

function canaryEvent() {
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

describe('asynchronous event allowlist', () => {
  it('permite o canário e mensagens da Luna', () => {
    expect(isSupportedAsyncEventName(ASYNC_CANARY_EVENT_NAME_V1)).toBe(true)
    expect(isSupportedAsyncEventName(LUNA_MESSAGE_RECEIVED_EVENT_NAME_V1)).toBe(true)
    expect(isSupportedAsyncEventName('orders.created.v1')).toBe(false)
    expect(parseSupportedAsyncEventV1(canaryEvent())).toEqual(canaryEvent())
  })

  it('valida o contrato assíncrono da Luna', () => {
    const event = {
      ...canaryEvent(),
      event_name: LUNA_MESSAGE_RECEIVED_EVENT_NAME_V1,
      aggregate: { type: 'luna.conversation', id: 'wa:5532999999999', version: 1 },
      payload: {
        module_id: 'petshop', conversation_id: 'wa:5532999999999', source_message_id: 'wamid.1',
        channel: 'whatsapp', customer_address: '5532999999999', phone_number_id: '1234567890',
      },
    }
    expect(parseSupportedAsyncEventV1(event)).toEqual(event)
  })

  it('rejeita eventos válidos no envelope, mas ainda não habilitados', () => {
    expect(() => parseSupportedAsyncEventV1({
      ...canaryEvent(),
      event_name: 'orders.created.v1',
    })).toThrow(AsyncEventRoutingError)

    try {
      parseSupportedAsyncEventV1({
        ...canaryEvent(),
        event_name: 'orders.created.v1',
      })
    } catch (error) {
      expect(error).toMatchObject({
        name: 'AsyncEventRoutingError',
        code: 'ASYNC_EVENT_UNSUPPORTED',
        message: 'Asynchronous event cannot be routed.',
      })
    }
  })
})
