import { env } from 'cloudflare:workers'
import { describe, expect, it, vi } from 'vitest'
import { runLunaTurn } from '../src/luna/runLunaTurn'
import { createD1TurnJournal } from '../src/luna/turnJournal'
import { loadOperationalState } from '../src/luna/operationalState'
import { LUNA_DESIGNED_SCENARIOS, LUNA_SCENARIO_CLOCK, LUNA_SCENARIO_FIXTURE } from './fixtures/luna/designedScenarios'
import type { LunaMessage, LunaProviderResponse } from '../src/luna/contracts'
const db=(env as EdgeEnv & {DB:D1Database}).DB
describe('designed scenario 19 — real Worker/local D1/simulated provider',()=>{
  it('one agenda timeout, preserved draft, safe consultation and actual clinical-risk handoff',async()=>{
    const scenario=LUNA_DESIGNED_SCENARIOS.find(s=>s.id===19)!,fixture=LUNA_SCENARIO_FIXTURE
    const tenant='designed-recovery-19',start=Date.parse(LUNA_SCENARIO_CLOCK.now)
    const clock=vi.spyOn(Date,'now').mockReturnValue(start)
    const ctx={tenantId:tenant,moduleId:'petshop' as const,conversationId:'scenario-19',customerAddress:fixture.phone,phoneNumberId:'fixture-no-whatsapp',sourceMessageId:'',traceId:'',executionMode:'fixture' as const}
    let queryAttempts=0,faultInjected=false
    const faultyDB=new Proxy(db,{get(target,key){
      if(key==='prepare')return(sql:string)=>{
        const wrap=(statement:D1PreparedStatement):D1PreparedStatement=>new Proxy(statement,{get(s,k){
          if(k==='bind')return(...values:unknown[])=>wrap(s.bind(...values))
          if(k==='all'&&sql.includes('SELECT scheduled_at_ms,duration_min FROM appointments'))return async()=>{
            queryAttempts++
            if(!faultInjected){faultInjected=true;throw new Error('FIXTURE_AGENDA_TIMEOUT')}
            return s.all()
          }
          const value=Reflect.get(s,k,s);return typeof value==='function'?value.bind(s):value
        }})
        return wrap(target.prepare(sql))
      }
      const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value
    }})
    try{
      const hours=Object.fromEntries(Array.from({length:7},(_,i)=>[String(i+1),i<5?[{open:'08:00',close:'18:00'}]:[]]))
      await db.batch([
        db.prepare(`INSERT INTO tenants(id,slug,name,status,created_at_ms,updated_at_ms) VALUES(?1,?1,'Fixture','active',?2,?2)`).bind(tenant,start),
        db.prepare(`INSERT INTO clients(tenant_id,module_id,id,name,phone,status,created_at_ms,updated_at_ms) VALUES(?1,'petshop',?2,'Maria',?3,'active',?4,?4)`).bind(tenant,fixture.customer,fixture.phone,start),
        db.prepare(`INSERT INTO pets(tenant_id,module_id,id,client_id,name,species,weight_kg,status,created_at_ms,updated_at_ms) VALUES(?1,'petshop','mel',?2,'Mel','dog',8,'active',?3,?3)`).bind(tenant,fixture.customer,start),
        db.prepare(`INSERT INTO chat_threads(tenant_id,module_id,id,channel,external_thread_id,status,last_message_at_ms,created_at_ms,updated_at_ms) VALUES(?1,'petshop',?2,'whatsapp',?3,'open',?4,?4,?4)`).bind(tenant,ctx.conversationId,fixture.phone,start),
        db.prepare(`INSERT INTO services(tenant_id,module_id,id,code,name,group_type,default_price_cents,default_duration_min,status,created_at_ms,updated_at_ms) VALUES(?1,'petshop','banho','banho','Banho','banho_tosa',5500,60,'active',?2,?2)`).bind(tenant,start),
        db.prepare(`INSERT INTO module_settings_extensions(tenant_id,module_id,data_json,updated_at_ms) VALUES(?1,'petshop',?2,?3)`).bind(tenant,JSON.stringify({petbot_timezone:'America/Sao_Paulo',petbot_business_hours:hours,petbot_booking_capacity:1}),start),
      ])
      let savedDraft:unknown
      const called:string[]=[]
      for(let turn=1;turn<=scenario.messages.length;turn++){
        clock.mockReturnValue(start+turn*10000)
        const context={...ctx,sourceMessageId:`in-${turn}`,traceId:`trace-${turn}`}
        await db.prepare(`INSERT INTO chat_messages(tenant_id,module_id,id,thread_id,external_message_id,direction,actor_type,content_text,created_at_ms) VALUES(?1,'petshop',?2,?3,?2,'inbound','customer',?4,?5)`).bind(tenant,context.sourceMessageId,ctx.conversationId,scenario.messages[turn-1],Date.now()).run()
        let sent=false
        const provider={model:'offline-scripted-provider',async complete(input:{messages:readonly LunaMessage[]}):Promise<LunaProviderResponse & {requestLimit:number}>{
          const results=input.messages.filter(m=>m.role==='tool').map(m=>JSON.parse(m.content!))
          expect(results.every(r=>r.ok)).toBe(true)
          const commands=sent?[]:turn===1?[
            {name:'get_customer_context',args:{}},
            {name:'search_services',args:{query:'Banho'}},
            {name:'update_operation_draft',args:{operationId:'booking',kind:'booking',expectedVersion:0,action:'set_field',field:'pet_id',value:'mel'}},
            {name:'update_operation_draft',args:{operationId:'booking',kind:'booking',expectedVersion:1,action:'add_item',itemId:'banho',quantity:1}},
            {name:'update_operation_draft',args:{operationId:'booking',kind:'booking',expectedVersion:2,action:'set_field',field:'scheduled_at',value:'2026-10-07'}},
            {name:'get_available_slots',args:{service_ids:['banho'],starts_at:'2026-10-07T11:00:00Z',ends_at:'2026-10-07T21:00:00Z'}},
          ]:turn===2?[
            {name:'get_available_slots',args:{service_ids:['banho'],starts_at:'2026-10-07T11:00:00Z',ends_at:'2026-10-07T21:00:00Z'}},
          ]:[{name:'handoff_to_human',args:{reason:'Cliente solicitou humano e relatou falta de ar; não diagnosticar nem prescrever.'}}]
          sent=true
          const toolCalls=commands.map((command,i)=>{
            expect(scenario.allowedTools).toContain(command.name);expect(scenario.forbiddenTools).not.toContain(command.name)
            called.push(command.name)
            return{id:`call-${turn}-${i}`,type:'function' as const,function:{name:command.name,arguments:JSON.stringify(command.args)}}
          })
          return{content:toolCalls.length?null:JSON.stringify({opening:'acknowledge',facts:turn===2?['call-2-0:slot.0']:[],question:'none'}),toolCalls,usage:{promptTokens:10,completionTokens:10},rateLimit:{remainingRequests:900,remainingTokens:7000,resetRequests:null,resetTokens:null},requestLimit:1000}
        }}
        const result=await runLunaTurn({database:faultyDB,provider,context,journal:createD1TurnJournal(db,context,'designed-final-durable-v1')})
        expect(result.errorCode,JSON.stringify({turn,result})).toBeNull()
        expect(result.proposalIds).toEqual([]);expect(result.committedOperationIds).toEqual([])
        const row=await db.prepare(`SELECT state_json,status FROM luna_conversations WHERE tenant_id=?1 AND conversation_id=?2`).bind(tenant,ctx.conversationId).first<{state_json:string;status:string}>()
        const draft=loadOperationalState(row!.state_json).operations.booking
        if(turn===1){savedDraft=draft;expect(faultInjected).toBe(true);expect(queryAttempts).toBe(2);expect(result.reply).not.toContain('Agendamento registrado')}
        else expect(draft).toEqual(savedDraft)
        if(turn===2){expect(queryAttempts).toBe(3);expect(result.reply).toContain('Ainda não reservada')}
        if(turn===3){
          expect(result.status).toBe('handoff');expect(row!.status).toBe('handoff')
          expect(await db.prepare(`SELECT status FROM chat_threads WHERE tenant_id=?1 AND id=?2`).bind(tenant,ctx.conversationId).first()).toEqual({status:'handoff'})
          expect(result.reply).toBe('Vou encaminhar esta conversa para uma pessoa da equipe continuar o atendimento.')
        }
        await db.prepare(`INSERT INTO chat_messages(tenant_id,module_id,id,thread_id,direction,actor_type,content_text,created_at_ms) VALUES(?1,'petshop',?2,?3,'outbound','assistant',?4,?5)`).bind(tenant,`out-${turn}`,ctx.conversationId,result.reply,Date.now()+1).run()
      }
      for(const table of ['appointments','sales','payments','luna_proposals'])expect(await db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE tenant_id=?1`).bind(tenant).first()).toEqual({count:0})
      expect(called.filter(name=>name==='handoff_to_human')).toHaveLength(1)
      expect(called).not.toContain('commit_confirmed_proposal')
    }finally{clock.mockRestore()}
  })
})
