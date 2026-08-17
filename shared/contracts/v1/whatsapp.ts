import { z } from 'zod'

import {
  ContractIdentifierSchema,
  ContractVersionV1Schema,
  CorrelationIdSchema,
  IsoDateTimeSchema,
} from './common'
import { parseContract } from './errors'

export const WhatsAppConnectionStatusV1Schema = z.enum([
  'pending',
  'connected',
  'disabled',
])

export const WhatsAppMessageStatusV1Schema = z.enum([
  'queued',
  'submitted',
  'sent',
  'delivered',
  'read',
  'failed',
])

export const WhatsAppAccountConnectionV1Schema = z.strictObject({
  type: z.literal('whatsapp_account_connection'),
  version: ContractVersionV1Schema,
  tenant_id: ContractIdentifierSchema,
  business_id: ContractIdentifierSchema,
  waba_id: ContractIdentifierSchema,
  phone_number_id: ContractIdentifierSchema,
  display_phone_number: z.string().trim().min(1).max(80).nullable().optional(),
  verified_name: z.string().trim().min(1).max(200).nullable().optional(),
  status: WhatsAppConnectionStatusV1Schema,
})

export const IncomingWhatsAppMessageV1Schema = z.strictObject({
  type: z.literal('incoming_whatsapp_message'),
  version: ContractVersionV1Schema,
  tenant_id: ContractIdentifierSchema,
  waba_id: ContractIdentifierSchema,
  phone_number_id: ContractIdentifierSchema,
  message_id: ContractIdentifierSchema,
  from: ContractIdentifierSchema,
  timestamp: IsoDateTimeSchema,
  message_type: z.string().trim().min(1).max(80),
  text: z.string().trim().min(1).max(10_000).nullable().optional(),
  correlation_id: CorrelationIdSchema.nullable().optional(),
}).superRefine((value, context) => {
  if (value.message_type === 'text' && !value.text) {
    context.addIssue({
      code: 'custom',
      path: ['text'],
      message: 'text is required when message_type is text',
    })
  }
})

export const WhatsAppSendCommandV1Schema = z.strictObject({
  type: z.literal('whatsapp_send_command'),
  version: ContractVersionV1Schema,
  tenant_id: ContractIdentifierSchema,
  conversation_id: ContractIdentifierSchema,
  to: ContractIdentifierSchema,
  body: z.string().trim().min(1).max(10_000),
  idempotency_key: ContractIdentifierSchema,
  correlation_id: CorrelationIdSchema.nullable().optional(),
})

export const WhatsAppSendResultV1Schema = z.strictObject({
  type: z.literal('whatsapp_send_result'),
  version: ContractVersionV1Schema,
  tenant_id: ContractIdentifierSchema,
  conversation_id: ContractIdentifierSchema,
  idempotency_key: ContractIdentifierSchema,
  provider_message_id: ContractIdentifierSchema.nullable().optional(),
  status: WhatsAppMessageStatusV1Schema,
  occurred_at: IsoDateTimeSchema,
  correlation_id: CorrelationIdSchema.nullable().optional(),
  error_code: z.string().trim().min(1).max(160).nullable().optional(),
})

export type WhatsAppAccountConnectionV1 = z.infer<typeof WhatsAppAccountConnectionV1Schema>
export type IncomingWhatsAppMessageV1 = z.infer<typeof IncomingWhatsAppMessageV1Schema>
export type WhatsAppSendCommandV1 = z.infer<typeof WhatsAppSendCommandV1Schema>
export type WhatsAppSendResultV1 = z.infer<typeof WhatsAppSendResultV1Schema>
export type WhatsAppMessageStatusV1 = z.infer<typeof WhatsAppMessageStatusV1Schema>

export function parseWhatsAppAccountConnectionV1(input: unknown): WhatsAppAccountConnectionV1 {
  return parseContract({
    contract: 'WhatsAppAccountConnection',
    version: 1,
    schema: WhatsAppAccountConnectionV1Schema,
    input,
  })
}

export function parseIncomingWhatsAppMessageV1(input: unknown): IncomingWhatsAppMessageV1 {
  return parseContract({
    contract: 'IncomingWhatsAppMessage',
    version: 1,
    schema: IncomingWhatsAppMessageV1Schema,
    input,
  })
}

export function parseWhatsAppSendCommandV1(input: unknown): WhatsAppSendCommandV1 {
  return parseContract({
    contract: 'WhatsAppSendCommand',
    version: 1,
    schema: WhatsAppSendCommandV1Schema,
    input,
  })
}

export function parseWhatsAppSendResultV1(input: unknown): WhatsAppSendResultV1 {
  return parseContract({
    contract: 'WhatsAppSendResult',
    version: 1,
    schema: WhatsAppSendResultV1Schema,
    input,
  })
}
