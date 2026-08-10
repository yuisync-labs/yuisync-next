import {
  parseServiceBookingV1,
  type ServiceBookingV1,
} from '../../../../shared/contracts/v1/index'
import type { LegacyPetshopAdapterContext } from './legacyProductOrderAdapter'
import {
  LegacyContractAdapterError,
  array,
  finiteNumber,
  inferServiceKind,
  nullableText,
  record,
  requiredText,
  splitLegacyAddress,
  text,
} from './legacyAdapterHelpers'

export function adaptLegacyServiceBookingV1(
  legacyInput: unknown,
  context: LegacyPetshopAdapterContext,
): ServiceBookingV1 {
  const legacy = record(legacyInput)
  const legacyItems = array(legacy.items).map((item, index) => record(item, `items[${index}]`))
  const mainItem = legacyItems.find((item) => item.upsell !== true) ?? legacyItems[0]
  if (!mainItem) {
    throw new LegacyContractAdapterError('items', 'Serviço principal ausente no formato legado.')
  }

  const serviceArea = requiredText(legacy.order_type, 'order_type')
  if (serviceArea !== 'banho_tosa' && serviceArea !== 'veterinaria') {
    throw new LegacyContractAdapterError('order_type', 'Área de serviço legada desconhecida.')
  }

  const mainChargedPrice = finiteNumber(mainItem.unit_price, 'items[main].unit_price')
  const additionalServices = legacyItems
    .filter((item) => item !== mainItem && item.upsell === true)
    .map((item, index) => ({
      service_id: requiredText(item.service_id ?? item.product_id, `additional_services[${index}].service_id`),
      product_id: nullableText(item.product_id),
      name: requiredText(item.name, `additional_services[${index}].name`),
      price: finiteNumber(item.unit_price, `additional_services[${index}].unit_price`),
      duration_min: finiteNumber(item.duration_min, `additional_services[${index}].duration_min`, 0),
    }))

  const customerBrings = legacy.service_transport_customer_brings === true
  const transportFee = finiteNumber(legacy.service_transport_fee, 'service_transport_fee', 0)
  let transport = null

  if (serviceArea === 'banho_tosa') {
    if (customerBrings || (!text(legacy.service_transport_mode) && transportFee === 0)) {
      transport = { type: 'customer_brings' as const }
    } else {
      const address = splitLegacyAddress(legacy.service_transport_address, 'service_transport_address')
      transport = {
        type: 'motodog' as const,
        option_id: requiredText(legacy.service_transport_mode, 'service_transport_mode'),
        label: requiredText(legacy.service_transport_label, 'service_transport_label'),
        fee: transportFee,
        address: {
          ...address,
          neighborhood: requiredText(legacy.service_transport_neighborhood, 'service_transport_neighborhood'),
          city: requiredText(legacy.service_transport_city, 'service_transport_city'),
          reference: requiredText(legacy.service_transport_reference, 'service_transport_reference'),
        },
      }
    }
  }

  let subscriptionBenefit = null
  if (legacy.subscription_benefit) {
    const benefit = record(legacy.subscription_benefit, 'subscription_benefit')
    subscriptionBenefit = {
      subscription_id: requiredText(benefit.subscription_id, 'subscription_benefit.subscription_id'),
      plan_name: nullableText(benefit.plan_name),
      service_type: requiredText(benefit.service_type, 'subscription_benefit.service_type'),
      remaining_before_use: finiteNumber(benefit.remaining, 'subscription_benefit.remaining'),
    }
  }

  return parseServiceBookingV1({
    type: 'service_booking',
    version: 1,
    tenant_id: context.tenant_id,
    booking_id: context.operation_id ?? nullableText(legacy.order_id),
    appointment_id: nullableText(legacy.appointment_id),
    customer_id: nullableText(legacy.customer_id),
    customer_name: requiredText(legacy.customer_name, 'customer_name'),
    idempotency_key: context.idempotency_key,
    created_at: context.created_at,
    scheduled_at: requiredText(legacy.scheduled_at, 'scheduled_at'),
    service_area: serviceArea,
    pet: {
      pet_id: nullableText(legacy.pet_id),
      name: requiredText(legacy.pet_name, 'pet_name'),
      species: requiredText(legacy.species, 'species'),
      breed: nullableText(legacy.breed),
      size: nullableText(legacy.size),
      weight_kg: legacy.weight_kg == null ? null : finiteNumber(legacy.weight_kg, 'weight_kg'),
    },
    service: {
      service_id: requiredText(
        mainItem.service_id ?? legacy.service_type ?? mainItem.product_id,
        'items[main].service_id',
      ),
      product_id: nullableText(mainItem.product_id ?? legacy.service_product_id),
      code: nullableText(legacy.service_type),
      name: requiredText(legacy.service_label ?? mainItem.name, 'service_label'),
      kind: inferServiceKind(legacy.service_kind ?? legacy.service_type ?? mainItem.name),
      regular_price: finiteNumber(legacy.regular_service_price, 'regular_service_price', mainChargedPrice),
      charged_price: mainChargedPrice,
      duration_min: finiteNumber(
        legacy.main_service_duration_min ?? mainItem.duration_min ?? legacy.duration_min,
        'service.duration_min',
      ),
    },
    additional_services: additionalServices,
    subscription_benefit: subscriptionBenefit,
    symptom: nullableText(legacy.symptom),
    transport,
    notes: nullableText(legacy.notes),
    duration_min: finiteNumber(legacy.duration_min, 'duration_min'),
    payment_status: 'a_receber',
    currency: 'BRL',
    total: finiteNumber(legacy.total, 'total'),
  })
}
