import { z } from 'zod'

import {
  ContractIdentifierSchema,
  ContractVersionV1Schema,
  IsoDateTimeSchema,
} from './common'
import { parseContract } from './errors'
import { ProductOrderV1Schema } from './productOrder'
import { ServiceBookingV1Schema } from './serviceBooking'

export const ConfirmableOperationV1Schema = z.union([
  ProductOrderV1Schema,
  ServiceBookingV1Schema,
])

export const PendingConfirmationV1Schema = z.strictObject({
  type: z.literal('pending_confirmation'),
  version: ContractVersionV1Schema,
  tenant_id: ContractIdentifierSchema,
  confirmation_id: ContractIdentifierSchema,
  idempotency_key: ContractIdentifierSchema,
  confirmation_fingerprint: z.string().trim().regex(/^[a-f0-9]{16,128}$/),
  status: z.enum(['pending', 'confirmed', 'cancelled', 'expired']),
  requested_at: IsoDateTimeSchema,
  expires_at: IsoDateTimeSchema.nullable().optional(),
  resolved_at: IsoDateTimeSchema.nullable().optional(),
  resolution_reason: z.string().trim().min(1).max(300).nullable().optional(),
  operation: ConfirmableOperationV1Schema,
}).superRefine((confirmation, context) => {
  if (confirmation.operation.tenant_id !== confirmation.tenant_id) {
    context.addIssue({
      code: 'custom',
      path: ['operation', 'tenant_id'],
      message: 'A operação deve pertencer ao mesmo tenant da confirmação.',
    })
  }

  if (confirmation.status === 'pending' && confirmation.resolved_at) {
    context.addIssue({
      code: 'custom',
      path: ['resolved_at'],
      message: 'Confirmação pendente não pode possuir resolução.',
    })
  }

  if (confirmation.status !== 'pending' && !confirmation.resolved_at) {
    context.addIssue({
      code: 'custom',
      path: ['resolved_at'],
      message: 'Confirmação finalizada exige data de resolução.',
    })
  }

  if (confirmation.status === 'cancelled' && !confirmation.resolution_reason) {
    context.addIssue({
      code: 'custom',
      path: ['resolution_reason'],
      message: 'Cancelamento exige motivo.',
    })
  }
})

export type PendingConfirmationV1 = z.infer<typeof PendingConfirmationV1Schema>

export function parsePendingConfirmationV1(input: unknown): PendingConfirmationV1 {
  return parseContract({
    contract: 'PendingConfirmation',
    version: 1,
    schema: PendingConfirmationV1Schema,
    input,
  })
}
