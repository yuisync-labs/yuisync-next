import { z } from 'zod'

import { ContractIdentifierSchema } from './common'
import { DomainAggregateRefV1Schema, DomainEventEnvelopeV1Schema } from './domainEvent'
import { parseContract } from './errors'

export const LUNA_MESSAGE_RECEIVED_EVENT_NAME_V1 = 'luna.message.received.v1' as const

export const LunaMessageReceivedPayloadV1Schema = z.strictObject({
  module_id: z.literal('petshop'),
  conversation_id: ContractIdentifierSchema,
  source_message_id: ContractIdentifierSchema,
  channel: z.literal('whatsapp'),
  customer_address: z.string().trim().regex(/^\d{8,20}$/),
  phone_number_id: ContractIdentifierSchema,
})

export const LunaMessageReceivedEventV1Schema = DomainEventEnvelopeV1Schema.extend({
  event_name: z.literal(LUNA_MESSAGE_RECEIVED_EVENT_NAME_V1),
  event_version: z.literal(1),
  aggregate: DomainAggregateRefV1Schema.extend({
    type: z.literal('luna.conversation'),
  }),
  payload: LunaMessageReceivedPayloadV1Schema,
})

export type LunaMessageReceivedPayloadV1 = z.infer<typeof LunaMessageReceivedPayloadV1Schema>
export type LunaMessageReceivedEventV1 = z.infer<typeof LunaMessageReceivedEventV1Schema>

export function parseLunaMessageReceivedEventV1(input: unknown): LunaMessageReceivedEventV1 {
  return parseContract({
    contract: 'LunaMessageReceivedEvent',
    version: 1,
    schema: LunaMessageReceivedEventV1Schema,
    input,
  })
}
