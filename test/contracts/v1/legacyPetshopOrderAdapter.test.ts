import { describe, expect, it } from 'vitest'

import {
  LegacyContractAdapterError,
  adaptLegacyPetshopOperationV1,
} from '../../../server/infrastructure/adapters/contracts/index'

const context = {
  tenant_id: 'tenant-a',
  idempotency_key: 'tenant-a:operation-1',
  created_at: '2026-08-05T17:00:00-03:00',
  operation_id: 'operation-1',
} as const

describe('legacy petshop contract adapter', () => {
  it('converte retirada de produto sem introduzir campos de serviço', () => {
    const adapted = adaptLegacyPetshopOperationV1({
      customer_name: 'Vanessa',
      order_type: 'produto',
      items: [{
        product_id: 'product-1',
        name: 'Ração Premium',
        quantity: 2,
        unit_price: 30,
        upsell: false,
      }],
      payment_method: 'a_combinar',
      fulfillment_type: 'retirada',
      total: 60,
      scheduled_at: null,
    }, context)

    expect(adapted.type).toBe('product_order')
    expect(adapted.tenant_id).toBe('tenant-a')
    expect('scheduled_at' in adapted).toBe(false)
  })

  it('infere taxa de entrega sem alterar o total legado', () => {
    const adapted = adaptLegacyPetshopOperationV1({
      customer_name: 'Vanessa',
      order_type: 'produto',
      items: [{
        product_id: 'product-1',
        name: 'Ração Premium',
        quantity: 1,
        unit_price: 60,
        upsell: false,
      }],
      payment_method: 'pix',
      fulfillment_type: 'entrega',
      delivery_address: 'Rua das Flores, 123',
      delivery_neighborhood: 'Centro',
      delivery_city: 'Muriaé',
      delivery_reference: 'Portão azul',
      total: 68,
    }, context)

    expect(adapted.type).toBe('product_order')
    if (adapted.type === 'product_order' && adapted.fulfillment.type === 'delivery') {
      expect(adapted.fulfillment.fee).toBe(8)
      expect(adapted.fulfillment.address.number).toBe('123')
    }
  })

  it('converte banho com cliente levando o pet sem campos de pagamento', () => {
    const adapted = adaptLegacyPetshopOperationV1({
      customer_name: 'Fernando',
      pet_name: 'Adalto',
      species: 'dog',
      breed: 'Yorkshire Terrier',
      weight_kg: 4,
      order_type: 'banho_tosa',
      items: [{
        product_id: 'product-bath-small',
        service_id: 'service-bath-small',
        name: 'Banho Pet Porte Pequeno',
        quantity: 1,
        unit_price: 55,
        upsell: false,
      }],
      appointment_id: 'appointment-1',
      scheduled_at: '2026-08-06T14:00:00-03:00',
      service_type: 'banho_pequeno',
      service_label: 'Banho Pet Porte Pequeno',
      service_kind: 'banho',
      duration_min: 60,
      service_transport_customer_brings: true,
      service_transport_fee: 0,
      payment_method: null,
      fulfillment_type: 'servico',
      total: 55,
    }, context)

    expect(adapted.type).toBe('service_booking')
    if (adapted.type === 'service_booking') {
      expect(adapted.payment_status).toBe('a_receber')
      expect(adapted.transport?.type).toBe('customer_brings')
      expect('payment_method' in adapted).toBe(false)
    }
  })

  it('converte MotoDog preservando modalidade, taxa e endereço', () => {
    const adapted = adaptLegacyPetshopOperationV1({
      customer_name: 'Fernando',
      pet_name: 'Adalto',
      species: 'dog',
      breed: 'Yorkshire Terrier',
      weight_kg: 4,
      order_type: 'banho_tosa',
      items: [{
        service_id: 'service-bath-small',
        name: 'Banho Pet Porte Pequeno',
        quantity: 1,
        unit_price: 55,
        upsell: false,
      }],
      scheduled_at: '2026-08-06T14:00:00-03:00',
      service_type: 'banho_pequeno',
      service_label: 'Banho Pet Porte Pequeno',
      duration_min: 60,
      service_transport_mode: 'buscar_e_levar',
      service_transport_label: 'Buscar e levar',
      service_transport_fee: 18,
      service_transport_address: 'Avenida da Silva, 123',
      service_transport_neighborhood: 'Centro',
      service_transport_city: 'Muriaé',
      service_transport_reference: 'Ao lado da escola',
      total: 73,
    }, context)

    expect(adapted.type).toBe('service_booking')
    if (adapted.type === 'service_booking' && adapted.transport?.type === 'motodog') {
      expect(adapted.transport.option_id).toBe('buscar_e_levar')
      expect(adapted.transport.fee).toBe(18)
    }
  })

  it('converte consulta veterinária sem transporte PetBot', () => {
    const adapted = adaptLegacyPetshopOperationV1({
      customer_name: 'Vanessa',
      pet_name: 'Nina',
      species: 'cat',
      order_type: 'veterinaria',
      symptom: 'Está sem comer desde ontem',
      items: [{
        service_id: 'service-consultation',
        name: 'Consulta veterinária',
        quantity: 1,
        unit_price: 120,
        upsell: false,
      }],
      scheduled_at: '2026-08-06T15:00:00-03:00',
      service_type: 'consulta_veterinaria',
      service_label: 'Consulta veterinária',
      duration_min: 30,
      total: 120,
    }, context)

    expect(adapted.type).toBe('service_booking')
    if (adapted.type === 'service_booking') expect(adapted.transport).toBeNull()
  })

  it('falha de forma sanitizada para endereço ou tipo legado inválido', () => {
    expect(() => adaptLegacyPetshopOperationV1({
      customer_name: 'Vanessa',
      order_type: 'produto',
      items: [{ product_id: 'p1', name: 'Produto', quantity: 1, unit_price: 10 }],
      payment_method: 'pix',
      fulfillment_type: 'entrega',
      delivery_address: 'endereço sem número',
      delivery_neighborhood: 'Centro',
      delivery_city: 'Muriaé',
      delivery_reference: 'Referência',
      total: 10,
    }, context)).toThrow(LegacyContractAdapterError)

    expect(() => adaptLegacyPetshopOperationV1({
      order_type: 'desconhecido',
    }, context)).toThrow(LegacyContractAdapterError)
  })
})
