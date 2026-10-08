import { env } from 'cloudflare:workers'
import { describe, expect, it, vi } from 'vitest'
import { runLunaTurn } from '../src/luna/runLunaTurn'
import { createD1TurnJournal } from '../src/luna/turnJournal'
import { loadOperationalState } from '../src/luna/operationalState'
import { recordProposalPresentation } from '../src/luna/proposalPresentation'
import { LUNA_DESIGNED_SCENARIOS, LUNA_SCENARIO_CLOCK, LUNA_SCENARIO_FIXTURE } from './fixtures/luna/designedScenarios'
import type { LunaMessage, LunaProviderResponse } from '../src/luna/contracts'

const db=(env as EdgeEnv & {DB:D1Database}).DB
describe('designed scenario 14 — real Worker/local D1/simulated provider',()=>{
  it('lost D1 response, rejected outbound, redelivery and reconfirmation never duplicate',async()=>{
    const scenario=LUNA_DESIGNED_SCENARIOS.find(s=>s.id===14)!,fixture=LUNA_SCENARIO_FIXTURE
    const tenant='designed-recovery-14',start=Date.parse(LUNA_SCENARIO_CLOCK.now)
    const clock=vi.spyOn(Date,'now').mockReturnValue(start)
    const ctx={tenantId:tenant,moduleId:'petshop' as const,conversationId:'scenario-14',customerAddress:fixture.phone,phoneNumberId:'fixture-no-whatsapp',sourceMessageId:'',traceId:'',executionMode:'fixture' as const}
    try{
      await db.batch([
        db.prepare(`INSERT INTO tenants(id,slug,name,status,created_at_ms,updated_at_ms) VALUES(?1,?1,'Fixture','active',?2,?2)`).bind(tenant,start),
        db.prepare(`INSERT INTO clients(tenant_id,module_id,id,name,phone,status,created_at_ms,updated_at_ms) VALUES(?1,'petshop',?2,'Maria',?3,'active',?4,?4)`).bind(tenant,fixture.customer,fixture.phone,start),
        db.prepare(`INSERT INTO chat_threads(tenant_id,module_id,id,channel,external_thread_id,status,last_message_at_ms,created_at_ms,updated_at_ms) VALUES(?1,'petshop',?2,'whatsapp',?3,'open',?4,?4,?4)`).bind(tenant,ctx.conversationId,fixture.phone,start),
        db.prepare(`INSERT INTO catalog_products(tenant_id,module_id,id,name,price_cents,status,created_at_ms,updated_at_ms) VALUES(?1,'petshop','racao-a','Ração A',9000,'active',?2,?2)`).bind(tenant,start),
        db.prepare(`INSERT INTO inventory_balances(tenant_id,module_id,product_id,on_hand_milliunits,reserved_milliunits,reorder_milliunits,version,updated_at_ms) VALUES(?1,'petshop','racao-a',10000,0,0,1,?2)`).bind(tenant,start),
      ])
      let proposal:{proposal_id:string;proposal_version:number}|null=null
      let faultArmed=false,faultInjected=false,saleBatchCount=0
      const faultyDB=new Proxy(db,{
        get(target,key){
          if(key==='batch')return async(statements:D1PreparedStatement[])=>{
            const before=await target.prepare(`SELECT COUNT(*) AS count FROM sales WHERE tenant_id=?1`).bind(tenant).first<{count:number}>()
            const result=await target.batch(statements)
            const after=await target.prepare(`SELECT COUNT(*) AS count FROM sales WHERE tenant_id=?1`).bind(tenant).first<{count:number}>()
            if(after!.count>before!.count){saleBatchCount++;if(faultArmed){faultArmed=false;faultInjected=true;throw new Error('FIXTURE_RESPONSE_LOST_AFTER_PERSISTENCE')}}
            return result
          }
          const value=Reflect.get(target,key,target)
          return typeof value==='function'?value.bind(target):value
        },
      })
      const toolNames:string[]=[],reconciled:boolean[]=[]
      let inferences=0
      for(const turn of [1,2,2,3]){
        const redelivery=turn===2&&faultInjected
        clock.mockReturnValue(start+turn*10000+(redelivery?100:0))
        const context={...ctx,sourceMessageId:`in-${turn}`,traceId:`turn-${turn}-${redelivery?'redelivery':'first'}`}
        if(!redelivery)await db.prepare(`INSERT INTO chat_messages(tenant_id,module_id,id,thread_id,external_message_id,direction,actor_type,content_text,created_at_ms) VALUES(?1,'petshop',?2,?3,?2,'inbound','customer',?4,?5)`).bind(tenant,context.sourceMessageId,ctx.conversationId,scenario.messages[turn-1],Date.now()).run()
        let called=false
        if(turn===2&&!redelivery)faultArmed=true
        const provider={model:'offline-scripted-provider',async complete(input:{messages:readonly LunaMessage[]}):Promise<LunaProviderResponse & {requestLimit:number}>{
          inferences++
          const results=input.messages.filter(m=>m.role==='tool').map(m=>JSON.parse(m.content!))
          expect(results.every(r=>r.ok),JSON.stringify({turn,redelivery,results})).toBe(true)
          const prepared=results.find(r=>r.data?.proposal_id&&Number.isSafeInteger(r.data?.proposal_version))
          if(prepared)proposal={proposal_id:prepared.data.proposal_id,proposal_version:prepared.data.proposal_version}
          const committed=results.find(r=>r.data?.operation_id)
          if(committed)reconciled.push(committed.data.idempotent)
          const commands=called?[]:turn===1?[
            {name:'get_customer_context',args:{}},
            {name:'search_products',args:{query:'Ração A'}},
            {name:'update_operation_draft',args:{operationId:'cart',kind:'cart',expectedVersion:0,action:'add_item',itemId:'racao-a',quantity:1}},
            {name:'update_operation_draft',args:{operationId:'cart',kind:'cart',expectedVersion:1,action:'set_field',field:'fulfillment_type',value:'counter'}},
            {name:'prepare_product_order',args:{customer_id:fixture.customer,items:[{product_id:'racao-a',quantity:1}],fulfillment_type:'counter',operation_id:'cart'}},
          ]:[{name:'get_operation_status',args:{proposal_id:proposal!.proposal_id}},{name:'commit_confirmed_proposal',args:proposal!}]
          called=true
          const toolCalls=commands.map((command,i)=>{
            expect(scenario.allowedTools).toContain(command.name);expect(scenario.forbiddenTools).not.toContain(command.name)
            toolNames.push(command.name)
            return{id:`call-${turn}-${i}`,type:'function' as const,function:{name:command.name,arguments:JSON.stringify(command.args)}}
          })
          return{content:toolCalls.length?null:JSON.stringify({opening:'acknowledge',facts:turn===1?[]:[`call-${turn}-1:result`],question:'none'}),toolCalls,usage:{promptTokens:10,completionTokens:10},rateLimit:{remainingRequests:900,remainingTokens:7000,resetRequests:null,resetTokens:null},requestLimit:1000}
        }}
        const result=await runLunaTurn({database:faultyDB,provider,context,journal:createD1TurnJournal(db,context,'designed-final-durable-v1')})
        expect(result.errorCode,JSON.stringify({turn,redelivery,result,toolNames})).toBeNull()
        if(turn===1){
          expect(result.status).toBe('awaiting_confirmation')
          expect(result.reply).toContain('Total: R$ 90,00')
          expect((await db.prepare(`SELECT id FROM sales WHERE tenant_id=?1`).bind(tenant).all()).results).toEqual([])
        }else{
          expect(result.reply).toContain('não significa que o pagamento foi recebido')
          expect(result.committedOperationIds).toHaveLength(1)
          expect((await db.prepare(`SELECT status,total_cents FROM sales WHERE tenant_id=?1`).bind(tenant).all()).results).toEqual([{status:'pending',total_cents:9000}])
        }
        // The first post-commit send is rejected: no persisted accepted message
        // and no presentation evidence may be created for this attempted send.
        if(turn===2&&!redelivery){
          expect(faultInjected).toBe(true)
          expect((await db.prepare(`SELECT id FROM chat_messages WHERE tenant_id=?1 AND id='out-2-first'`).bind(tenant).all()).results).toEqual([])
        }else{
          clock.mockReturnValue(Date.now()+1)
          const outbound=`out-${turn}-${redelivery?'redelivery':'first'}`
          await db.prepare(`INSERT INTO chat_messages(tenant_id,module_id,id,thread_id,direction,actor_type,content_text,created_at_ms) VALUES(?1,'petshop',?2,?3,'outbound','assistant',?4,?5)`).bind(tenant,outbound,ctx.conversationId,result.reply,Date.now()).run()
          await recordProposalPresentation(db,context,result.proposalIds,outbound)
        }
        const state=await db.prepare(`SELECT state_json FROM luna_conversations WHERE tenant_id=?1 AND conversation_id=?2`).bind(tenant,ctx.conversationId).first<{state_json:string}>()
        expect(loadOperationalState(state!.state_json).operations.cart.items).toEqual([{id:'racao-a',quantity:1}])
      }
      expect(faultInjected).toBe(true);expect(saleBatchCount).toBe(1)
      expect(reconciled).toEqual([true,true])
      expect(toolNames.filter(n=>n==='commit_confirmed_proposal')).toHaveLength(2)
      expect(inferences).toBe(6) // No model invocation on redelivery of in-2.
      expect(await db.prepare(`SELECT COUNT(*) AS count FROM luna_proposal_presentations WHERE tenant_id=?1`).bind(tenant).first()).toEqual({count:1})
      for(const table of ['payments','inventory_movements'])expect(await db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE tenant_id=?1`).bind(tenant).first()).toEqual({count:0})
      expect(await db.prepare(`SELECT on_hand_milliunits,reserved_milliunits FROM inventory_balances WHERE tenant_id=?1`).bind(tenant).first()).toEqual({on_hand_milliunits:10000,reserved_milliunits:1000})
    }finally{clock.mockRestore()}
  // Four complete Worker turns plus lost-response/redelivery reconciliation.
  // Full-suite workerd/D1 contention is not the application's turn deadline.
  // Keep every financial/idempotency assertion; extend only this composite test.
  },60_000)
})
