import type { FiscalDocumentType, FiscalProvider } from './domain'

export class FiscalTransportDisabledError extends Error {
  readonly code = 'FISCAL_TRANSPORT_DISABLED'
  constructor() {
    super('Fiscal transport is disabled until credentials, homologation certification and explicit production authorization exist.')
    this.name = 'FiscalTransportDisabledError'
  }
}

export type FiscalProviderAdapter = Readonly<{
  provider: FiscalProvider
  documentTypes: readonly FiscalDocumentType[]
  transportEnabled: false
  transmit: () => Promise<never>
}>

function disabledAdapter(provider: FiscalProvider, documentTypes: readonly FiscalDocumentType[]): FiscalProviderAdapter {
  return Object.freeze({
    provider,
    documentTypes,
    transportEnabled: false as const,
    async transmit(): Promise<never> {
      throw new FiscalTransportDisabledError()
    },
  })
}

/** NFS-e Nacional / SEFIN adapter shell. No outbound network call exists in foundation phase. */
export const nfseNacionalAdapter = disabledAdapter('nfse_nacional', ['nfse'])

/** SEF/MG adapter shell for NFC-e model 65 and NF-e model 55. No outbound network call exists in foundation phase. */
export const sefazMgAdapter = disabledAdapter('sefaz_mg', ['nfce', 'nfe'])

export const fiscalProviderAdapters = Object.freeze({
  nfse_nacional: nfseNacionalAdapter,
  sefaz_mg: sefazMgAdapter,
})

export function assertFiscalProductionDisabled(environment: unknown): void {
  if (String(environment ?? '').trim().toLowerCase() === 'production') {
    throw new Error('FISCAL_PRODUCTION_DISABLED')
  }
}
