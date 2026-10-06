import { env } from 'cloudflare:workers'
import { expect,vi } from 'vitest'
import { runLunaTurn } from '../../../src/luna/runLunaTurn'
import { recordProposalPresentation } from '../../../src/luna/proposalPresentation'
import { loadOperationalState } from '../../../src/luna/operationalState'
import type { LunaMessage,LunaProviderResponse,LunaTurnResult } from '../../../src/luna/contracts'
import { LUNA_SCENARIO_CLOCK,LUNA_SCENARIO_FIXTURE } from './designedScenarios'
export const scenarioDB=(env as EdgeEnv & {DB:D1Database}).DB
export type Command={name:string;args:Record<string,unknown>}
export async function createDesignedHarness(id:number,suffix=''){
 const db=scenarioDB,f=LUNA_SCENARIO_FIXTURE,start=Date.parse(LUNA_SCENARIO_CLOCK.now),tenant=`designed-full-${id}${suffix}`
 const clock=vi.spyOn(Date,'now').mockReturnValue(start)
 const ctx={tenantId:tenant,moduleId:'petshop' as const,conversationId:`scenario-${id}${suffix}`,customerAddress:f.phone,phoneNumberId:'fixture-no-whatsapp',sourceMessageId:'',traceId:'',executionMode:'fixture' as const}
 const hours=Object.fromEntries(Array.from({length:7},(_,i)=>[String(i+1),i<5?[{open:'08:00',close:'18:00'}]:[]]))
 await db.batch([
  db.prepare(`INSERT INTO tenants(id,slug,name,status,created_at_ms,updated_at_ms) VALUES(?1,?1,'Fixture','active',?2,?2)`).bind(tenant,start),
  db.prepare(`INSERT INTO clients(tenant_id,module_id,id,name,phone,city,neighborhood,status,created_at_ms,updated_at_ms) VALUES(?1,'petshop',?2,'Maria',?3,'Cidade Teste','Centro','active',?4,?4)`).bind(tenant,f.customer,f.phone,start),
  ...['mel','luna','thor'].map(pet=>db.prepare(`INSERT INTO pets(tenant_id,module_id,id,client_id,name,species,weight_kg,status,created_at_ms,updated_at_ms) VALUES(?1,'petshop',?2,?3,?2,'dog',8,'active',?4,?4)`).bind(tenant,pet,f.customer,start)),
  db.prepare(`INSERT INTO chat_threads(tenant_id,module_id,id,channel,external_thread_id,status,last_message_at_ms,created_at_ms,updated_at_ms) VALUES(?1,'petshop',?2,'whatsapp',?3,'open',?4,?4,?4)`).bind(tenant,ctx.conversationId,f.phone,start),
  ...f.products.flatMap(p=>[
   db.prepare(`INSERT INTO catalog_products(tenant_id,module_id,id,name,price_cents,status,created_at_ms,updated_at_ms) VALUES(?1,'petshop',?2,?3,?4,'active',?5,?5)`).bind(tenant,p.id,p.name,p.priceCents,start),
   db.prepare(`INSERT INTO inventory_balances(tenant_id,module_id,product_id,on_hand_milliunits,reserved_milliunits,reorder_milliunits,version,updated_at_ms) VALUES(?1,'petshop',?2,?3,0,0,1,?4)`).bind(tenant,p.id,p.units*1000,start),
  ]),
  ...f.services.map(s=>db.prepare(`INSERT INTO services(tenant_id,module_id,id,code,name,group_type,default_price_cents,default_duration_min,status,created_at_ms,updated_at_ms) VALUES(?1,'petshop',?2,?2,?2,'banho_tosa',?3,?4,'active',?5,?5)`).bind(tenant,s.id,s.priceCents,s.durationMin,start)),
  db.prepare(`INSERT INTO tenant_module_settings(tenant_id,module_id,store_name,store_city,created_at_ms,updated_at_ms) VALUES(?1,'petshop','Fixture','Cidade Teste',?2,?2)`).bind(tenant,start),
  db.prepare(`INSERT INTO module_settings_extensions(tenant_id,module_id,data_json,updated_at_ms) VALUES(?1,'petshop',?2,?3)`).bind(tenant,JSON.stringify({petbot_timezone:'America/Sao_Paulo',petbot_booking_capacity:3,petbot_business_hours:hours}),start),
 ])
 const versions:Record<string,number>={},proposals:Record<string,{proposal_id:string;proposal_version:number}>={}
 const tools:string[]=[],transcripts:{message:string;result:LunaTurnResult}[]=[]
 const command=(name:string,args:Record<string,unknown>):Command=>({name,args})
 const draft=(operationId:string,kind:string,action:string,fields:Record<string,unknown>):Command=>{
  const expectedVersion=versions[operationId]??0
  versions[operationId]=expectedVersion+1
  return command('update_operation_draft',{operationId,kind,action,expectedVersion,...fields})
 }
 const booking=(at:string,transport?:Record<string,unknown>,petId='mel'):Command=>command('prepare_appointment',{customer_id:f.customer,pet_id:petId,service_ids:['banho'],scheduled_at:at,notes:null,operation_id:'booking',...(transport?{transport}:{})})
 async function turn(number:number,message:string,groups:(Command[]|((results:Record<string,any>[])=>Command[]))[],allowed:readonly string[],expectedFailures:string[]=[],facts:string[]=[],question='none'){
  clock.mockReturnValue(start+number*10000)
  const context={...ctx,sourceMessageId:`in-${number}`,traceId:`trace-${number}`}
  await db.prepare(`INSERT INTO chat_messages(tenant_id,module_id,id,thread_id,external_message_id,direction,actor_type,content_text,created_at_ms) VALUES(?1,'petshop',?2,?3,?2,'inbound','customer',?4,?5)`).bind(tenant,context.sourceMessageId,ctx.conversationId,message,Date.now()).run()
  let step=0
  const provider={model:'offline-scripted-provider',async complete(input:{messages:readonly LunaMessage[]}):Promise<LunaProviderResponse & {requestLimit:number}>{
   const results=input.messages.filter(m=>m.role==='tool').map(m=>JSON.parse(m.content!))
   for(const r of results)if(!r.ok)expect(expectedFailures).toContain(r.code)
   for(const r of results)if(r.ok&&r.data?.proposal_id&&r.data?.proposal_version){
    const summary=r.data.summary??r.data
    const kind=summary.operation_kind??(summary.items?'product_order_create':summary.services?'appointment_create':null)
    if(kind)proposals[kind]={proposal_id:r.data.proposal_id,proposal_version:r.data.proposal_version}
   }
   const group=groups[step],commands=typeof group==='function'?group(results):group??[]
   step++
   const toolCalls=commands.map((c,i)=>{expect(allowed).toContain(c.name);tools.push(c.name);return{id:`call-${number}-${step}-${i}`,type:'function' as const,function:{name:c.name,arguments:JSON.stringify(c.args)}}})
   const blocks=[{kind:'social',text:number%2?'Claro, vamos por partes.':'Entendi, podemos continuar.'},...facts.map(id=>({kind:'fact',id})),...(question==='none'?[]:[{kind:'question',field:question}])]
   return{content:toolCalls.length?null:JSON.stringify({blocks}),toolCalls,usage:{promptTokens:10,completionTokens:10},rateLimit:{remainingRequests:900,remainingTokens:7000,resetRequests:null,resetTokens:null},requestLimit:1000}
  }}
  const result=await runLunaTurn({database:db,provider,context})
  expect(result.errorCode,JSON.stringify({number,result})).toBeNull()
  clock.mockReturnValue(Date.now()+1)
  const outbound=`out-${number}`
  await db.prepare(`INSERT INTO chat_messages(tenant_id,module_id,id,thread_id,direction,actor_type,content_text,created_at_ms) VALUES(?1,'petshop',?2,?3,'outbound','assistant',?4,?5)`).bind(tenant,outbound,ctx.conversationId,result.reply,Date.now()).run()
  await recordProposalPresentation(db,context,result.proposalIds,outbound)
  // Read the authoritative payload, not a presumed order of tool results.
  for(const proposalId of result.proposalIds){const p=await db.prepare(`SELECT operation_kind,version FROM luna_proposals WHERE tenant_id=?1 AND id=?2`).bind(tenant,proposalId).first<{operation_kind:string;version:number}>();proposals[p!.operation_kind]={proposal_id:proposalId,proposal_version:p!.version}}
  transcripts.push({message,result});return result
 }
 async function state(){const row=await db.prepare(`SELECT state_json FROM luna_conversations WHERE tenant_id=?1 AND conversation_id=?2`).bind(tenant,ctx.conversationId).first<{state_json:string}>();return loadOperationalState(row!.state_json)}
 return{db,tenant,ctx,start,clock,command,draft,booking,turn,state,proposals,tools,transcripts,close:()=>clock.mockRestore()}
}
