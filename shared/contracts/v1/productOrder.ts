import { z } from 'zod'

import {
  AddressV1Schema,
  ContractIdentifierSchema,
  ContractVersionV1Schema,
  DisplayNameSchema,
  IsoDateTimeSchema,
  MoneySchema,
  OptionalNoteSchema,
  PositiveQuantitySchema,
  moneyToCents,
} from './common'
import { parseContract } from './errors'

export const ProductOrderItemV1Schema = z.strictObject({
  product_id: ContractIdentifierSchema,
  name: DisplayNameSchema,
  quantity: PositiveQuantitySchema,
  unit_price: MoneySchema,
  upsell: z.boolean().default(false),
})

export const ProductPaymentV1Schema = z.strictObject({
  method: z.enum(['pix', 'dinheiro', 'cartao', 'a_combinar']),
  change_for: MoneySchema.nullable().optional(),
})

export const ProductPickupV1Schema = z.strictObject({
  type: z.literal('pickup'),
})

export const ProductDeliveryV1Schema = z.strictObject({
  type: z.literal('delivery'),
  address: AddressV1Schema,
  fee: MoneySchema,
})

export const ProductFulfillmentV1Schema = z.discriminatedUnion('type', [
  ProductPickupV1Schema,
  ProductDeliveryV1Schema,
])

export const ProductOrderV1Schema = z.strictObject({
  type: z.literal('product_order'),
  version: ContractVersionV1Schema,
  tenant_id: ContractIdentifierSchema,
  order_id: ContractIdentifierSchema.nullable().optional(),
  customer_id: ContractIdentifierSchema.nullable().optional(),
  customer_name: DisplayNameSchema,
  idempotency_key: ContractIdentifierSchema,
  created_at: IsoDateTimeSchema,
  currency: z.literal('BRL'),
  items: z.array(ProductOrderItemV1Schema).min(1).max(100),
  payment: ProductPaymentV1Schema,
  fulfillment: ProductFulfillmentV1Schema,
  notes: OptionalNoteSchema,
  total: MoneySchema,
}).superRefine((order, context) => {
  const deliveryFee = order.fulfillment.type === 'delivery'
    ? order.fulfillment.fee
    : 0
  const expectedTotal = order.items.reduce(
    (sum, item) => sum + moneyToCents(item.quantity * item.unit_price),
    moneyToCents(deliveryFee),
  )

  if (moneyToCents(order.total) !== expectedTotal) {
    context.addIssue({
      code: 'custom',
      path: ['total'],
      message: 'Total não corresponde aos itens e à entrega.',
    })
  }

  if (order.fulfillment.type === 'pickup' && order.payment.method !== 'a_combinar') {
    context.addIssue({
      code: 'custom',
      path: ['payment', 'method'],
      message: 'Retirada deve permanecer com pagamento a combinar.',
    })
  }

  if (order.fulfillment.type === 'delivery' && order.payment.method === 'a_combinar') {
    context.addIssue({
      code: 'custom',
      path: ['payment', 'method'],
      message: 'Entrega exige uma forma de pagamento definida.',
    })
  }

  if (order.payment.method !== 'dinheiro' && order.payment.change_for != null) {
    context.addIssue({
      code: 'custom',
      path: ['payment', 'change_for'],
      message: 'Troco só pode ser informado para dinheiro.',
    })
  }

  if (
    order.payment.method === 'dinheiro'
    && order.payment.change_for != null
    && moneyToCents(order.payment.change_for) < moneyToCents(order.total)
  ) {
    context.addIssue({
      code: 'custom',
      path: ['payment', 'change_for'],
      message: 'Valor para troco não pode ser menor que o total.',
    })
  }
})

export type ProductOrderV1 = z.infer<typeof ProductOrderV1Schema>

export function parseProductOrderV1(input: unknown): ProductOrderV1 {
  return parseContract({
    contract: 'ProductOrder',
    version: 1,
    schema: ProductOrderV1Schema,
    input,
  })
}
