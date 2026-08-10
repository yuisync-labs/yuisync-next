import { z } from 'zod'

import {
  AddressV1Schema,
  ContractIdentifierSchema,
  ContractVersionV1Schema,
  DisplayNameSchema,
  IsoDateTimeSchema,
  MoneySchema,
  OptionalNoteSchema,
  moneyToCents,
} from './common'
import { parseContract } from './errors'

export const ServicePetV1Schema = z.strictObject({
  pet_id: ContractIdentifierSchema.nullable().optional(),
  name: DisplayNameSchema,
  species: z.enum(['dog', 'cat', 'other']),
  breed: z.string().trim().min(1).max(100).nullable().optional(),
  size: z.string().trim().min(1).max(60).nullable().optional(),
  weight_kg: z.number().finite().positive().max(300).nullable().optional(),
})

export const BookedServiceV1Schema = z.strictObject({
  service_id: ContractIdentifierSchema,
  product_id: ContractIdentifierSchema.nullable().optional(),
  code: z.string().trim().min(1).max(120).nullable().optional(),
  name: DisplayNameSchema,
  kind: z.enum([
    'banho',
    'tosa',
    'banho_e_tosa',
    'consulta',
    'vacina',
    'exame',
    'outro',
  ]),
  regular_price: MoneySchema,
  charged_price: MoneySchema,
  duration_min: z.number().int().min(15).max(1_440),
})

export const AdditionalServiceV1Schema = z.strictObject({
  service_id: ContractIdentifierSchema,
  product_id: ContractIdentifierSchema.nullable().optional(),
  name: DisplayNameSchema,
  price: MoneySchema,
  duration_min: z.number().int().min(0).max(1_440),
})

export const CustomerBringsPetV1Schema = z.strictObject({
  type: z.literal('customer_brings'),
})

export const MotodogTransportV1Schema = z.strictObject({
  type: z.literal('motodog'),
  option_id: ContractIdentifierSchema,
  label: DisplayNameSchema,
  fee: MoneySchema,
  address: AddressV1Schema,
})

export const ServiceTransportV1Schema = z.discriminatedUnion('type', [
  CustomerBringsPetV1Schema,
  MotodogTransportV1Schema,
])

export const SubscriptionBenefitV1Schema = z.strictObject({
  subscription_id: ContractIdentifierSchema,
  plan_name: DisplayNameSchema.nullable().optional(),
  service_type: ContractIdentifierSchema,
  remaining_before_use: z.number().int().positive(),
})

export const ServiceBookingV1Schema = z.strictObject({
  type: z.literal('service_booking'),
  version: ContractVersionV1Schema,
  tenant_id: ContractIdentifierSchema,
  booking_id: ContractIdentifierSchema.nullable().optional(),
  appointment_id: ContractIdentifierSchema.nullable().optional(),
  customer_id: ContractIdentifierSchema.nullable().optional(),
  customer_name: DisplayNameSchema,
  idempotency_key: ContractIdentifierSchema,
  created_at: IsoDateTimeSchema,
  scheduled_at: IsoDateTimeSchema,
  service_area: z.enum(['banho_tosa', 'veterinaria']),
  pet: ServicePetV1Schema,
  service: BookedServiceV1Schema,
  additional_services: z.array(AdditionalServiceV1Schema).max(20).default([]),
  subscription_benefit: SubscriptionBenefitV1Schema.nullable().optional(),
  symptom: z.string().trim().min(1).max(300).nullable().optional(),
  transport: ServiceTransportV1Schema.nullable().optional(),
  notes: OptionalNoteSchema,
  duration_min: z.number().int().min(15).max(2_880),
  payment_status: z.literal('a_receber'),
  currency: z.literal('BRL'),
  total: MoneySchema,
}).superRefine((booking, context) => {
  const transportFee = booking.transport?.type === 'motodog'
    ? booking.transport.fee
    : 0
  const expectedTotal = booking.additional_services.reduce(
    (sum, item) => sum + moneyToCents(item.price),
    moneyToCents(booking.service.charged_price) + moneyToCents(transportFee),
  )
  const expectedDuration = booking.additional_services.reduce(
    (sum, item) => sum + item.duration_min,
    booking.service.duration_min,
  )

  if (moneyToCents(booking.total) !== expectedTotal) {
    context.addIssue({
      code: 'custom',
      path: ['total'],
      message: 'Total não corresponde ao serviço, adicionais e transporte.',
    })
  }

  if (booking.duration_min !== expectedDuration) {
    context.addIssue({
      code: 'custom',
      path: ['duration_min'],
      message: 'Duração não corresponde ao serviço e adicionais.',
    })
  }

  if (moneyToCents(booking.service.charged_price) > moneyToCents(booking.service.regular_price)) {
    context.addIssue({
      code: 'custom',
      path: ['service', 'charged_price'],
      message: 'Preço cobrado não pode exceder o preço regular.',
    })
  }

  if (booking.subscription_benefit && moneyToCents(booking.service.charged_price) !== 0) {
    context.addIssue({
      code: 'custom',
      path: ['service', 'charged_price'],
      message: 'Benefício aplicado deve zerar somente o serviço principal.',
    })
  }

  if (booking.service_area === 'banho_tosa') {
    if (!booking.pet.breed) {
      context.addIssue({
        code: 'custom',
        path: ['pet', 'breed'],
        message: 'Banho e tosa exigem raça do pet.',
      })
    }
    if (!booking.pet.weight_kg) {
      context.addIssue({
        code: 'custom',
        path: ['pet', 'weight_kg'],
        message: 'Banho e tosa exigem peso do pet.',
      })
    }
    if (!booking.transport) {
      context.addIssue({
        code: 'custom',
        path: ['transport'],
        message: 'Banho e tosa exigem decisão de chegada do pet.',
      })
    }
  }

  if (booking.service_area === 'veterinaria') {
    if (!booking.symptom) {
      context.addIssue({
        code: 'custom',
        path: ['symptom'],
        message: 'Atendimento veterinário exige o problema principal.',
      })
    }
    if (booking.transport) {
      context.addIssue({
        code: 'custom',
        path: ['transport'],
        message: 'Transporte PetBot não faz parte do contrato veterinário.',
      })
    }
  }
})

export type ServiceBookingV1 = z.infer<typeof ServiceBookingV1Schema>

export function parseServiceBookingV1(input: unknown): ServiceBookingV1 {
  return parseContract({
    contract: 'ServiceBooking',
    version: 1,
    schema: ServiceBookingV1Schema,
    input,
  })
}
