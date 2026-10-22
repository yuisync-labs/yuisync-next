import { env } from 'cloudflare:workers'
import { describe, expect, it, vi } from 'vitest'
import { runLunaTurn } from '../src/luna/runLunaTurn'
import { loadOperationalState } from '../src/luna/operationalState'
import { recordProposalPresentation } from '../src/luna/proposalPresentation'
import { LUNA_DESIGNED_SCENARIOS, LUNA_SCENARIO_CLOCK, LUNA_SCENARIO_FIXTURE } from './fixtures/luna/designedScenarios'
import type { LunaMessage, LunaProviderResponse } from '../src/luna/contracts'
const db=(env as EdgeEnv & {DB:D1Database}).DB
describe('designed scenario 17 — real Worker/local D1/simulated provider',()=>{
  it('scissors without machine number, factual duration, pet/service correction, confirmed machine snapshot',async()=>{
    const scenario=LUNA_DESIGNED_SCENARIOS.find(s=>s.id===17)!,fixture=LUNA_SCENARIO_FIXTURE
    const tenant='designed-booking-17',start=Date.parse(LUNA_SCENARIO_CLOCK.now)
    const clock=vi.spyOn(Date,'now').mockReturnValue(start)
    const ctx={tenantId:tenant,moduleId:'petshop' as const,conversationId:'scenario-17',customerAddress:fixture.phone,phoneNumberId:'fixture-no-whatsapp',sourceMessageId:'',traceId:'',executionMode:'fixture' as const}
    try{
      const hours=Object.fromEntries(Array.from({length:7},(_,i)=>[String(i+1),i<5?[{open:'08:00',close:'18:00'}]:[]]))
      await db.batch([
        db.prepare(`INSERT INTO tenants(id,slug,name,status,created_at_ms,updated_at_ms) VALUES(?1,?1,'Fixture','active',?2,?2)`).bind(tenant,start),
        db.prepare(`INSERT INTO clients(tenant_id,module_id,id,name,phone,status,created_at_ms,updated_at_ms) VALUES(?1,'petshop',?2,'Maria',?3,'active',?4,?4)`).bind(tenant,fixture.customer,fixture.phone,start),
        ...['mel','luna'].map(pet=>db.prepare(`INSERT INTO pets(tenant_id,module_id,id,client_id,name,species,weight_kg,status,created_at_ms,updated_at_ms) VALUES(?1,'petshop',?2,?3,?2,'dog',8,'active',?4,?4)`).bind(tenant,pet,fixture.customer,start)),
        db.prepare(`INSERT INTO chat_threads(tenant_id,module_id,id,channel,external_thread_id,status,last_message_at_ms,created_at_ms,updated_at_ms) VALUES(?1,'petshop',?2,'whatsapp',?3,'open',?4,?4,?4)`).bind(tenant,ctx.conversationId,fixture.phone,start),
        ...fixture.services.filter(s=>s.id.startsWith('tosa')).map(s=>db.prepare(`INSERT INTO services(tenant_id,module_id,id,code,name,group_type,default_price_cents,default_duration_min,status,created_at_ms,updated_at_ms) VALUES(?1,'petshop',?2,?2,?2,'banho_tosa',?3,?4,'active',?5,?5)`).bind(tenant,s.id,s.priceCents,s.durationMin,start)),
        db.prepare(`INSERT INTO module_settings_extensions(tenant_id,module_id,data_json,updated_at_ms) VALUES(?1,'petshop',?2,?3)`).bind(tenant,JSON.stringify({petbot_timezone:'America/Sao_Paulo',petbot_business_hours:hours,petbot_booking_capacity:1}),start),
      ])
      let version=0,scheduledAt='',proposal:{proposal_id:string;proposal_version:number}|null=null,oldProposal=''
      const draft=(action:string,fields:Record<string,unknown>)=>({name:'update_operation_draft',args:{operationId:'booking',kind:'booking',expectedVersion:version++,action,...fields}})
      const prepare=(machine:boolean,number?:number)=>({name:'prepare_appointment',args:{customer_id:fixture.customer,pet_id:machine?'luna':'mel',service_ids:[machine?'tosa-maquina':'tosa-tesoura'],scheduled_at:scheduledAt,notes:null,operation_id:'booking',...(number==null?{}:{grooming_machine_no:number})}})
      const toolsUsed:string[]=[],transcripts:string[]=[]
      for(let turn=1;turn<=scenario.messages.length;turn++){
        clock.mockReturnValue(start+turn*10000)
        const context={...ctx,sourceMessageId:`in-${turn}`,traceId:`trace-${turn}`}
        await db.prepare(`INSERT INTO chat_messages(tenant_id,module_id,id,thread_id,external_message_id,direction,actor_type,content_text,created_at_ms) VALUES(?1,'petshop',?2,?3,?2,'inbound','customer',?4,?5)`).bind(tenant,context.sourceMessageId,ctx.conversationId,scenario.messages[turn-1],Date.now()).run()
        let step=0
        const provider={model:'offline-scripted-provider',async complete(input:{messages:readonly LunaMessage[]}):Promise<LunaProviderResponse & {requestLimit:number}>{
          const results=input.messages.filter(m=>m.role==='tool').map(m=>JSON.parse(m.content!))
          for(const r of results)if(!r.ok)expect({turn,code:r.code}).toEqual({turn:3,code:'GROOMING_MACHINE_REQUIRED'})
          const prepared=results.find(r=>r.data?.proposal_id&&r.data?.proposal_version)
          if(prepared){proposal={proposal_id:prepared.data.proposal_id,proposal_version:prepared.data.proposal_version};if(turn===1)oldProposal=proposal.proposal_id}
          const slots=results.find(r=>r.data?.slots)?.data.slots
          if(slots){expect(slots.length).toBeGreaterThan(0);scheduledAt=slots[0]}
          let commands:{name:string;args:Record<string,unknown>}[]=[]
          if(step===0){
            if(turn===1)commands=[{name:'get_customer_context',args:{}},{name:'search_services',args:{query:'tosa-tesoura'}},draft('set_field',{field:'pet_id',value:'mel'}),draft('add_item',{itemId:'tosa-tesoura',quantity:1}),{name:'get_available_slots',args:{service_ids:['tosa-tesoura'],starts_at:'2026-10-07T11:00:00Z',ends_at:'2026-10-07T21:00:00Z'}}]
            if(turn===2)commands=[{name:'search_services',args:{query:'tosa-tesoura'}}]
            if(turn===3)commands=[draft('set_field',{field:'pet_id',value:'luna'}),draft('replace_item',{itemId:'tosa-tesoura',replacementId:'tosa-maquina',quantity:1}),prepare(true)]
            if(turn===4)commands=[draft('set_field',{field:'machine_number',value:'4'}),prepare(true,4)]
            if(turn===5)commands=[{name:'commit_confirmed_proposal',args:proposal!}]
          }else if(step===1&&turn===1){expect(scheduledAt).not.toBe('');commands=[draft('set_field',{field:'scheduled_at',value:scheduledAt}),prepare(false)]}
          step++
          const toolCalls=commands.map((command,i)=>{
            expect(scenario.allowedTools).toContain(command.name);expect(scenario.forbiddenTools).not.toContain(command.name);toolsUsed.push(command.name)
            return{id:`call-${turn}-${step}-${i}`,type:'function' as const,function:{name:command.name,arguments:JSON.stringify(command.args)}}
          })
          return{content:toolCalls.length?null:JSON.stringify({opening:'acknowledge',facts:turn===2?['call-2-1-0:service.0']:turn===5?['call-5-1-0:result']:[],question:turn===3?'machine':'none'}),toolCalls,usage:{promptTokens:10,completionTokens:10},rateLimit:{remainingRequests:900,remainingTokens:7000,resetRequests:null,resetTokens:null},requestLimit:1000}
        }}
        const result=await runLunaTurn({database:db,provider,context})
        expect(result.errorCode,JSON.stringify({turn,result})).toBeNull();transcripts.push(result.reply!)
        const row=await db.prepare(`SELECT state_json FROM luna_conversations WHERE tenant_id=?1 AND conversation_id=?2`).bind(tenant,ctx.conversationId).first<{state_json:string}>()
        const booking=loadOperationalState(row!.state_json).operations.booking
        expect(booking.fields.pet_id).toBe(turn<3?'mel':'luna')
        expect(booking.items).toEqual([{id:turn<3?'tosa-tesoura':'tosa-maquina',quantity:1}])
        if(turn===1){expect(result.reply).not.toContain('Qual número');expect(result.reply).not.toContain('Número da máquina');expect(result.proposalIds).toHaveLength(1)}
        if(turn===2)expect(result.reply).toContain('90 minutos')
        if(turn===3){expect(result.proposalIds).toEqual([]);expect(booking.fields.machine_number).toBeUndefined();expect(result.reply).toContain('Qual número');expect(await db.prepare(`SELECT status FROM luna_proposals WHERE tenant_id=?1 AND id=?2`).bind(tenant,oldProposal).first()).toEqual({status:'invalidated'})}
        if(turn===4){expect(booking.fields.machine_number).toBe('4');expect(result.reply).toContain('Número da máquina: 4');expect(result.proposalIds).toHaveLength(1)}
        if(turn<5)expect((await db.prepare(`SELECT id FROM appointments WHERE tenant_id=?1`).bind(tenant).all()).results).toEqual([])
        const outbound=`out-${turn}`;clock.mockReturnValue(Date.now()+1)
        await db.prepare(`INSERT INTO chat_messages(tenant_id,module_id,id,thread_id,direction,actor_type,content_text,created_at_ms) VALUES(?1,'petshop',?2,?3,'outbound','assistant',?4,?5)`).bind(tenant,outbound,ctx.conversationId,result.reply,Date.now()).run()
        await recordProposalPresentation(db,context,result.proposalIds,outbound)
      }
      expect((await db.prepare(`SELECT pet_id,grooming_machine_no,duration_min,subtotal_cents FROM appointments WHERE tenant_id=?1`).bind(tenant).all()).results).toEqual([{pet_id:'luna',grooming_machine_no:4,duration_min:90,subtotal_cents:10000}])
      expect((await db.prepare(`SELECT service_id FROM appointment_services WHERE tenant_id=?1`).bind(tenant).all()).results).toEqual([{service_id:'tosa-maquina'}])
      expect(toolsUsed.filter(name=>name==='commit_confirmed_proposal')).toHaveLength(1)
      for(const table of ['sales','payments'])expect(await db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE tenant_id=?1`).bind(tenant).first()).toEqual({count:0})
      expect(transcripts).toHaveLength(scenario.messages.length)
    }finally{clock.mockRestore()}
  })
})
