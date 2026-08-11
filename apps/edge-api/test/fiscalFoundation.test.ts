import { describe, expect, it } from 'vitest'
import {
  assertNoRawFiscalSecrets,
  classifySaleItems,
  isSupportedCnpjShape,
  normalizeCnpj,
  normalizeFiscalEnvironment,
  readinessBlockers,
} from '../src/fiscal/domain'
import { FiscalTransportDisabledError, nfseNacionalAdapter, sefazMgAdapter } from '../src/fiscal/providers'

describe('fiscal foundation 2026 safety', () => {
  it('keeps CNPJ as text and accepts numeric and alphanumeric 2026 shapes', () => {
    expect(normalizeCnpj('12.345.678/0001-95')).toBe('12345678000195')
    expect(isSupportedCnpjShape('12.345.678/0001-95')).toBe(true)
    expect(isSupportedCnpjShape('AB12CD34EF5601')).toBe(true)
    expect(isSupportedCnpjShape('AB12CD34EF56XY')).toBe(false)
  })

  it('hard rejects production', () => {
    expect(() => normalizeFiscalEnvironment('production')).toThrow('FISCAL_PRODUCTION_DISABLED')
    expect(normalizeFiscalEnvironment('homologation')).toBe('homologation')
  })

  it('rejects raw certificate and CSC secrets while allowing secret references', () => {
    expect(() => assertNoRawFiscalSecrets({ pfx: 'base64' })).toThrow('RAW_FISCAL_SECRET_REJECTED')
    expect(() => assertNoRawFiscalSecrets({ password: 'secret' })).toThrow('RAW_FISCAL_SECRET_REJECTED')
    expect(() => assertNoRawFiscalSecrets({ cscToken: 'secret' })).toThrow('RAW_FISCAL_SECRET_REJECTED')
    expect(() => assertNoRawFiscalSecrets({ certificateSecretRef: 'secret://tenant/cert', nfceCscSecretRef: 'secret://tenant/csc' })).not.toThrow()
  })

  it('splits mixed sales into NFS-e for service and NFC-e for product', () => {
    const groups = classifySaleItems([
      { position: 0, item_type: 'service', product_id: null, service_id: 'bath', item_name: 'Banho', quantity_milliunits: 1000, unit_price_cents: 7000, subtotal_cents: 7000 },
      { position: 1, item_type: 'product', product_id: 'shampoo', service_id: null, item_name: 'Shampoo', quantity_milliunits: 1000, unit_price_cents: 3500, subtotal_cents: 3500 },
    ])
    expect(groups.get('nfse')).toHaveLength(1)
    expect(groups.get('nfce')).toHaveLength(1)
  })

  it('reports credential and tax-rule blockers before issuance', () => {
    const blockers = readinessBlockers({ cnpj: '12345678000195', tax_regime: 'simples_nacional', municipality_ibge: '3143906' }, 'nfce', [1])
    expect(blockers).toContain('missing_certificate_secret_ref')
    expect(blockers).toContain('missing_state_registration')
    expect(blockers).toContain('missing_nfce_csc_secret_ref')
    expect(blockers).toContain('missing_item_fiscal_rule:1')
  })

  it('has no enabled provider transport in foundation phase', async () => {
    expect(nfseNacionalAdapter.transportEnabled).toBe(false)
    expect(sefazMgAdapter.transportEnabled).toBe(false)
    await expect(nfseNacionalAdapter.transmit()).rejects.toBeInstanceOf(FiscalTransportDisabledError)
    await expect(sefazMgAdapter.transmit()).rejects.toBeInstanceOf(FiscalTransportDisabledError)
  })
})
