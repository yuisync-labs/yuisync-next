import { z } from 'zod'

import {
  ContractIdentifierSchema,
  ContractVersionV1Schema,
  IsoDateTimeSchema,
  JsonValueSchema,
} from './common'
import { parseContract } from './errors'

export const ToolErrorV1Schema = z.strictObject({
  code: z.string().trim().min(1).max(120),
  message: z.string().trim().min(1).max(500),
  retryable: z.boolean(),
  details: JsonValueSchema.nullable().optional(),
})

export const ToolResultV1Schema = z.strictObject({
  type: z.literal('tool_result'),
  version: ContractVersionV1Schema,
  tenant_id: ContractIdentifierSchema,
  tool_call_id: ContractIdentifierSchema,
  tool_name: z.string().trim().min(1).max(160),
  idempotency_key: ContractIdentifierSchema.nullable().optional(),
  status: z.enum(['success', 'error', 'retryable_error']),
  ok: z.boolean(),
  started_at: IsoDateTimeSchema,
  completed_at: IsoDateTimeSchema,
  duration_ms: z.number().int().nonnegative().max(86_400_000),
  data: JsonValueSchema.nullable().optional(),
  error: ToolErrorV1Schema.nullable().optional(),
}).superRefine((result, context) => {
  if (Date.parse(result.completed_at) < Date.parse(result.started_at)) {
    context.addIssue({
      code: 'custom',
      path: ['completed_at'],
      message: 'Conclusão não pode ocorrer antes do início.',
    })
  }

  if (result.status === 'success') {
    if (!result.ok) {
      context.addIssue({
        code: 'custom',
        path: ['ok'],
        message: 'Resultado de sucesso deve possuir ok verdadeiro.',
      })
    }
    if (result.error) {
      context.addIssue({
        code: 'custom',
        path: ['error'],
        message: 'Resultado de sucesso não pode possuir erro.',
      })
    }
  } else {
    if (result.ok) {
      context.addIssue({
        code: 'custom',
        path: ['ok'],
        message: 'Resultado de erro deve possuir ok falso.',
      })
    }
    if (!result.error) {
      context.addIssue({
        code: 'custom',
        path: ['error'],
        message: 'Resultado de erro exige descrição sanitizada.',
      })
    }
  }

  if (result.status === 'retryable_error' && result.error?.retryable !== true) {
    context.addIssue({
      code: 'custom',
      path: ['error', 'retryable'],
      message: 'Erro marcado para retry deve ser explicitamente recuperável.',
    })
  }

  if (result.status === 'error' && result.error?.retryable === true) {
    context.addIssue({
      code: 'custom',
      path: ['error', 'retryable'],
      message: 'Erro recuperável deve usar o status retryable_error.',
    })
  }
})

export type ToolResultV1 = z.infer<typeof ToolResultV1Schema>

export function parseToolResultV1(input: unknown): ToolResultV1 {
  return parseContract({
    contract: 'ToolResult',
    version: 1,
    schema: ToolResultV1Schema,
    input,
  })
}
