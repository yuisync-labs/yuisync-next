import { z } from 'zod'

import {
  ContractIdentifierSchema,
  ContractVersionV1Schema,
  CorrelationIdSchema,
  IsoDateTimeSchema,
  JsonScalarSchema,
} from './common'
import { parseContract } from './errors'

export const InboundChannelV1Schema = z.enum([
  'whatsapp',
  'webchat',
  'instagram',
  'email',
  'api',
  'unknown',
])

export const TextMessageContentV1Schema = z.strictObject({
  kind: z.literal('text'),
  text: z.string().trim().min(1).max(10_000),
})

export const MediaMessageContentV1Schema = z.strictObject({
  kind: z.literal('media'),
  media_type: z.enum(['image', 'audio', 'video', 'document', 'sticker']),
  media_id: ContractIdentifierSchema,
  mime_type: z.string().trim().min(1).max(160).nullable().optional(),
  caption: z.string().trim().min(1).max(2_000).nullable().optional(),
})

export const LocationMessageContentV1Schema = z.strictObject({
  kind: z.literal('location'),
  latitude: z.number().finite().min(-90).max(90),
  longitude: z.number().finite().min(-180).max(180),
  label: z.string().trim().min(1).max(240).nullable().optional(),
})

export const InboundMessageContentV1Schema = z.discriminatedUnion('kind', [
  TextMessageContentV1Schema,
  MediaMessageContentV1Schema,
  LocationMessageContentV1Schema,
])

export const InboundMessageV1Schema = z.strictObject({
  type: z.literal('inbound_message'),
  version: ContractVersionV1Schema,
  tenant_id: ContractIdentifierSchema,
  message_id: ContractIdentifierSchema,
  channel: InboundChannelV1Schema,
  sender_id: ContractIdentifierSchema,
  recipient_id: ContractIdentifierSchema.nullable().optional(),
  conversation_id: ContractIdentifierSchema.nullable().optional(),
  customer_id: ContractIdentifierSchema.nullable().optional(),
  correlation_id: CorrelationIdSchema.nullable().optional(),
  reply_to_message_id: ContractIdentifierSchema.nullable().optional(),
  received_at: IsoDateTimeSchema,
  content: InboundMessageContentV1Schema,
  attributes: z.record(z.string().min(1).max(80), JsonScalarSchema).optional(),
})

export type InboundMessageV1 = z.infer<typeof InboundMessageV1Schema>

export function parseInboundMessageV1(input: unknown): InboundMessageV1 {
  return parseContract({
    contract: 'InboundMessage',
    version: 1,
    schema: InboundMessageV1Schema,
    input,
  })
}
