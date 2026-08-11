import { describe, expect, it } from 'vitest'

import { compatOperationErrorMessage } from '../src/lib/supabase'

describe('compat operation error messages', () => {
  it('translates service eligibility failures without losing the backend code contract', () => {
    expect(compatOperationErrorMessage({ code: 'SERVICE_SPECIES_MISMATCH' }))
      .toBe('Este serviço não está configurado para a espécie do pet selecionado.')
    expect(compatOperationErrorMessage({ code: 'SERVICE_WEIGHT_MISMATCH' }))
      .toBe('Este serviço não atende à faixa de peso cadastrada para o pet selecionado.')
    expect(compatOperationErrorMessage({ code: 'PET_CLIENT_MISMATCH' }))
      .toBe('O pet selecionado não pertence ao cliente informado.')
  })

  it('explains safe reopen and completion recovery actions', () => {
    expect(compatOperationErrorMessage({ code: 'APPOINTMENT_REOPEN_REFUND_REQUIRED' }))
      .toMatch(/estorno financeiro/i)
    expect(compatOperationErrorMessage({ code: 'APPOINTMENT_REOPEN_SALE_CANCEL_REQUIRED' }))
      .toMatch(/Cancele a venda/i)
    expect(compatOperationErrorMessage({ code: 'APPOINTMENT_COMPLETION_PACKAGE_RECONCILIATION_FAILED' }))
      .toMatch(/Tente concluir novamente; a repetição é segura/i)
  })

  it('preserves an explicit server message and falls back safely for unknown codes', () => {
    expect(compatOperationErrorMessage({
      code: 'SERVICE_WEIGHT_MISMATCH',
      message: 'Mensagem específica do servidor.',
    })).toBe('Mensagem específica do servidor.')
    expect(compatOperationErrorMessage({ code: 'UNKNOWN_OPERATION_ERROR' }))
      .toBe('UNKNOWN_OPERATION_ERROR')
  })
})
