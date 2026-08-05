import { z } from 'zod'

export const ContractVersionV1Schema = z.literal(1)

export const ContractIdentifierSchema = z.string()
  .trim()
  .min(1)
  .max(128)

export const CorrelationIdSchema = z.string()
  .trim()
  .min(1)
  .max(160)

export const IsoDateTimeSchema = z.string()
  .datetime({ offset: true })

export const NullableIdentifierSchema = ContractIdentifierSchema.nullable()

export const JsonScalarSchema = z.union([
  z.string(),
  z.number().finite(),
  z.boolean(),
  z.null(),
])

export type JsonScalar = z.infer<typeof JsonScalarSchema>
