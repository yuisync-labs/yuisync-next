import type {
  ProductOrderV1,
  ServiceBookingV1,
} from '../../../../shared/contracts/v1/index'
import {
  LegacyContractAdapterError,
  record,
  requiredText,
} from './legacyAdapterHelpers'
import {
  adaptLegacyProductOrderV1,
  type LegacyPetshopAdapterContext,
} from './legacyProductOrderAdapter'
import { adaptLegacyServiceBookingV1 } from './legacyServiceBookingAdapter'

export {
  LegacyContractAdapterError,
  adaptLegacyProductOrderV1,
  adaptLegacyServiceBookingV1,
}
export type { LegacyPetshopAdapterContext }

export function adaptLegacyPetshopOperationV1(
  input: unknown,
  context: LegacyPetshopAdapterContext,
): ProductOrderV1 | ServiceBookingV1 {
  const legacy = record(input)
  const orderType = requiredText(legacy.order_type, 'order_type')

  if (orderType === 'produto') return adaptLegacyProductOrderV1(legacy, context)
  if (orderType === 'banho_tosa' || orderType === 'veterinaria') {
    return adaptLegacyServiceBookingV1(legacy, context)
  }

  throw new LegacyContractAdapterError('order_type', 'Tipo de operação legado desconhecido.')
}
