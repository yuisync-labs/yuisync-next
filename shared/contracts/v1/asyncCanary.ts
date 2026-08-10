import { z } from 'zod'

import {
  ContractIdentifierSchema,
} from './common'
import {
  DomainAggregateRefV1Schema,
  DomainEventEnvelopeV1Schema,
} from './domainEvent'
import { parseContract } from './errors'

export const ASYNC_CANARY_EVENT_NAME_V1 = 'system.async_canary.requested.v1' as const

export const AsyncCanaryPayloadV1Schema = z.strictObject({
  probe_id: ContractIdentifierSchema,
})

export const AsyncCanaryEventV1Schema = DomainEventEnvelopeV1Schema.extend({
  event_name: z.literal(ASYNC_CANARY_EVENT_NAME_V1),
  event_version: z.literal(1),
  aggregate: DomainAggregateRefV1Schema.extend({
    type: z.literal('system.async_canary'),
  }),
  payload: AsyncCanaryPayloadV1Schema,
})

export type AsyncCanaryPayloadV1 = z.infer<typeof AsyncCanaryPayloadV1Schema>
export type AsyncCanaryEventV1 = z.infer<typeof AsyncCanaryEventV1Schema>

export function parseAsyncCanaryEventV1(input: unknown): AsyncCanaryEventV1 {
  return parseContract({
    contract: 'AsyncCanaryEvent',
    version: 1,
    schema: AsyncCanaryEventV1Schema,
    input,
  })
}
