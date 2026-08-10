import { z } from 'zod'

import {
  ContractIdentifierSchema,
  ContractVersionV1Schema,
  CorrelationIdSchema,
} from './common'
import { parseContract } from './errors'

export const TenantContextSourceV1Schema = z.enum([
  'http',
  'webhook',
  'queue',
  'workflow',
  'scheduled_task',
  'test',
])

export const TenantActorV1Schema = z.strictObject({
  type: z.enum(['system', 'user', 'customer', 'service_account']),
  id: ContractIdentifierSchema.nullable(),
})

export const TenantContextV1Schema = z.strictObject({
  type: z.literal('tenant_context'),
  version: ContractVersionV1Schema,
  tenant_id: ContractIdentifierSchema,
  correlation_id: CorrelationIdSchema,
  request_id: ContractIdentifierSchema.nullable().optional(),
  source: TenantContextSourceV1Schema,
  actor: TenantActorV1Schema.nullable().optional(),
})

export type TenantContextV1 = z.infer<typeof TenantContextV1Schema>

export function parseTenantContextV1(input: unknown): TenantContextV1 {
  return parseContract({
    contract: 'TenantContext',
    version: 1,
    schema: TenantContextV1Schema,
    input,
  })
}
