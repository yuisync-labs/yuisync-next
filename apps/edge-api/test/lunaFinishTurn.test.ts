import { describe, expect, it } from 'vitest'
import { FINISH_TURN, finishTurn, operationalCapabilities } from '../src/luna/finishTurn'
import { loadOperationalState, reduceDraft } from '../src/luna/operationalState'
import { createLunaToolRegistry } from '../src/luna/toolRegistry'
import { env } from 'cloudflare:workers'

const empty = loadOperationalState('{}')
const cart = reduceDraft(empty, {operationId:'cart',kind:'cart',expectedVersion:0,action:'add_item',itemId:'racao-a',quantity:1})
const facts = [{id:'catalog:product.0',text:'Ração A: R$ 90,00; estoque disponível nesta consulta: 10.'}]
const final = (blocks: {kind:string;value:string}[], intent='cart', operation_ids=['cart']) => ({intent,operation_ids,blocks})

describe('read-only Luna termination and capabilities', () => {
  it('renders source-owned facts and a missing field without changing the draft', () => {
    const before = JSON.stringify(cart)
    expect(finishTurn(final([{kind:'fact',value:facts[0].id},{kind:'question',value:'fulfillment'}]),cart,facts)).toEqual({ok:true,data:{reply:`${facts[0].text}\nVocê prefere retirar ou receber em casa?`}})
    expect(JSON.stringify(cart)).toBe(before)
  })
  it('cannot end a purchase without persisting its draft', () => {
    expect(finishTurn(final([{kind:'social',value:'Certo!'}],'cart',[]),empty,[])).toMatchObject({ok:false,code:'TURN_NOT_READY'})
  })
  it('can answer a catalog query without creating a purchase', () => {
    expect(finishTurn(final([{kind:'fact',value:facts[0].id}],'information',[]),empty,facts)).toMatchObject({ok:true})
  })
  it.each([['unknown'],['cart','cart'],['__proto__']].map(operation_ids=>({operation_ids})))('rejects unknown, duplicated or inherited draft IDs: $operation_ids', ({operation_ids}) => {
    expect(finishTurn(final([{kind:'social',value:'Certo!'}],'cart',operation_ids),cart,[])).toMatchObject({ok:false,code:'TURN_OPERATION_UNKNOWN'})
  })
  it.each([
    [{kind:'fact',value:'invented:price'}],
    [{kind:'social',value:'Pedido pago e entregue.'}],
    [{kind:'social',value:'Ração A custa R$ 1.'}],
    [{kind:'question',value:'Pode confirmar o pagamento?'}],
    [{kind:'fact',value:facts[0].id},{kind:'fact',value:facts[0].id}],
  ].map(blocks=>({blocks})))('rejects invented facts, operational social prose and malformed questions: $blocks', ({blocks}) => {
    expect(finishTurn(final(blocks),cart,facts)).toMatchObject({ok:false,code:'TURN_RESPONSE_INVALID'})
  })
  it('does not ask for already persisted quantity or fulfillment', () => {
    expect(finishTurn(final([{kind:'question',value:'quantity'}]),cart,[])).toMatchObject({ok:false,code:'TURN_QUESTION_ALREADY_KNOWN'})
    const ready = reduceDraft(cart,{operationId:'cart',kind:'cart',expectedVersion:1,action:'set_field',field:'fulfillment_type',value:'counter'})
    expect(finishTurn(final([{kind:'question',value:'fulfillment'}]),ready,[])).toMatchObject({ok:false,code:'TURN_QUESTION_ALREADY_KNOWN'})
  })
  it('projects draft capabilities without adding new domain commands', () => {
    const definitions = createLunaToolRegistry((env as EdgeEnv & {DB:D1Database}).DB).definitions
    expect(definitions.some(d=>d.name===FINISH_TURN.name)).toBe(false)
    const names = (state=empty,kinds:string[]=[]) => operationalCapabilities(definitions,state,kinds).map(d=>d.name)
    expect(names()).not.toContain('resolve_context_reference')
    expect(names()).not.toContain('prepare_product_order')
    expect(names()).not.toContain('prepare_appointment')
    expect(names(cart,['product'])).toContain('resolve_context_reference')
    const ready = reduceDraft(cart,{operationId:'cart',kind:'cart',expectedVersion:1,action:'set_field',field:'fulfillment_type',value:'counter'})
    expect(names(ready)).toContain('prepare_product_order')
    const paused = reduceDraft(ready,{operationId:'cart',kind:'cart',expectedVersion:2,action:'pause'})
    expect(names(paused)).not.toContain('prepare_product_order')
  })
})
