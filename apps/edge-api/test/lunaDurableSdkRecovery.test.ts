import { describe,expect,it } from 'vitest'
import { GroqSdkProvider } from '../src/luna/providers/groqSdkProvider'
import { groqWireToolArguments } from '../src/luna/providers/groqToolSchema'
import { runLunaTurn } from '../src/luna/runLunaTurn'
import { createD1TurnJournal } from '../src/luna/turnJournal'
import { createLunaToolRegistry } from '../src/luna/toolRegistry'
import { DRAFT_TOOL_DEFINITIONS } from '../src/luna/draftTools'
import { createDesignedHarness } from './fixtures/luna/designedRuntimeHarness'

describe('ToolLoopAgent durable replay on real Worker/D1',()=>{
 it('resumes a persisted model/tool checkpoint after quota and runtime reconstruction without replaying HTTP or draft effects',async()=>{
  const h=await createDesignedHarness(1,'-durable-sdk-quota')
  try {
   const context={...h.ctx,sourceMessageId:'durable-inbound',traceId:'durable-trace'}
   await h.db.prepare(`INSERT INTO chat_messages(tenant_id,module_id,id,thread_id,external_message_id,direction,actor_type,content_text,created_at_ms) VALUES(?1,'petshop',?2,?3,?2,'inbound','customer','Quero uma Ração A.',?4)`)
    .bind(h.tenant,context.sourceMessageId,context.conversationId,h.start).run()
   const definitions=[...createLunaToolRegistry(h.db).definitions,...DRAFT_TOOL_DEFINITIONS]
   const commands=[
    {name:'search_products',args:{query:'Ração A'}},
    {name:'draft_add_item',args:{operation_id:'cart',kind:'cart',item_id:'racao-a',quantity:1}},
    {name:'finish_turn',args:{intent:'cart',operation_ids:['cart'],social:[],fact_ids:['durable-call-1:product.0'],question:'fulfillment'}},
   ]
   let requests=0
   const provider=new GroqSdkProvider({apiKey:'fixture-not-real',model:'openai/gpt-oss-20b',fetchFn:async()=>{
    const command=commands[requests++]
    if(!command)throw new Error('Unexpected external model replay')
    const definition=definitions.find(d=>d.name===command.name)
    const args=definition?groqWireToolArguments(JSON.stringify(command.args),definition.parameters):JSON.stringify(command.args)
    return Response.json({choices:[{index:0,finish_reason:'tool_calls',message:{content:null,tool_calls:[{id:`durable-call-${requests}`,type:'function',function:{name:command.name,arguments:args}}]}}],usage:{prompt_tokens:100,completion_tokens:30}},
     {headers:requests===1?{'x-ratelimit-limit-tokens':'6000','x-ratelimit-remaining-tokens':'0','x-ratelimit-reset-tokens':'1s'}:{}})
   }})
   const execute=()=>runLunaTurn({database:h.db,provider,context,journal:createD1TurnJournal(h.db,context,'fixture-sha:durable-v1')})
   await expect(execute()).rejects.toMatchObject({resumeAtMs:h.start+1250})
   expect(requests).toBe(1)
   expect((await h.db.prepare(`SELECT status FROM luna_turn_steps WHERE tenant_id=?1 AND step_key='tool:durable-call-1'`).bind(h.tenant).first())).toEqual({status:'complete'})
   h.clock.mockReturnValue(h.start+2000)
   const result=await execute()
   expect(result).toMatchObject({status:'replied',errorCode:null,usage:{modelCalls:3}})
   expect(result.reply).toContain('Ração A: R$ 90,00')
   expect(requests).toBe(3)
   expect((await h.state()).operations.cart.items).toEqual([{id:'racao-a',quantity:1}])
   expect(await h.db.prepare(`SELECT COUNT(*) AS n FROM luna_operation_events WHERE tenant_id=?1`).bind(h.tenant).first()).toEqual({n:1})
   const recovered=await execute()
   expect(recovered).toEqual(result)
   expect(requests).toBe(3)
   expect(await h.db.prepare(`SELECT COUNT(*) AS n FROM sales WHERE tenant_id=?1`).bind(h.tenant).first()).toEqual({n:0})
  } finally {h.close()}
 })
 it('retains the uncertain model checkpoint and never reissues a timed-out external request on restart',async()=>{
  const h=await createDesignedHarness(1,'-durable-sdk-timeout')
  try {
   const context={...h.ctx,sourceMessageId:'timeout-inbound',traceId:'timeout-trace'}
   await h.db.prepare(`INSERT INTO chat_messages(tenant_id,module_id,id,thread_id,external_message_id,direction,actor_type,content_text,created_at_ms) VALUES(?1,'petshop',?2,?3,?2,'inbound','customer','Quero uma Ração A.',?4)`)
    .bind(h.tenant,context.sourceMessageId,context.conversationId,h.start).run()
   let requests=0
   const provider=new GroqSdkProvider({apiKey:'fixture-not-real',model:'openai/gpt-oss-20b',fetchFn:async()=>{requests++;throw new Error('HTTP response lost')}})
   const execute=()=>runLunaTurn({database:h.db,provider,context,journal:createD1TurnJournal(h.db,context,'fixture-sha:durable-v1')})
   await expect(execute()).rejects.toMatchObject({code:'GROQ_REQUEST_FAILED'})
   await expect(execute()).rejects.toMatchObject({code:'GROQ_REQUEST_FAILED'})
   expect(requests).toBe(1)
   expect(await h.db.prepare(`SELECT COUNT(*) AS n FROM sales WHERE tenant_id=?1`).bind(h.tenant).first()).toEqual({n:0})
  } finally {h.close()}
 })
})
