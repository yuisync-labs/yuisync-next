import { describe, expect, it } from 'vitest'
import { buildVerifiedFacts, safeFactualFallback, validateFactualResponse } from '../src/luna/factualResponse'

describe('Luna factual response contract', () => {
  const facts = buildVerifiedFacts([{ callId: 'catalog', tool: 'search_products', result: { ok: true, data: { products: [{ name: 'Sachê', price_cents: 800, available_milliunits: 2000 }] } } }])
  it('renderiza preço e estoque exclusivamente do resultado estruturado', () => {
    expect(validateFactualResponse('{"opening":"acknowledge","facts":["catalog:product.0"],"question":"quantity"}', facts)).toBe('Certo!\nSachê: R$ 8,00; estoque disponível nesta consulta: 2.\nQual quantidade?')
  })
  it.each([
    'O sachê custa R$ 5 e tem 10 em estoque.',
    '{"opening":"Custa R$ 5","facts":[],"question":"none"}',
    '{"opening":"none","facts":["invented:product.0"],"question":"none"}',
    '{"opening":"none","facts":["catalog:product.0"],"question":"none","payment":"paid"}',
    '{"opening":"none","facts":["catalog:product.0","catalog:product.0"],"question":"none"}',
    '{"opening":"none","facts":[],"question":"none"}',
  ])('rejeita afirmação livre, referência inexistente ou contrato inválido: %s', content => {
    expect(validateFactualResponse(content, facts)).toBeNull()
  })
  it('não transforma commit falho em confirmação nem pedido pendente em pagamento', () => {
    const failed = buildVerifiedFacts([{ callId: 'commit', tool: 'commit_confirmed_proposal', result: { ok: false, code: 'COMMIT_STATE_UNCERTAIN', retryable: false } }])
    expect(safeFactualFallback(failed)).toContain('Não vou repetir')
    const committed = buildVerifiedFacts([{ callId: 'commit', tool: 'commit_confirmed_proposal', result: { ok: true, data: { operation_id: 'sale', operation_kind: 'product_order_create' } } }])
    expect(safeFactualFallback(committed)).toContain('não significa que o pagamento foi recebido')
  })
  it('não usa argumentos ou dados sem um renderer suportado como evidência', () => {
    expect(buildVerifiedFacts([{ callId: 'draft', tool: 'update_operation_draft', result: { ok: true, data: { price: 'R$ 1', availability: 'amanhã' } } }])).toEqual([])
  })
})
