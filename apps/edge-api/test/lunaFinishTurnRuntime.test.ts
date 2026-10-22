import { describe, expect, it } from 'vitest'
import { runLunaTurn } from '../src/luna/runLunaTurn'
import { recordProposalPresentation } from '../src/luna/proposalPresentation'
import { GroqProviderError } from '../src/luna/providers/groqProvider'
import type { LunaMessage, LunaToolDefinition } from '../src/luna/contracts'
import { createDesignedHarness, type Command } from './fixtures/luna/designedRuntimeHarness'
import { LUNA_DESIGNED_SCENARIOS } from './fixtures/luna/designedScenarios'

const terminal = (intent:string, operation_ids:string[], blocks:{kind:string;value:string}[]):Command => ({name:'finish_turn',args:{intent,operation_ids,social:blocks.filter(b=>b.kind==='social').map(b=>b.value),fact_ids:blocks.filter(b=>b.kind==='fact').map(b=>b.value),question:blocks.find(b=>b.kind==='question')?.value??'none'}})
const social = [{kind:'social',value:'Certo!'}]
type Harness = Awaited<ReturnType<typeof createDesignedHarness>>
async function execute(h:Harness, turn:number, message:string, groups:(Command[]|((messages:readonly LunaMessage[])=>Command[]))[]) {
  h.clock.mockReturnValue(h.start+turn*10000)
  const context={...h.ctx,sourceMessageId:`finish-in-${turn}`,traceId:`finish-trace-${turn}`}
  await h.db.prepare(`INSERT INTO chat_messages(tenant_id,module_id,id,thread_id,external_message_id,direction,actor_type,content_text,created_at_ms) VALUES(?1,'petshop',?2,?3,?2,'inbound','customer',?4,?5)`)
    .bind(h.tenant,context.sourceMessageId,context.conversationId,message,Date.now()).run()
  let step=0
  const provider={model:'offline-native-tool-provider',async complete(input:{messages:readonly LunaMessage[];tools:readonly LunaToolDefinition[];toolChoice?:string}){
    expect(input.toolChoice).toBe('required')
    if(input.messages.some(m=>m.role==='tool'&&m.content?.includes('TURN_RESPONSE_INVALID')))expect(input.tools.map(t=>t.name)).toEqual(['finish_turn'])
    const group=groups[step++]
    if(!group)throw new Error('Unexpected model replay')
    const commands=typeof group==='function'?group(input.messages):group
    const calls=commands.map((c,i)=>({id:`finish-${turn}-${step}-${i}`,type:'function' as const,function:{name:c.name,arguments:JSON.stringify(c.args)}}))
    return {content:null,toolCalls:calls,usage:{promptTokens:10,completionTokens:10},rateLimit:{remainingRequests:900,remainingTokens:7000,resetRequests:null,resetTokens:null},requestLimit:1000}
  }}
  const result=await runLunaTurn({database:h.db,context,provider})
  if(result.reply){
    h.clock.mockReturnValue(Date.now()+1)
    const outbound=`finish-out-${turn}`
    await h.db.prepare(`INSERT INTO chat_messages(tenant_id,module_id,id,thread_id,direction,actor_type,content_text,created_at_ms) VALUES(?1,'petshop',?2,?3,'outbound','assistant',?4,?5)`)
      .bind(h.tenant,outbound,context.conversationId,result.reply,Date.now()).run()
    await recordProposalPresentation(h.db,context,result.proposalIds,outbound)
  }
  return result
}

describe('structured Luna termination on real Worker/D1',()=>{
  it('runs canonical scenario 1 through native tools, presentation, confirmation and one pending order',async()=>{
    const h=await createDesignedHarness(1,'-finish')
    const messages=LUNA_DESIGNED_SCENARIOS[0].messages
    try {
      const first=await execute(h,1,messages[0],[
        [h.command('search_products',{query:'Ração A'})],
        [h.command('record_turn_decision',{intents:[{operation_id:'cart',kind:'cart',goal:'create'}],focus:'cart',events:[{operationId:'cart',kind:'cart',expectedVersion:0,action:'add_item',itemId:'racao-a',quantity:1}]})],
        [terminal('cart',['cart'],[{kind:'fact',value:'finish-1-1-0:product.0'},{kind:'question',value:'fulfillment'}])],
      ])
      expect(first).toMatchObject({status:'replied',errorCode:null,usage:{modelCalls:3}})
      expect(first.reply).toContain('Ração A: R$ 90,00')
      expect(first.reply).not.toContain('Qual quantidade?')
      expect((await h.state()).operations.cart.items).toEqual([{id:'racao-a',quantity:1}])
      const second=await execute(h,2,messages[1],[
        [h.command('record_turn_decision',{intents:[{operation_id:'cart',kind:'cart',goal:'change'}],focus:'cart',events:[{operationId:'cart',kind:'cart',expectedVersion:1,action:'set_field',field:'fulfillment_type',value:'counter'}]})],
        [h.command('prepare_product_order',{customer_id:'cliente-maria',operation_id:'cart',items:[{product_id:'racao-a',quantity:1}],fulfillment_type:'counter'})],
        [terminal('cart',['cart'],social)],
      ])
      expect(second).toMatchObject({status:'awaiting_confirmation',errorCode:null,usage:{modelCalls:3}})
      expect(second.reply).toContain('Ração A × 1: R$ 90,00')
      expect(second.reply).toContain('Modalidade: retirada')
      expect(await h.db.prepare(`SELECT COUNT(*) AS n FROM sales WHERE tenant_id=?1`).bind(h.tenant).first()).toEqual({n:0})
      const proposal=await h.db.prepare(`SELECT id,version FROM luna_proposals WHERE tenant_id=?1`).bind(h.tenant).first<{id:string;version:number}>()
      const third=await execute(h,3,messages[2],[
        [h.command('commit_confirmed_proposal',{proposal_id:proposal!.id,proposal_version:proposal!.version})],
        [terminal('cart',['cart'],[{kind:'fact',value:'finish-3-1-0:result'}])],
      ])
      expect(third).toMatchObject({status:'replied',errorCode:null,usage:{modelCalls:2}})
      expect(third.reply).toContain('não significa que o pagamento foi recebido')
      expect((await h.db.prepare(`SELECT status,total_cents FROM sales WHERE tenant_id=?1`).bind(h.tenant).all()).results).toEqual([{status:'pending',total_cents:9000}])
      expect(await h.db.prepare(`SELECT COUNT(*) AS n FROM payments WHERE tenant_id=?1`).bind(h.tenant).first()).toEqual({n:0})
    } finally {h.close()}
  })
  it('rejects finish plus mutation before executing either command',async()=>{
    const h=await createDesignedHarness(1,'-mixed')
    try {
      const result=await execute(h,1,'Uma Ração A.',[[terminal('information',[],social),h.draft('cart','cart','set_field',{field:'fulfillment_type',value:'counter'})]])
      expect(result).toMatchObject({status:'failed',errorCode:'GROQ_RESPONSE_INVALID'})
      expect((await h.state()).operations).toEqual({})
      expect(await h.db.prepare(`SELECT COUNT(*) AS n FROM luna_operation_events WHERE tenant_id=?1`).bind(h.tenant).first()).toEqual({n:0})
    } finally {h.close()}
  })
  it('repairs a fact violation once, then renders verified facts without replaying a query',async()=>{
    const h=await createDesignedHarness(1,'-repair')
    try {
      const result=await execute(h,1,'Quanto custa Ração A?',[
        [h.command('search_products',{query:'Ração A'})],
        [terminal('information',[],[{kind:'social',value:'Custa R$ 1 e está pago.'}])],
        input=>{
          // The repair is a terminal tool invocation, not another domain action.
          expect(input.filter(m=>m.role==='tool').some(m=>m.content?.includes('TURN_RESPONSE_INVALID'))).toBe(true)
          return [terminal('information',[],[{kind:'fact',value:'invented:price'}])]
        },
      ])
      expect(result).toMatchObject({status:'replied',errorCode:null,usage:{modelCalls:3}})
      expect(result.reply).toBe('Ração A: R$ 90,00; estoque disponível nesta consulta: 10.')
    } finally {h.close()}
  })
  it('cannot mutate a draft during the restricted factual repair',async()=>{
    const h=await createDesignedHarness(1,'-repair-write')
    try {
      const result=await execute(h,1,'Quanto custa?',[
        [terminal('information',[],[{kind:'social',value:'Está pago.'}])],
        [h.draft('cart','cart','set_field',{field:'fulfillment_type',value:'counter'})],
      ])
      expect(result).toMatchObject({status:'failed',errorCode:'GROQ_RESPONSE_INVALID'})
      expect((await h.state()).operations).toEqual({})
    } finally {h.close()}
  })
  it('renders verified results if the single factual repair times out',async()=>{
    const h=await createDesignedHarness(1,'-repair-timeout')
    try {
      const result=await execute(h,1,'Quanto custa Ração A?',[
        [h.command('search_products',{query:'Ração A'})],
        [terminal('information',[],[{kind:'social',value:'Custa R$ 1.'}])],
        ()=>{throw new GroqProviderError('GROQ_TIMEOUT')},
      ])
      expect(result).toMatchObject({status:'replied',errorCode:null,usage:{modelCalls:3}})
      expect(result.reply).toBe('Ração A: R$ 90,00; estoque disponível nesta consulta: 10.')
    } finally {h.close()}
  })
  it('preserves persisted cart when the provider fails before termination',async()=>{
    const h=await createDesignedHarness(1,'-timeout')
    try {
      await h.turn(1,'Uma Ração A.',[[h.draft('cart','cart','add_item',{itemId:'racao-a',quantity:1})]],['update_operation_draft'])
      const before=await h.state()
      const result=await runLunaTurn({database:h.db,context:{...h.ctx,sourceMessageId:'timeout',traceId:'timeout'},provider:{model:'fixture',async complete(){throw new GroqProviderError('GROQ_TIMEOUT')}}})
      expect(result).toMatchObject({status:'failed',errorCode:'GROQ_TIMEOUT',committedOperationIds:[]})
      expect(await h.state()).toEqual(before)
    } finally {h.close()}
  })
})
