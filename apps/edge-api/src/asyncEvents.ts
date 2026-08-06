import {
  ASYNC_CANARY_EVENT_NAME_V1,
  parseAsyncCanaryEventV1,
  parseDomainEventEnvelopeV1,
  type AsyncCanaryEventV1,
} from '../../../shared/contracts/v1/index'

export type SupportedAsyncEventV1 = AsyncCanaryEventV1
export type AsyncEventRoutingErrorCode = 'ASYNC_EVENT_UNSUPPORTED'

export class AsyncEventRoutingError extends Error {
  readonly code: AsyncEventRoutingErrorCode

  constructor(code: AsyncEventRoutingErrorCode) {
    super('Asynchronous event cannot be routed.')
    this.name = 'AsyncEventRoutingError'
    this.code = code
  }
}

export function isSupportedAsyncEventName(eventName: string): boolean {
  return eventName === ASYNC_CANARY_EVENT_NAME_V1
}

export function parseSupportedAsyncEventV1(input: unknown): SupportedAsyncEventV1 {
  const envelope = parseDomainEventEnvelopeV1(input)

  switch (envelope.event_name) {
    case ASYNC_CANARY_EVENT_NAME_V1:
      return parseAsyncCanaryEventV1(envelope)
    default:
      throw new AsyncEventRoutingError('ASYNC_EVENT_UNSUPPORTED')
  }
}
