export type FiscalDocumentType = 'nfse' | 'nfce' | 'nfe'
export type FiscalProvider = 'nfse_nacional' | 'sefaz_mg'
export type FiscalEnvironment = 'homologation'

export type FiscalProfileLike = {
  cnpj: string
  state_registration?: string | null
  municipal_registration?: string | null
  tax_regime: string
  simples_nacional?: number | boolean | null
  municipality_ibge?: string | null
  environment?: string | null
  certificate_secret_ref?: string | null
  nfce_csc_secret_ref?: string | null
  nfce_csc_id?: string | null
}

export type FiscalSaleItem = {
  position: number
  item_type: 'product' | 'service'
  product_id: string | null
  service_id: string | null
  item_name: string
  quantity_milliunits: number
  unit_price_cents: number
  subtotal_cents: number
}

const CNPJ_SHAPE = /^[A-Z0-9]{12}[0-9]{2}$/
const IBGE_MUNICIPALITY = /^\d{7}$/
const FORBIDDEN_SECRET_KEYS = new Set([
  'certificate', 'certificatebase64', 'certificate_base64', 'pfx', 'p12',
  'privatekey', 'private_key', 'password', 'passphrase', 'csc', 'csctoken', 'csc_token',
])

export function normalizeCnpj(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toUpperCase()
    .replace(/[.\/-]/g, '')
}

/**
 * Structural validation only. The 2026 alphanumeric format requires CNPJ to be
 * handled as text. Check-digit validation belongs in a versioned official
 * validator and must not fall back to the legacy digits-only algorithm.
 */
export function isSupportedCnpjShape(value: unknown): boolean {
  return CNPJ_SHAPE.test(normalizeCnpj(value))
}

export function normalizeFiscalEnvironment(value: unknown): FiscalEnvironment {
  const normalized = String(value ?? 'homologation').trim().toLowerCase()
  if (normalized !== 'homologation') throw new Error('FISCAL_PRODUCTION_DISABLED')
  return 'homologation'
}

export function providerForDocument(documentType: FiscalDocumentType): FiscalProvider {
  return documentType === 'nfse' ? 'nfse_nacional' : 'sefaz_mg'
}

export function schemaVersionForDocument(documentType: FiscalDocumentType): string {
  if (documentType === 'nfse') return 'nfse-nacional-2026-08'
  return `${documentType}-mg-2026-08`
}

export const FISCAL_RULESET_VERSION = 'br-mg-2026-08'

export function assertNoRawFiscalSecrets(input: unknown): void {
  const visit = (value: unknown): void => {
    if (!value || typeof value !== 'object') return
    if (Array.isArray(value)) {
      value.forEach(visit)
      return
    }
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      const normalized = key.replace(/[-\s]/g, '').toLowerCase()
      if (FORBIDDEN_SECRET_KEYS.has(normalized) || FORBIDDEN_SECRET_KEYS.has(key.toLowerCase())) {
        throw new Error('RAW_FISCAL_SECRET_REJECTED')
      }
      visit(child)
    }
  }
  visit(input)
}

export function validateFiscalProfile(profile: FiscalProfileLike): void {
  if (!isSupportedCnpjShape(profile.cnpj)) throw new Error('INVALID_CNPJ')
  normalizeFiscalEnvironment(profile.environment)
  if (!['simples_nacional', 'lucro_presumido', 'lucro_real', 'other'].includes(profile.tax_regime)) {
    throw new Error('INVALID_TAX_REGIME')
  }
  if (profile.municipality_ibge && !IBGE_MUNICIPALITY.test(profile.municipality_ibge)) {
    throw new Error('INVALID_MUNICIPALITY_IBGE')
  }
}

export function readinessBlockers(
  profile: FiscalProfileLike | null,
  documentType: FiscalDocumentType,
  missingRulePositions: readonly number[] = [],
): string[] {
  if (!profile) return ['missing_fiscal_profile']
  const blockers: string[] = []
  if (!isSupportedCnpjShape(profile.cnpj)) blockers.push('invalid_cnpj')
  if (!profile.certificate_secret_ref) blockers.push('missing_certificate_secret_ref')
  if (!profile.tax_regime) blockers.push('missing_tax_regime')
  if (!profile.municipality_ibge) blockers.push('missing_municipality_ibge')

  if (documentType === 'nfse') {
    if (!profile.municipal_registration) blockers.push('missing_municipal_registration')
  } else {
    if (!profile.state_registration) blockers.push('missing_state_registration')
  }
  if (documentType === 'nfce') {
    if (!profile.nfce_csc_secret_ref) blockers.push('missing_nfce_csc_secret_ref')
    if (!profile.nfce_csc_id) blockers.push('missing_nfce_csc_id')
  }
  for (const position of missingRulePositions) blockers.push(`missing_item_fiscal_rule:${position}`)
  return blockers
}

export function classifySaleItems(items: readonly FiscalSaleItem[]): Map<FiscalDocumentType, FiscalSaleItem[]> {
  const result = new Map<FiscalDocumentType, FiscalSaleItem[]>()
  for (const item of items) {
    const documentType: FiscalDocumentType = item.item_type === 'service' ? 'nfse' : 'nfce'
    const bucket = result.get(documentType) ?? []
    bucket.push(item)
    result.set(documentType, bucket)
  }
  return result
}

export function fiscalItemId(item: FiscalSaleItem): string {
  const id = item.item_type === 'service' ? item.service_id : item.product_id
  if (!id) throw new Error('INVALID_FISCAL_SALE_ITEM')
  return id
}
