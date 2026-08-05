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

export const DisplayNameSchema = z.string()
  .trim()
  .min(1)
  .max(200)

export const OptionalNoteSchema = z.string()
  .trim()
  .min(1)
  .max(500)
  .nullable()
  .optional()

export const MoneySchema = z.number()
  .finite()
  .nonnegative()
  .max(99_999_999.99)

export const PositiveQuantitySchema = z.number()
  .finite()
  .positive()
  .max(1_000_000)

export const AddressV1Schema = z.strictObject({
  street: z.string().trim().min(1).max(200),
  number: z.string().trim().min(1).max(40),
  complement: z.string().trim().min(1).max(120).nullable().optional(),
  neighborhood: z.string().trim().min(1).max(100),
  city: z.string().trim().min(1).max(100),
  state: z.string().trim().length(2).toUpperCase().nullable().optional(),
  postal_code: z.string().trim().min(3).max(20).nullable().optional(),
  reference: z.string().trim().min(1).max(160),
})

export const JsonScalarSchema = z.union([
  z.string(),
  z.number().finite(),
  z.boolean(),
  z.null(),
])

export function moneyToCents(value: number): number {
  return Math.round(value * 100)
}

export type AddressV1 = z.infer<typeof AddressV1Schema>
export type JsonScalar = z.infer<typeof JsonScalarSchema>
