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
  it('distingue status de agendamento e pagamento usando apenas dados consultados',()=>{
    const rows=buildVerifiedFacts([{callId:'agenda',tool:'get_customer_appointments',result:{ok:true,data:{appointments:[{pet_name:'Mel',scheduled_at_ms:Date.parse('2026-10-07T12:00:00Z'),duration_min:60,status:'confirmed'}]}}}])
    expect(rows[0].text).toContain('2026-10-07T12:00:00.000Z (UTC)')
    expect(rows[0].text).toContain('não confirma pagamento')
    expect(buildVerifiedFacts([{callId:'agenda',tool:'get_customer_appointments',result:{ok:true,data:{appointments:[{pet_name:'Mel',scheduled_at_ms:'amanhã',status:'paid'}]}}}])).toEqual([])
  })
  it('aceita composição social generativa e ordem variável sem alterar fatos', () => {
    for (const social of ['Claro, vamos por partes.', 'Oi! Estou aqui pra te ajudar.', 'Entendi, podemos continuar com calma.']) {
      const reply = validateFactualResponse(JSON.stringify({blocks:[{kind:'social',text:social},{kind:'fact',id:facts[0].id},{kind:'question',field:'quantity'}]}),facts)
      expect(reply).toContain(social)
      expect(reply).toContain(facts[0].text)
      expect(reply).toContain('Qual quantidade?')
    }
  })
  it.each(['Pagamento recebido.', 'Está disponível amanhã.', 'Não, esse estoque está errado.', 'Custa R$ 5,00.', 'Confirmado!', 'Claro, garantido.'])('impede afirmação operacional no canal social: %s', text => {
    expect(validateFactualResponse(JSON.stringify({blocks:[{kind:'social',text},{kind:'fact',id:facts[0].id}]}),facts)).toBeNull()
  })
})
