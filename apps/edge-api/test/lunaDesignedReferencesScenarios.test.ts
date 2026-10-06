import { env } from 'cloudflare:workers'
import { describe,expect,it,vi } from 'vitest'
import { runLunaTurn } from '../src/luna/runLunaTurn'
import { recordProposalPresentation } from '../src/luna/proposalPresentation'
import { loadConversationMemory } from '../src/luna/conversationalMemory'
import { loadOperationalState } from '../src/luna/operationalState'
import { LUNA_DESIGNED_SCENARIOS,LUNA_SCENARIO_CLOCK,LUNA_SCENARIO_FIXTURE } from './fixtures/luna/designedScenarios'
import type { LunaMessage,LunaProviderResponse } from '../src/luna/contracts'
const db=(env as EdgeEnv & {DB:D1Database}).DB
type Command={name:string;args:Record<string,unknown>}
describe('designed references scenarios — real Worker/local D1/simulated provider',()=>{
 for(const id of [5,8])it(`scenario ${id}: accepted options/order, contextual selection, confirmation and pending sale`,async()=>{
  const scenario=LUNA_DESIGNED_SCENARIOS.find(s=>s.id===id)!,fixture=LUNA_SCENARIO_FIXTURE
  const tenant=`designed-references-${id}`,start=Date.parse(LUNA_SCENARIO_CLOCK.now),clock=vi.spyOn(Date,'now').mockReturnValue(start)
  const ctx={tenantId:tenant,moduleId:'petshop' as const,conversationId:`scenario-${id}`,customerAddress:fixture.phone,phoneNumberId:'fixture-no-whatsapp',sourceMessageId:'',traceId:'',executionMode:'fixture' as const}
  try{
   await db.batch([
    db.prepare(`INSERT INTO tenants(id,slug,name,status,created_at_ms,updated_at_ms) VALUES(?1,?1,'Fixture','active',?2,?2)`).bind(tenant,start),
    db.prepare(`INSERT INTO clients(tenant_id,module_id,id,name,phone,status,created_at_ms,updated_at_ms) VALUES(?1,'petshop',?2,'Maria',?3,'active',?4,?4)`).bind(tenant,fixture.customer,fixture.phone,start),
    db.prepare(`INSERT INTO chat_threads(tenant_id,module_id,id,channel,external_thread_id,status,last_message_at_ms,created_at_ms,updated_at_ms) VALUES(?1,'petshop',?2,'whatsapp',?3,'open',?4,?4,?4)`).bind(tenant,ctx.conversationId,fixture.phone,start),
    ...fixture.products.flatMap(p=>[
     db.prepare(`INSERT INTO catalog_products(tenant_id,module_id,id,name,price_cents,status,created_at_ms,updated_at_ms) VALUES(?1,'petshop',?2,?3,?4,'active',?5,?5)`).bind(tenant,p.id,p.name,p.priceCents,start),
     db.prepare(`INSERT INTO inventory_balances(tenant_id,module_id,product_id,on_hand_milliunits,reserved_milliunits,reorder_milliunits,version,updated_at_ms) VALUES(?1,'petshop',?2,?3,0,0,1,?4)`).bind(tenant,p.id,p.units*1000,start),
    ]),
   ])
   let version=0,proposal:{proposal_id:string;proposal_version:number}|null=null
   const executed:string[]=[],replies:string[]=[]
   const draft=(action:string,fields:Record<string,unknown>):Command=>({name:'update_operation_draft',args:{operationId:'cart',kind:'cart',expectedVersion:version++,action,...fields}})
   for(let turn=1;turn<=scenario.messages.length;turn++){
    clock.mockReturnValue(start+turn*10000)
    const context={...ctx,sourceMessageId:`in-${turn}`,traceId:`trace-${turn}`}
    await db.prepare(`INSERT INTO chat_messages(tenant_id,module_id,id,thread_id,external_message_id,direction,actor_type,content_text,created_at_ms) VALUES(?1,'petshop',?2,?3,?2,'inbound','customer',?4,?5)`).bind(tenant,context.sourceMessageId,ctx.conversationId,scenario.messages[turn-1],Date.now()).run()
    let step=0
    const provider={model:'offline-scripted-provider',async complete(input:{messages:readonly LunaMessage[]}):Promise<LunaProviderResponse & {requestLimit:number}>{
     const results=input.messages.filter(m=>m.role==='tool').map(m=>JSON.parse(m.content!))
     for(const r of results)if(!r.ok)expect({id,turn,code:r.code}).toEqual({id:8,turn:3,code:'CONTEXT_REFERENCE_AMBIGUOUS'})
     const prepared=results.find(r=>r.data?.proposal_id&&r.data?.proposal_version)
     if(prepared)proposal={proposal_id:prepared.data.proposal_id,proposal_version:prepared.data.proposal_version}
     let commands:Command[]=[],facts:string[]=[],question='none'
     if(step===0){
      if(turn===1)commands=[{name:'get_customer_context',args:{}},{name:'search_products',args:{query:id===5?'Ração Fantasia':'Ração'}}]
      if(id===5&&turn===2)commands=[{name:'search_products',args:{query:'Ração'}}]
      if(id===5&&turn===3)commands=[{name:'resolve_context_reference',args:{kind:'product',selection:'single'}}]
      if(id===8&&turn===2)commands=[{name:'resolve_context_reference',args:{kind:'product',selection:'ordinal',ordinal:2}}]
      if(id===8&&turn===3)commands=[{name:'resolve_context_reference',args:{kind:'product',selection:'single'}}]
      if(id===8&&turn===4)commands=[{name:'search_products',args:{query:'Sachê'}},draft('add_item',{itemId:'sache',quantity:2})]
      if(turn===scenario.messages.length-1)commands=[draft('set_field',{field:'fulfillment_type',value:'counter'}),{name:'prepare_product_order',args:{customer_id:fixture.customer,items:id===5?[{product_id:'racao-a',quantity:1}]:[{product_id:'racao-a',quantity:1},{product_id:'sache',quantity:2}],fulfillment_type:'counter',operation_id:'cart'}}]
      if(turn===scenario.messages.length)commands=[{name:'commit_confirmed_proposal',args:proposal!}]
     }else if(step===1&&((id===5&&turn===3)||(id===8&&turn===2))){
      const selected=results.find(r=>r.data?.option)?.data.option
      expect(selected?.id).toBe('racao-a')
      commands=[draft('add_item',{itemId:selected.id,quantity:1})]
     }
     if(!commands.length){
      if(id===5&&turn===1)facts=['call-1-1-1:empty']
      if(id===5&&turn===2){facts=['call-2-1-0:product.0'];question='choice'}
      if(id===8&&turn===1){facts=['call-1-1-1:product.1','call-1-1-1:product.0'];question='choice'}
      if(id===8&&turn===3)question='clarify'
      if(turn===scenario.messages.length)facts=[`call-${turn}-1-0:result`]
     }
     step++
     const toolCalls=commands.map((c,i)=>{expect(scenario.allowedTools).toContain(c.name);expect(scenario.forbiddenTools).not.toContain(c.name);executed.push(c.name);return{id:`call-${turn}-${step}-${i}`,type:'function' as const,function:{name:c.name,arguments:JSON.stringify(c.args)}}})
     return{content:toolCalls.length?null:JSON.stringify({opening:'acknowledge',facts,question}),toolCalls,usage:{promptTokens:10,completionTokens:10},rateLimit:{remainingRequests:900,remainingTokens:7000,resetRequests:null,resetTokens:null},requestLimit:1000}
    }}
    const before=await loadConversationMemory(db,context)
    const result=await runLunaTurn({database:db,provider,context})
    expect(result.errorCode,JSON.stringify({id,turn,result})).toBeNull();replies.push(result.reply!)
    // Preparation by itself does not claim an option was sent/accepted.
    expect(await loadConversationMemory(db,context)).toEqual(before)
    const outbound=`out-${turn}`;clock.mockReturnValue(Date.now()+1)
    await db.prepare(`INSERT INTO chat_messages(tenant_id,module_id,id,thread_id,direction,actor_type,content_text,created_at_ms) VALUES(?1,'petshop',?2,?3,'outbound','assistant',?4,?5)`).bind(tenant,outbound,ctx.conversationId,result.reply,Date.now()).run()
    await recordProposalPresentation(db,context,result.proposalIds,outbound)
    const memory=await loadConversationMemory(db,context)
    if(id===5&&turn===1){expect(memory.options).toEqual([]);expect(result.reply).toContain('Nenhum produto')}
    if(id===5&&turn===2)expect(memory.options.map(o=>o.id)).toEqual(['racao-a'])
    if(id===8&&turn===1)expect(memory.options.map(o=>o.id)).toEqual(['racao-b','racao-a'])
    const row=await db.prepare(`SELECT state_json,summary_text FROM luna_conversations WHERE tenant_id=?1 AND conversation_id=?2`).bind(tenant,ctx.conversationId).first<{state_json:string;summary_text:string}>()
    const state=loadOperationalState(row!.state_json)
    if(id===8&&turn===3){expect(state.operations.cart.items).toEqual([{id:'racao-a',quantity:1}]);expect(memory.question).toBe('clarify');expect(memory.targetOperationId).toBe('cart')}
    if(row!.summary_text)expect(JSON.parse(row!.summary_text).operations).toBeInstanceOf(Array)
    if(turn<scenario.messages.length)expect((await db.prepare(`SELECT id FROM sales WHERE tenant_id=?1`).bind(tenant).all()).results).toEqual([])
   }
   expect((await db.prepare(`SELECT total_cents,status FROM sales WHERE tenant_id=?1`).bind(tenant).all()).results).toEqual([{total_cents:id===5?9000:10600,status:'pending'}])
   for(const table of ['payments','inventory_movements'])expect(await db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE tenant_id=?1`).bind(tenant).first()).toEqual({count:0})
   expect(executed.filter(n=>n==='commit_confirmed_proposal')).toHaveLength(1);expect(replies).toHaveLength(scenario.messages.length)
  }finally{clock.mockRestore()}
 })
})
