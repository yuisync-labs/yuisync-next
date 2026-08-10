import { describe, expect, it } from 'vitest'

import {
  ContractValidationError,
  parseServiceBookingV1,
} from '../../../shared/contracts/v1/index'

const groomingBooking = {
  type: 'service_booking',
  version: 1,
  tenant_id: 'tenant-a',
  customer_name: 'Fernando',
  idempotency_key: 'tenant-a:booking-1',
  created_at: '2026-08-05T17:00:00-03:00',
  scheduled_at: '2026-08-06T14:00:00-03:00',
  service_area: 'banho_tosa',
  pet: {
    name: 'Adalto',
    species: 'dog',
    breed: 'Yorkshire Terrier',
    weight_kg: 4,
  },
  service: {
    service_id: 'service-bath-small',
    product_id: 'product-bath-small',
    code: 'banho_pequeno',
    name: 'Banho Pet Porte Pequeno',
    kind: 'banho',
    regular_price: 55,
    charged_price: 55,
    duration_min: 60,
  },
  additional_services: [],
  transport: {
    type: 'customer_brings',
  },
  duration_min: 60,
  payment_status: 'a_receber',
  currency: 'BRL',
  total: 55,
} as const

describe('ServiceBookingV1', () => {
  it('aceita banho com raça, peso e cliente levando o pet', () => {
    const parsed = parseServiceBookingV1(groomingBooking)

    expect(parsed.payment_status).toBe('a_receber')
    expect(parsed.transport?.type).toBe('customer_brings')
    expect(JSON.parse(JSON.stringify(parsed))).toEqual(parsed)
  })

  it('aceita MotoDog e serviço adicional com total e duração derivados', () => {
    const parsed = parseServiceBookingV1({
      ...groomingBooking,
      additional_services: [{
        service_id: 'service-hydration',
        name: 'Hidratação',
        price: 20,
        duration_min: 15,
      }],
      transport: {
        type: 'motodog',
        option_id: 'buscar_e_levar',
        label: 'Buscar e levar',
        fee: 18,
        address: {
          street: 'Avenida da Silva',
          number: '123',
          neighborhood: 'Centro',
          city: 'Muriaé',
          reference: 'Ao lado da escola',
        },
      },
      duration_min: 75,
      total: 93,
    })

    expect(parsed.total).toBe(93)
    expect(parsed.duration_min).toBe(75)
  })

  it('aplica benefício somente ao serviço principal', () => {
    const parsed = parseServiceBookingV1({
      ...groomingBooking,
      service: {
        ...groomingBooking.service,
        charged_price: 0,
      },
      additional_services: [{
        service_id: 'service-hydration',
        name: 'Hidratação',
        price: 20,
        duration_min: 15,
      }],
      subscription_benefit: {
        subscription_id: 'subscription-1',
        plan_name: 'Clube Banho',
        service_type: 'banho',
        remaining_before_use: 2,
      },
      duration_min: 75,
      total: 20,
    })

    expect(parsed.service.regular_price).toBe(55)
    expect(parsed.service.charged_price).toBe(0)
    expect(parsed.total).toBe(20)
  })

  it('aceita consulta veterinária sem pagamento nem MotoDog', () => {
    const parsed = parseServiceBookingV1({
      ...groomingBooking,
      service_area: 'veterinaria',
      pet: {
        name: 'Nina',
        species: 'cat',
        breed: null,
        weight_kg: null,
      },
      service: {
        service_id: 'service-consultation',
        name: 'Consulta veterinária',
        kind: 'consulta',
        regular_price: 120,
        charged_price: 120,
        duration_min: 30,
      },
      symptom: 'Está sem comer desde ontem',
      transport: null,
      duration_min: 30,
      total: 120,
    })

    expect(parsed.service_area).toBe('veterinaria')
    expect(parsed.transport).toBeNull()
  })

  it('rejeita banho sem classificação ou decisão de transporte', () => {
    expect(() => parseServiceBookingV1({
      ...groomingBooking,
      pet: {
        name: 'Adalto',
        species: 'dog',
      },
      transport: null,
    })).toThrow(ContractValidationError)
  })

  it('rejeita consulta sem sintoma ou com MotoDog', () => {
    expect(() => parseServiceBookingV1({
      ...groomingBooking,
      service_area: 'veterinaria',
      symptom: null,
    })).toThrow(ContractValidationError)
  })

  it('rejeita total, duração e preço cobrado inconsistentes', () => {
    expect(() => parseServiceBookingV1({
      ...groomingBooking,
      total: 54,
    })).toThrow(ContractValidationError)

    expect(() => parseServiceBookingV1({
      ...groomingBooking,
      duration_min: 90,
    })).toThrow(ContractValidationError)

    expect(() => parseServiceBookingV1({
      ...groomingBooking,
      service: {
        ...groomingBooking.service,
        charged_price: 60,
      },
      total: 60,
    })).toThrow(ContractValidationError)
  })

  it('rejeita campos de pagamento e entrega de produto', () => {
    expect(() => parseServiceBookingV1({
      ...groomingBooking,
      payment_method: 'pix',
      change_for: 100,
      fulfillment_type: 'delivery',
    })).toThrow(ContractValidationError)
  })
})
