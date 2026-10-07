import { describe, expect, it } from 'vitest'
import { FINISH_TURN, finishTurn, finishTurnDefinition, operationalCapabilities } from '../src/luna/finishTurn'
import { loadOperationalState, reduceDraft } from '../src/luna/operationalState'
import { createLunaToolRegistry } from '../src/luna/toolRegistry'
import { env } from 'cloudflare:workers'

const empty = loadOperationalState('{}')
const cart = reduceDraft(empty, {operationId:'cart',kind:'cart',expectedVersion:0,action:'add_item',itemId:'racao-a',quantity:1})
const facts = [{id:'catalog:product.0',text:'Ração A: R$ 90,00; estoque disponível nesta consulta: 10.'}]
const final = (blocks: {kind:string;value:string}[], intent='cart', operation_ids=['cart']) => ({intent,operation_ids,social:blocks.filter(b=>b.kind==='social').map(b=>b.value),fact_ids:blocks.filter(b=>b.kind==='fact').map(b=>b.value),question:blocks.find(b=>b.kind==='question')?.value??'none'})

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
  it('requires a material next step and current prepared operation, but leaves parallel information independent', () => {
    expect(finishTurn(final([{kind:'fact',value:facts[0].id}]),cart,facts,{enforce:true})).toMatchObject({ok:false,code:'TURN_NEXT_STEP_MISSING'})
    const ready=reduceDraft(cart,{operationId:'cart',kind:'cart',expectedVersion:1,action:'set_field',field:'fulfillment_type',value:'counter'})
    expect(finishTurn(final([{kind:'social',value:'Certo!'}]),ready,[],{enforce:true})).toMatchObject({ok:false,code:'TURN_PREPARATION_REQUIRED'})
    expect(finishTurn(final([{kind:'social',value:'Certo!'}]),ready,[],{enforce:true,preparedOperationIds:['cart']})).toMatchObject({ok:true})
    expect(finishTurn(final([{kind:'fact',value:facts[0].id}],'information',[]),ready,facts,{enforce:true})).toMatchObject({ok:true})
  })
  it('does not expose irrelevant identity facts in a purchase response', () => {
    const pet={id:'identity:pet.0',text:'Pet cadastrado: mel.',reference:{id:'mel',kind:'pet' as const,label:'mel',observedAtMs:1}}
    const result=finishTurn(final([{kind:'fact',value:pet.id},{kind:'fact',value:facts[0].id},{kind:'question',value:'fulfillment'}]),cart,[pet,...facts],{enforce:true})
    expect(result).toEqual({ok:true,data:{reply:`${facts[0].text}\nVocê prefere retirar ou receber em casa?`}})
  })
  it('rejects unsupported fulfillment even in persisted state or legacy events', () => {
    expect(()=>reduceDraft(cart,{operationId:'cart',kind:'cart',expectedVersion:1,action:'set_field',field:'fulfillment_type',value:'pickup'})).toThrow('OPERATION_FIELD_INVALID')
    expect(()=>loadOperationalState(JSON.stringify({...cart,operations:{cart:{...cart.operations.cart,fields:{fulfillment_type:'pickup'}}}}))).toThrow('OPERATION_STATE_UNKNOWN')
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
    const result=finishTurn(final(blocks),cart,facts)
    expect(result.ok).toBe(false)
    if(!result.ok)expect(['TURN_RESPONSE_INVALID','TOOL_ARGUMENTS_INVALID']).toContain(result.code)
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
  it('constrains fact selection in the model grammar to the current verified IDs',()=>{
    const properties=finishTurnDefinition(facts).parameters.properties as any
    expect(properties.fact_ids.items.enum).toEqual(['catalog:product.0'])
    expect((finishTurnDefinition([]).parameters.properties as any).fact_ids.maxItems).toBe(0)
    const definitions=createLunaToolRegistry((env as EdgeEnv & {DB:D1Database}).DB).definitions
    const names=operationalCapabilities(definitions,empty,[],{identityCurrent:true,hasProposal:false,hasAppointments:false}).map(t=>t.name)
    expect(names).not.toContain('update_operation_draft')
    expect(names).not.toContain('get_customer_context')
    expect(names).not.toContain('commit_confirmed_proposal')
    expect(names).not.toContain('prepare_appointment_cancellation')
    expect(names).toContain('record_turn_decision')
    expect(names).toContain('get_operation_status')
  })
})
