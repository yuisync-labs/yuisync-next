import { describe, expect, it } from 'vitest'
import {
  normalizeCheckoutFulfillment,
  normalizeCheckoutPaymentMethod,
  normalizeCheckoutPayments,
  normalizeCheckoutPayload,
  normalizeCheckoutSource,
} from '../src/checkoutApi'

const basePayload = {
  tenantId: 'tenant-1',
  moduleId: 'petshop',
  idempotencyKey: 'sale-1',
  paymentMethod: 'pix',
  items: [{ productId: 'product-1', quantity: 1 }],
}

describe('native PDV checkout', () => {
  it('normalizes legacy frontend enum values to canonical D1 values', () => {
    expect(normalizeCheckoutSource('pdv')).toBe('pos')
    expect(normalizeCheckoutSource('whatsapp')).toBe('whatsapp')
    expect(normalizeCheckoutSource('unknown')).toBe('manual')

    expect(normalizeCheckoutFulfillment('balcao')).toBe('counter')
    expect(normalizeCheckoutFulfillment('entrega')).toBe('delivery')
    expect(normalizeCheckoutFulfillment('serviço')).toBe('service')

    expect(normalizeCheckoutPaymentMethod('PIX')).toBe('pix')
    expect(normalizeCheckoutPaymentMethod('dinheiro')).toBe('cash')
    expect(normalizeCheckoutPaymentMethod('cartão de crédito')).toBe('card')
    expect(normalizeCheckoutPaymentMethod('débito')).toBe('card')
    expect(normalizeCheckoutPaymentMethod('boleto')).toBeNull()
  })

  it('merges duplicate cart products and keeps milliunit precision', () => {
    const payload = normalizeCheckoutPayload({
      ...basePayload,
      source: 'pdv',
      fulfillmentType: 'entrega',
      discount: 1.25,
      deliveryFee: 3.5,
      items: [
        { productId: 'product-1', quantity: 1.25 },
        { productId: 'product-1', quantity: 0.75, upsell: true },
        { productId: 'product-2', quantity: 2 },
      ],
    })

    expect(payload.source).toBe('pos')
    expect(payload.fulfillmentType).toBe('delivery')
    expect(payload.discountCents).toBe(125)
    expect(payload.transportFeeCents).toBe(350)
    expect(payload.operationKey).toBe('pdv:sale-1')
    expect(payload.items).toEqual([
      { productId: 'product-1', quantity: 2, quantityMilliunits: 2000, upsell: true },
      { productId: 'product-2', quantity: 2, quantityMilliunits: 2000, upsell: false },
    ])
  })

  it('requires a non-empty cart, positive quantities and idempotency', () => {
    expect(() => normalizeCheckoutPayload({ ...basePayload, items: [] })).toThrow('EMPTY_CART')
    expect(() => normalizeCheckoutPayload({ ...basePayload, items: [{ productId: 'p1', quantity: 0 }] })).toThrow('INVALID_CART_ITEM')
    expect(() => normalizeCheckoutPayload({ ...basePayload, idempotencyKey: '' })).toThrow('IDEMPOTENCY_REQUIRED')
    expect(() => normalizeCheckoutPayload({ ...basePayload, discount: -1 })).toThrow('INVALID_DISCOUNT')
  })

  it('accepts exact split payments and maps them to canonical methods', () => {
    const payload = normalizeCheckoutPayload({
      ...basePayload,
      paymentMethod: null,
      paymentSplits: [
        { method: 'pix', amount: 7.5 },
        { method: 'dinheiro', amount: 2.5 },
      ],
    })

    expect(normalizeCheckoutPayments(payload, 1000)).toEqual([
      { method: 'pix', amountCents: 750 },
      { method: 'cash', amountCents: 250 },
    ])
  })

  it('rejects payment splits that do not equal the sale total', () => {
    const payload = normalizeCheckoutPayload({
      ...basePayload,
      paymentSplits: [{ method: 'pix', amount: 9.99 }],
    })

    expect(() => normalizeCheckoutPayments(payload, 1000)).toThrow('PAYMENT_TOTAL_MISMATCH')
  })

  it('uses the single payment method when there are no splits', () => {
    const payload = normalizeCheckoutPayload({
      ...basePayload,
      paymentMethod: 'cartao credito',
    })

    expect(normalizeCheckoutPayments(payload, 1234)).toEqual([
      { method: 'card', amountCents: 1234 },
    ])
  })

  it('does not create payment rows for a zero-total sale', () => {
    const payload = normalizeCheckoutPayload({
      ...basePayload,
      paymentMethod: null,
    })

    expect(normalizeCheckoutPayments(payload, 0)).toEqual([])
  })
})
