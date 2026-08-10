import {
  parseProductOrderV1,
  type ProductOrderV1,
} from '../../../../shared/contracts/v1/index'
import {
  LegacyContractAdapterError,
  array,
  finiteNumber,
  nullableText,
  record,
  requiredText,
  splitLegacyAddress,
} from './legacyAdapterHelpers'

export type LegacyPetshopAdapterContext = Readonly<{
  tenant_id: string
  idempotency_key: string
  created_at: string
  operation_id?: string | null
}>

export function adaptLegacyProductOrderV1(
  legacyInput: unknown,
  context: LegacyPetshopAdapterContext,
): ProductOrderV1 {
  const legacy = record(legacyInput)
  const items = array(legacy.items).map((rawItem, index) => {
    const item = record(rawItem, `items[${index}]`)
    return {
      product_id: requiredText(item.product_id, `items[${index}].product_id`),
      name: requiredText(item.name, `items[${index}].name`),
      quantity: finiteNumber(item.quantity, `items[${index}].quantity`),
      unit_price: finiteNumber(item.unit_price, `items[${index}].unit_price`),
      upsell: item.upsell === true,
    }
  })

  const subtotal = items.reduce((sum, item) => sum + item.quantity * item.unit_price, 0)
  const total = finiteNumber(legacy.total, 'total')
  const fulfillmentType = requiredText(legacy.fulfillment_type, 'fulfillment_type')

  let fulfillment
  if (fulfillmentType === 'entrega') {
    const address = splitLegacyAddress(legacy.delivery_address, 'delivery_address')
    fulfillment = {
      type: 'delivery' as const,
      address: {
        ...address,
        neighborhood: requiredText(legacy.delivery_neighborhood, 'delivery_neighborhood'),
        city: requiredText(legacy.delivery_city, 'delivery_city'),
        reference: requiredText(legacy.delivery_reference, 'delivery_reference'),
      },
      fee: Math.max(0, Number((total - subtotal).toFixed(2))),
    }
  } else if (fulfillmentType === 'retirada') {
    fulfillment = { type: 'pickup' as const }
  } else {
    throw new LegacyContractAdapterError('fulfillment_type', 'Modalidade legada desconhecida.')
  }

  return parseProductOrderV1({
    type: 'product_order',
    version: 1,
    tenant_id: context.tenant_id,
    order_id: context.operation_id ?? nullableText(legacy.order_id),
    customer_id: nullableText(legacy.customer_id),
    customer_name: requiredText(legacy.customer_name, 'customer_name'),
    idempotency_key: context.idempotency_key,
    created_at: context.created_at,
    currency: 'BRL',
    items,
    payment: {
      method: requiredText(legacy.payment_method, 'payment_method'),
      change_for: legacy.change_for == null ? null : finiteNumber(legacy.change_for, 'change_for'),
    },
    fulfillment,
    notes: nullableText(legacy.notes),
    total,
  })
}
