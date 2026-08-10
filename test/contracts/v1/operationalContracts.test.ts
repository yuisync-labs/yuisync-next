import { describe, expect, it } from 'vitest'

import {
  ContractValidationError,
  parseDomainEventEnvelopeV1,
  parsePendingConfirmationV1,
  parseToolResultV1,
} from '../../../shared/contracts/v1/index'

const productOperation = {
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
    quantity: 1,
    unit_price: 60,
    upsell: false,
  }],
  payment: { method: 'a_combinar' },
  fulfillment: { type: 'pickup' },
  total: 60,
} as const

describe('PendingConfirmationV1', () => {
  const pending = {
    type: 'pending_confirmation',
    version: 1,
    tenant_id: 'tenant-a',
    confirmation_id: 'confirmation-1',
    idempotency_key: 'tenant-a:confirmation-1',
    confirmation_fingerprint: 'abcdef0123456789abcd1234',
    status: 'pending',
    requested_at: '2026-08-05T17:01:00-03:00',
    operation: productOperation,
  } as const

  it('preserva uma operação comercial completa enquanto aguarda confirmação', () => {
    const parsed = parsePendingConfirmationV1(pending)

    expect(parsed.operation.type).toBe('product_order')
    expect(parsed.status).toBe('pending')
    expect(JSON.parse(JSON.stringify(parsed))).toEqual(parsed)
  })

  it('exige que confirmação e operação pertençam ao mesmo tenant', () => {
    expect(() => parsePendingConfirmationV1({
      ...pending,
      tenant_id: 'tenant-b',
    })).toThrow(ContractValidationError)
  })

  it('rejeita estados finais sem resolução e cancelamento sem motivo', () => {
    expect(() => parsePendingConfirmationV1({
      ...pending,
      status: 'confirmed',
    })).toThrow(ContractValidationError)

    expect(() => parsePendingConfirmationV1({
      ...pending,
      status: 'cancelled',
      resolved_at: '2026-08-05T17:02:00-03:00',
    })).toThrow(ContractValidationError)
  })

  it('aceita confirmação resolvida sem alterar o snapshot comercial', () => {
    const parsed = parsePendingConfirmationV1({
      ...pending,
      status: 'confirmed',
      resolved_at: '2026-08-05T17:02:00-03:00',
    })

    expect(parsed.operation).toEqual(productOperation)
  })
})

describe('ToolResultV1', () => {
  const success = {
    type: 'tool_result',
    version: 1,
    tenant_id: 'tenant-a',
    tool_call_id: 'call-1',
    tool_name: 'search_petshop_products',
    status: 'success',
    ok: true,
    started_at: '2026-08-05T17:00:00-03:00',
    completed_at: '2026-08-05T17:00:00.050-03:00',
    duration_ms: 50,
    data: {
      products: [{ id: 'product-1', price: 60 }],
    },
  } as const

  it('aceita resultado de sucesso com dados JSON portáveis', () => {
    const parsed = parseToolResultV1(success)

    expect(parsed.ok).toBe(true)
    expect(JSON.parse(JSON.stringify(parsed))).toEqual(parsed)
  })

  it('aceita erro recuperável explicitamente classificado', () => {
    const parsed = parseToolResultV1({
      ...success,
      status: 'retryable_error',
      ok: false,
      data: null,
      error: {
        code: 'AGENDA_REFRESH_FAILED',
        message: 'Agenda temporariamente indisponível.',
        retryable: true,
        details: { retry_after_seconds: 10 },
      },
    })

    expect(parsed.error?.retryable).toBe(true)
  })

  it('rejeita combinações contraditórias e stack bruto', () => {
    expect(() => parseToolResultV1({
      ...success,
      status: 'error',
      ok: true,
    })).toThrow(ContractValidationError)

    expect(() => parseToolResultV1({
      ...success,
      status: 'error',
      ok: false,
      error: {
        code: 'FAILED',
        message: 'Falha segura.',
        retryable: false,
        stack: 'secret stack trace',
      },
    })).toThrow(ContractValidationError)
  })

  it('rejeita conclusão anterior ao início', () => {
    expect(() => parseToolResultV1({
      ...success,
      completed_at: '2026-08-05T16:59:59-03:00',
    })).toThrow(ContractValidationError)
  })
})

describe('DomainEventEnvelopeV1', () => {
  const event = {
    type: 'domain_event',
    version: 1,
    event_id: 'event-1',
    event_name: 'orders.product.confirmed',
    event_version: 1,
    tenant_id: 'tenant-a',
    aggregate: {
      type: 'product_order',
      id: 'order-1',
      version: 1,
    },
    occurred_at: '2026-08-05T17:02:00-03:00',
    correlation_id: 'corr-1',
    causation_id: 'confirmation-1',
    idempotency_key: 'tenant-a:event-1',
    payload: {
      order_id: 'order-1',
      total: 60,
      items: [{ product_id: 'product-1', quantity: 1 }],
    },
    metadata: {
      source: 'legacy_adapter',
      replay: false,
    },
  } as const

  it('aceita envelope serializável com identidade e idempotência', () => {
    const parsed = parseDomainEventEnvelopeV1(event)

    expect(parsed.event_version).toBe(1)
    expect(JSON.parse(JSON.stringify(parsed))).toEqual(parsed)
  })

  it('rejeita nomes instáveis e metadata composta', () => {
    expect(() => parseDomainEventEnvelopeV1({
      ...event,
      event_name: 'Pedido Confirmado!',
    })).toThrow(ContractValidationError)

    expect(() => parseDomainEventEnvelopeV1({
      ...event,
      metadata: {
        unsafe: { nested: true },
      },
    })).toThrow(ContractValidationError)
  })

  it('rejeita payloads não JSON', () => {
    expect(() => parseDomainEventEnvelopeV1({
      ...event,
      payload: {
        created_at: new Date(),
      },
    })).toThrow(ContractValidationError)
  })
})
