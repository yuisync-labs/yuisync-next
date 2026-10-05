import { env } from 'cloudflare:workers'
import { describe, expect, it, vi } from 'vitest'
import { runLunaTurn } from '../src/luna/runLunaTurn'
import { loadOperationalState } from '../src/luna/operationalState'
import { recordProposalPresentation } from '../src/luna/proposalPresentation'
import { LUNA_DESIGNED_SCENARIOS, LUNA_SCENARIO_CLOCK } from './fixtures/luna/designedScenarios'
import type { LunaMessage, LunaProviderResponse } from '../src/luna/contracts'

const db = (env as EdgeEnv & { DB: D1Database }).DB
describe('Luna designed scenario 10 — real Worker/local D1/simulated provider', () => {
  it('corrige Marina para Mariana antes da confirmação e não duplica Theo', async () => {
    const scenario = LUNA_DESIGNED_SCENARIOS.find(s => s.id === 10)!
    const start = Date.parse(LUNA_SCENARIO_CLOCK.now), tenant = 'luna-designed-10'
    const clock = vi.spyOn(Date,'now').mockReturnValue(start)
    const ctx = { tenantId: tenant, moduleId: 'petshop' as const, conversationId: 'scenario-10', customerAddress: '5532999990110', phoneNumberId: 'fixture-no-whatsapp', sourceMessageId: '', traceId: '', executionMode: 'fixture' as const }
    try {
      await db.batch([
        db.prepare(`INSERT INTO tenants(id,slug,name,status,created_at_ms,updated_at_ms) VALUES(?1,?1,'Cenário 10 fictício','active',?2,?2)`).bind(tenant,start),
        db.prepare(`INSERT INTO chat_threads(tenant_id,module_id,id,channel,external_thread_id,status,last_message_at_ms,created_at_ms,updated_at_ms) VALUES(?1,'petshop',?2,'whatsapp',?3,'open',?4,?4,?4)`).bind(tenant,ctx.conversationId,ctx.customerAddress,start),
      ])
      let version = 0, reference: {proposal_id:string;proposal_version:number} | null = null
      const executed: string[] = []
      for (let turn=1;turn<=scenario.messages.length;turn++) {
        clock.mockReturnValue(start+turn*10000)
        const context = {...ctx,sourceMessageId:`in-${turn}`,traceId:`scenario-10-${turn}`}
        await db.prepare(`INSERT INTO chat_messages(tenant_id,module_id,id,thread_id,external_message_id,direction,actor_type,content_text,created_at_ms) VALUES(?1,'petshop',?2,?3,?2,'inbound','customer',?4,?5)`).bind(tenant,context.sourceMessageId,ctx.conversationId,scenario.messages[turn-1],Date.now()).run()
        const commands: {name:string;args:Record<string,unknown>}[] = []
        const field = (key:string,value:string) => commands.push({name:'update_operation_draft',args:{operationId:'registration',kind:'registration',expectedVersion:version++,action:'set_field',field:key,value}})
        if(turn===1){ commands.push({name:'get_customer_context',args:{}});field('customer_name','Marina');field('pet_name','Theo') }
        if(turn===2)field('customer_name','Mariana')
        if(turn===3){field('species','dog');field('breed','Poodle');field('weight_kg','8');commands.push({name:'prepare_customer_registration',args:{customer_name:'Mariana',pet_name:'Theo',species:'dog',breed:'Poodle',weight_kg:8,operation_id:'registration'}})}
        if(turn===4){expect(reference).not.toBeNull();commands.push({name:'commit_confirmed_proposal',args:reference!})}
        let step=0,lastCall=''
        const provider={model:'offline-scripted-provider',async complete(input:{messages:readonly LunaMessage[]}):Promise<LunaProviderResponse & {requestLimit:number}>{
          const results=input.messages.filter(m=>m.role==='tool').map(m=>JSON.parse(m.content!))
          // No existing customer on the first turn is an expected query result.
          expect(results.filter(r=>!r.ok).every(r=>turn===1&&r.code==='CUSTOMER_NOT_FOUND')).toBe(true)
          const prepared=results.find(r=>r.data?.proposal_id)
          if(prepared)reference={proposal_id:prepared.data.proposal_id,proposal_version:prepared.data.proposal_version}
          const batch=step++===0?commands:[]
          const toolCalls=batch.map((c,index)=>{expect(scenario.allowedTools).toContain(c.name);expect(scenario.forbiddenTools).not.toContain(c.name);executed.push(c.name);lastCall=`call-${turn}-${index}`;return{id:lastCall,type:'function' as const,function:{name:c.name,arguments:JSON.stringify(c.args)}}})
          return{content:toolCalls.length?null:JSON.stringify({opening:'acknowledge',facts:turn===4?[`${lastCall}:result`]:[],question:'none'}),toolCalls,usage:{promptTokens:10,completionTokens:10},rateLimit:{remainingRequests:900,remainingTokens:7000,resetRequests:null,resetTokens:null},requestLimit:1000}
        }}
        const result=await runLunaTurn({database:db,provider,context})
        expect(result.errorCode).toBeNull()
        expect(result.status).toBe(turn===3?'awaiting_confirmation':'replied')
        clock.mockReturnValue(Date.now()+1)
        await db.prepare(`INSERT INTO chat_messages(tenant_id,module_id,id,thread_id,direction,actor_type,content_text,created_at_ms) VALUES(?1,'petshop',?2,?3,'outbound','assistant',?4,?5)`).bind(tenant,`out-${turn}`,ctx.conversationId,result.reply,Date.now()).run()
        await recordProposalPresentation(db,context,result.proposalIds,`out-${turn}`)
        const row=await db.prepare('SELECT state_json FROM luna_conversations WHERE tenant_id=?1 AND conversation_id=?2').bind(tenant,ctx.conversationId).first<{state_json:string}>()
        const draft=loadOperationalState(row!.state_json).operations.registration
        expect(draft.fields.customer_name).toBe(turn===1?'Marina':'Mariana')
        const clients=await db.prepare('SELECT name,phone FROM clients WHERE tenant_id=?1').bind(tenant).all()
        if(turn<4)expect(clients.results).toEqual([])
        else expect(clients.results).toEqual([{name:'Mariana',phone:ctx.customerAddress}])
        if(turn===3){expect(result.reply).toContain('Cliente: Mariana');expect(result.reply).toContain('Pet: Theo');expect(result.reply).toContain('Peso: 8 kg')}
        if(turn===4){
          const {createLunaToolRegistry}=await import('../src/luna/toolRegistry')
          expect(await createLunaToolRegistry(db).execute('commit_confirmed_proposal',reference!,context)).toMatchObject({ok:true,data:{idempotent:true}})
          expect(await db.prepare('SELECT name,breed,weight_kg FROM pets WHERE tenant_id=?1').bind(tenant).all()).toMatchObject({results:[{name:'Theo',breed:'Poodle',weight_kg:8}]})
        }
      }
      expect(executed).toContain('prepare_customer_registration')
    } finally {clock.mockRestore()}
  })
})
