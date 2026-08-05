import { describe, expect, it } from 'vitest'

import {
  ContractValidationError,
  parseTenantContextV1,
} from '../../../shared/contracts/v1/index'

const minimumTenantContext = {
  type: 'tenant_context',
  version: 1,
  tenant_id: 'tenant-a',
  correlation_id: 'corr-123',
  source: 'http',
} as const

describe('TenantContextV1', () => {
  it('aceita o payload mínimo e remove espaços de identificadores', () => {
    const parsed = parseTenantContextV1({
      ...minimumTenantContext,
      tenant_id: '  tenant-a  ',
    })

    expect(parsed).toEqual(minimumTenantContext)
  })

  it('aceita origem, request e ator completos', () => {
    const parsed = parseTenantContextV1({
      ...minimumTenantContext,
      request_id: 'request-1',
      source: 'webhook',
      actor: {
        type: 'service_account',
        id: 'whatsapp-ingestion',
      },
    })

    expect(parsed.actor?.id).toBe('whatsapp-ingestion')
    expect(JSON.parse(JSON.stringify(parsed))).toEqual(parsed)
  })

  it('rejeita tenant ausente, versões desconhecidas e campos extras', () => {
    expect(() => parseTenantContextV1({
      ...minimumTenantContext,
      tenant_id: undefined,
    })).toThrow(ContractValidationError)

    expect(() => parseTenantContextV1({
      ...minimumTenantContext,
      version: 2,
    })).toThrow(ContractValidationError)

    expect(() => parseTenantContextV1({
      ...minimumTenantContext,
      global_tenant: true,
    })).toThrow(ContractValidationError)
  })

  it('produz erro seguro sem copiar o payload recebido', () => {
    const secret = 'Bearer super-secret-token'

    try {
      parseTenantContextV1({
        ...minimumTenantContext,
        tenant_id: '',
        authorization: secret,
      })
      throw new Error('expected contract failure')
    } catch (error) {
      expect(error).toBeInstanceOf(ContractValidationError)
      const body = (error as ContractValidationError).toJSON()
      expect(body.code).toBe('CONTRACT_VALIDATION_FAILED')
      expect(body.contract).toBe('TenantContext')
      expect(body.issues.length).toBeGreaterThan(0)
      expect(JSON.stringify(body)).not.toContain(secret)
    }
  })

  it('mantém tenants diferentes explicitamente isolados', () => {
    const tenantA = parseTenantContextV1(minimumTenantContext)
    const tenantB = parseTenantContextV1({
      ...minimumTenantContext,
      tenant_id: 'tenant-b',
    })

    expect(tenantA.tenant_id).not.toBe(tenantB.tenant_id)
  })
})
