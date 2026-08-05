import { z } from 'zod'

import {
  ContractIdentifierSchema,
  ContractVersionV1Schema,
  CorrelationIdSchema,
  IsoDateTimeSchema,
  JsonScalarSchema,
  JsonValueSchema,
} from './common'
import { parseContract } from './errors'

export const DomainAggregateRefV1Schema = z.strictObject({
  type: z.string().trim().regex(/^[a-z][a-z0-9_.-]{1,119}$/),
  id: ContractIdentifierSchema,
  version: z.number().int().nonnegative(),
})

export const DomainEventEnvelopeV1Schema = z.strictObject({
  type: z.literal('domain_event'),
  version: ContractVersionV1Schema,
  event_id: ContractIdentifierSchema,
  event_name: z.string().trim().regex(/^[a-z][a-z0-9_.-]{2,159}$/),
  event_version: z.number().int().positive().max(1_000),
  tenant_id: ContractIdentifierSchema,
  aggregate: DomainAggregateRefV1Schema,
  occurred_at: IsoDateTimeSchema,
  correlation_id: CorrelationIdSchema,
  causation_id: ContractIdentifierSchema.nullable().optional(),
  idempotency_key: ContractIdentifierSchema,
  payload: JsonValueSchema,
  metadata: z.record(
    z.string().min(1).max(80),
    JsonScalarSchema,
  ).optional(),
})

export type DomainEventEnvelopeV1 = z.infer<typeof DomainEventEnvelopeV1Schema>

export function parseDomainEventEnvelopeV1(input: unknown): DomainEventEnvelopeV1 {
  return parseContract({
    contract: 'DomainEventEnvelope',
    version: 1,
    schema: DomainEventEnvelopeV1Schema,
    input,
  })
}
