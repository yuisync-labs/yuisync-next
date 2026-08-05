import { describe, expect, it } from 'vitest'

import {
  ContractValidationError,
  parseProductOrderV1,
} from '../../../shared/contracts/v1/index'

const pickupOrder = {
  type: 'product_order',
  version: 1,
  tenant_id: 'tenant-a',
  customer_name: 'Vanessa',
  idempotency_key: 'tenant-a:order-1',
  created_at: '2026-08-05T17:00:00-03:00',
  currency: 'BRL',
  items: [{
    product_id: 'product-1',
    name: 'Ração Premium',
    quantity: 2,
    unit_price: 30,
    upsell: false,
  }],
  payment: {
    method: 'a_combinar',
  },
  fulfillment: {
    type: 'pickup',
  },
  total: 60,
} as const

describe('ProductOrderV1', () => {
  it('aceita retirada com pagamento a combinar', () => {
    const parsed = parseProductOrderV1(pickupOrder)

    expect(parsed.total).toBe(60)
    expect(parsed.fulfillment.type).toBe('pickup')
    expect(JSON.parse(JSON.stringify(parsed))).toEqual(parsed)
  })

  it('aceita quantidade fracionada, entrega e troco válido', () => {
    const parsed = parseProductOrderV1({
      ...pickupOrder,
      items: [{
        product_id: 'product-weight',
        name: 'Ração a granel',
        quantity: 1.5,
        unit_price: 20,
        upsell: false,
      }],
      payment: {
        method: 'dinheiro',
        change_for: 50,
      },
      fulfillment: {
        type: 'delivery',
        fee: 8,
        address: {
          street: 'Rua das Flores',
          number: '123',
          neighborhood: 'Centro',
          city: 'Muriaé',
          state: 'mg',
          reference: 'Ao lado da escola',
        },
      },
      total: 38,
    })

    expect(parsed.fulfillment.type).toBe('delivery')
    if (parsed.fulfillment.type === 'delivery') {
      expect(parsed.fulfillment.address.state).toBe('MG')
    }
  })

  it('rejeita total divergente dos itens e da entrega', () => {
    expect(() => parseProductOrderV1({
      ...pickupOrder,
      total: 59.99,
    })).toThrow(ContractValidationError)
  })

  it('não permite pagamento antecipado na retirada', () => {
    expect(() => parseProductOrderV1({
      ...pickupOrder,
      payment: { method: 'pix' },
    })).toThrow(ContractValidationError)
  })

  it('não permite entrega sem forma definida nem troco fora de dinheiro', () => {
    expect(() => parseProductOrderV1({
      ...pickupOrder,
      payment: { method: 'a_combinar' },
      fulfillment: {
        type: 'delivery',
        fee: 0,
        address: {
          street: 'Rua A',
          number: '10',
          neighborhood: 'Centro',
          city: 'Muriaé',
          reference: 'Portão azul',
        },
      },
    })).toThrow(ContractValidationError)

    expect(() => parseProductOrderV1({
      ...pickupOrder,
      payment: {
        method: 'pix',
        change_for: 100,
      },
    })).toThrow(ContractValidationError)
  })

  it('rejeita campos de agenda e serviço no contrato de produto', () => {
    expect(() => parseProductOrderV1({
      ...pickupOrder,
      scheduled_at: '2026-08-06T14:00:00-03:00',
      pet_name: 'Nina',
    })).toThrow(ContractValidationError)
  })
})
