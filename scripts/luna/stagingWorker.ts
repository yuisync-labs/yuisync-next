// Alternate entrypoint used ONLY by the staging certification configuration.
// Never imported by production, never sends WhatsApp, never binds fixture SQL
// to the application's DB. The business runtime itself remains native Luna.
import application from '../../apps/edge-api/src/index'
export * from '../../apps/edge-api/src/index'
import { runLunaTurn } from '../../apps/edge-api/src/luna/runLunaTurn'
import { GroqProvider } from '../../apps/edge-api/src/luna/providers/groqProvider'
import { recordProposalPresentation } from '../../apps/edge-api/src/luna/proposalPresentation'
import { LUNA_DESIGNED_SCENARIOS,LUNA_SCENARIO_FIXTURE as f } from '../../apps/edge-api/test/fixtures/luna/designedScenarios'
import { seedCertificationFixture } from './certificationFixtures'
import { certificationMeter } from './certificationMeter'
import { oneAgendaTimeout,blockCanonicalAfternoon,loseFirstCommittedBatch,changePriceAndLastStock,seedLastBenefit } from './certificationFaults'
import { operationalAssertions } from './certificationAssertions'
import { openCertificationLedger } from './certificationLedger'
import { CERTIFICATION_SCHEMA } from './certificationSchema'
import { LUNA_OPERATIONAL_SYSTEM_PROMPT } from '../../apps/edge-api/src/luna/systemPrompt'
import type { LunaExecutionContext } from '../../apps/edge-api/src/luna/contracts'
type Env=EdgeEnv & {LUNA_CERT_DB?:D1Database;LUNA_CERT_TOKEN?:string;RELEASE_SHA?:string;GROQ_API_KEY?:string;LUNA_CERT_ENV?:string;LUNA_CERT_DATABASE_ID?:string}
const json=(body:unknown,status=200)=>Response.json(body,{status,headers:{'cache-control':'no-store'}})
function sanitized(value:unknown):unknown{
 if(typeof value==='string'&&/^[\[{]/.test(value.trim())){try{return JSON.stringify(sanitized(JSON.parse(value)))}catch{/* ordinary text */}}
 if(typeof value==='string')return value.replace(/\b(?:gsk_|cfut_|sk_live_|sk_test_)[A-Za-z0-9_-]+/g,'[secret]').replace(/\b[\w.+-]+@[\w.-]+\.[a-z]{2,}\b/gi,'[email]').replace(/\b\d{10,15}\b/g,'[fixture-phone]')
 if(Array.isArray(value))return value.map(sanitized)
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([k])=>!['authorization','apiKey','reasoning','reasoning_content'].includes(k)).map(([k,v])=>[k,sanitized(v)]))
 return value
}
export async function initializeCertificationSchema(db:D1Database){return await db.batch(CERTIFICATION_SCHEMA.map(sql=>db.prepare(sql)))}
async function identity(env:Env){
 const payload={sha:env.RELEASE_SHA,provider:'groq',model:env.LUNA_MODEL,protocol:2,prompt:LUNA_OPERATIONAL_SYSTEM_PROMPT,scenarios:LUNA_DESIGNED_SCENARIOS,fixture:f,databaseId:env.LUNA_CERT_DATABASE_ID}
 const fingerprint=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(payload))))).map(b=>b.toString(16).padStart(2,'0')).join('')
 return{fingerprint,provider:'groq',model:env.LUNA_MODEL,scenarioVersion:2,promptVersion:env.RELEASE_SHA}
}
const tables=['chat_messages','luna_operation_events','luna_proposals','luna_proposal_presentations','luna_registration_receipts','luna_conversation_memory','luna_response_drafts','luna_turn_decisions','sales','sale_items','sale_delivery_addresses','payments','appointments','inventory_movements','pending_order_stock_reservations','subscription_benefit_allocations','appointment_transport_reservations','inventory_balances','clients','pets']
export async function certificationSnapshot(db:D1Database,tenant:string,conversation:string){
 const state=await db.prepare(`SELECT state_json,summary_text FROM luna_conversations WHERE tenant_id=?1 AND module_id='petshop' AND conversation_id=?2`).bind(tenant,conversation).first<{state_json:string;summary_text:string|null}>()
 const result:Record<string,unknown[]>={}
 // Schema names are fixed in source; not supplied by an HTTP request or model.
 for(const table of tables){
  // All names are required by the certified migration set. A missing table is
  // a failed baseline, not an excuse to omit evidence. No schema scans per turn.
  result[table]=(await db.prepare(`SELECT * FROM ${table} WHERE tenant_id=?1 LIMIT 201`).bind(tenant).all()).results
  if(result[table].length>200)throw new Error('CERTIFICATION_SNAPSHOT_TRUNCATED')
 }
 return{operational:JSON.parse(state?.state_json??'{}'),summary:state?.summary_text??null,tables:result}
}
function validate(id:number,turn:number,total:number,before:any,after:any,tools:any[],error:string|null){
 const violations:string[]=[],scenario=LUNA_DESIGNED_SCENARIOS.find(s=>s.id===id)!
 if(error)violations.push(error)
 for(const tool of tools)if(!scenario.allowedTools.includes(tool.name)||scenario.forbiddenTools.includes(tool.name))violations.push(`TOOL_NOT_ALLOWED:${tool.name}`)
 if(after.tables.payments?.length)violations.push('INVENTED_PAYMENT')
 if(after.tables.sales?.some((sale:any)=>sale.status!=='pending'))violations.push('UNEXPECTED_SALE_STATUS')
 const operations=Object.values(after.operational.operations??{}) as any[],cart=operations.find(o=>o.kind==='cart'),booking=operations.find(o=>o.kind==='booking'),registration=operations.find(o=>o.kind==='registration')
 const items=(expected:Record<string,number>)=>cart&&JSON.stringify(Object.fromEntries(cart.items.map((i:any)=>[i.id,i.quantity]).sort()))===JSON.stringify(Object.fromEntries(Object.entries(expected).sort()))
 const check=(ok:unknown,code:string)=>{if(!ok)violations.push(code)}
 const sales=after.tables.sales??[],appointments=(after.tables.appointments??[]).filter((appointment:any)=>appointment.id!=='occupied')
 if(id===1&&turn===1)check(sales.length===0,'PREMATURE_SALE')
 if(id===2&&turn===1)check(items({'racao-a':1,'racao-b':1,sache:2}),'MULTIITEM_LOST')
 if(id===3&&turn===1)check(items({'racao-b':1,sache:2}),'REPLACEMENT_LOST_ITEMS')
 if(id===4&&turn===1)check(items({'racao-a':2}),'REMOVAL_QUANTITY_WRONG')
 if(id===6&&turn===1)check(items({'racao-a':1})&&sales.length===0,'PARALLEL_QUESTION_LOST_CART')
 if(id===7&&turn===1)check(cart?.status==='paused','PAUSE_NOT_PERSISTED')
 if(id===7&&turn===4)check(cart?.status==='active'&&items({'racao-a':1}),'RESUME_LOST_CONTEXT')
 if(id===8&&turn===1)check(items({'racao-b':1}),'ORDINAL_SELECTION_WRONG')
 if(id===8&&turn===2)check(JSON.stringify(before.operational.operations)===JSON.stringify(after.operational.operations),'AMBIGUITY_CHANGED_DRAFT')
 if(id===10&&turn===1)check(registration?.fields.customer_name==='Mariana','NAME_CORRECTION_LOST')
 if(id===11&&turn===2)check(items({'racao-a':2})&&booking,'MULTIINTENT_OPERATION_LOST')
 if(id===11&&turn===4)check(appointments.length===1&&sales.length===0,'INDEPENDENT_CONFIRMATION_FAILED')
 if([12,20].includes(id))check(!sales.length&&!appointments.length,'UNAUTHORIZED_EFFECT')
 if(id===13&&turn===2)check(!sales.length,'CORRECTION_CONFIRMED_OLD_SUMMARY')
 if(turn===total-1){
  const totals:Record<number,number>={1:9000,2:21600,3:12600,4:18000,5:9000,6:9000,7:9000,8:12600,9:9000,11:18000,13:9000,14:9000}
  if(Object.hasOwn(totals,id))check(sales.length===1&&sales[0].total_cents===totals[id],'FINAL_ORDER_WRONG')
  if(id===10)check(registration?.fields.customer_name==='Mariana','REGISTRATION_WRONG')
  if(id===11)check(appointments.length===1,'BOOKING_NOT_COMPLETED')
  if(id===16)check(appointments.length===1&&appointments[0].status==='cancelled','CANCELLATION_FAILED')
  if(id===17)check(appointments.length===1&&appointments[0].pet_id==='luna','PET_CHANGE_LOST')
  if(id===18)check(appointments.length===1&&appointments[0].transport_fee_cents===0&&!(after.tables.appointment_transport_reservations??[]).length,'TRANSPORT_NOT_REMOVED')
  if(id===19)check(after.operational.handoff_reason,'HANDOFF_NOT_PERSISTED')
 }
 // Complex fault/race branches must never be silently treated as certified.
 return{passed:violations.length===0,violations}
}
async function certification(request:Request,env:Env){
 if(env.APP_ENV!=='staging'||env.LUNA_ENABLED!=='false'||env.LUNA_CERT_ENV!=='isolated-luna-v2'||!env.LUNA_CERT_DATABASE_ID||!env.LUNA_CERT_DB||env.LUNA_CERT_DB===env.DB||env.LUNA_CERT_DB===env.AUTH_DB||!env.LUNA_CERT_TOKEN)return json({code:'CERTIFICATION_DISABLED'},404)
 if(request.headers.get('authorization')!==`Bearer ${env.LUNA_CERT_TOKEN}`)return json({code:'UNAUTHORIZED'},401)
 const path=new URL(request.url).pathname,configuration=await identity(env)
 const body=await request.json() as any
 if(!/^[a-zA-Z0-9_-]{1,100}$/.test(body.roundId??''))return json({code:'INVALID_ROUND'},400)
 // Tables are provisioned once before the round. Never issue recurring DDL or
 // unmetered schema scans on cold starts. Missing tables fail closed.
 const ledger=await openCertificationLedger(env.LUNA_CERT_DB,body.roundId,configuration.fingerprint),db=ledger.db
 const identityRow=await db.prepare('SELECT database_id,environment FROM luna_cert_identity WHERE id=1').first<{database_id:string;environment:string}>()
 if(identityRow?.database_id!==env.LUNA_CERT_DATABASE_ID||identityRow.environment!==env.LUNA_CERT_ENV)return json({code:'CERTIFICATION_DATABASE_IDENTITY_MISMATCH'},409)
 const reply=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json','cache-control':'no-store','x-luna-cert-budget':JSON.stringify(ledger.usage())}})
 if(path.endsWith('/capabilities'))return reply({environment:'staging',isolated:true,fixtureOnly:true,whatsappEnabled:false,releaseSha:env.RELEASE_SHA,...configuration})
 if(path.endsWith('/budget'))return reply(ledger.usage())
 if(path.endsWith('/store/load')){const row=await db.prepare(`SELECT checkpoint_json FROM luna_cert_store WHERE round_id=?1`).bind(body.roundId).first<{checkpoint_json:string}>();return reply(row?JSON.parse(row.checkpoint_json):null)}
 if(path.endsWith('/store/save')){
  const state=body.state
  if(state?.roundId!==body.roundId||state.sha!==env.RELEASE_SHA||state.configurationFingerprint!==configuration.fingerprint||state.version!==body.expectedVersion+1)return reply({saved:false},409)
  const result=await db.prepare(`INSERT INTO luna_cert_store SELECT ?1,?2,?3 WHERE ?4=0 OR EXISTS(SELECT 1 FROM luna_cert_store WHERE round_id=?1 AND version=?4) ON CONFLICT(round_id) DO UPDATE SET version=excluded.version,checkpoint_json=excluded.checkpoint_json WHERE luna_cert_store.version=?4`).bind(body.roundId,state.version,JSON.stringify(sanitized(state)),body.expectedVersion).run()
  return reply({saved:result.meta.changes===1})
 }
 if(path.endsWith('/reconcile')){const row=await db.prepare(`SELECT evidence_json FROM luna_cert_turns WHERE idempotency_key=?1 AND round_id=?2 AND status='complete'`).bind(body.idempotencyKey,body.roundId).first<{evidence_json:string}>();return reply(row?JSON.parse(row.evidence_json):null)}
 if(!path.endsWith('/turn'))return json({code:'NOT_FOUND'},404)
 const scenario=LUNA_DESIGNED_SCENARIOS.find(s=>s.id===body.scenarioId),turn=body.turn
 if(!scenario||!Number.isInteger(turn)||scenario.messages[turn]!==body.message||body.sha!==env.RELEASE_SHA||!env.GROQ_API_KEY)return json({code:'INVALID_CERTIFICATION_REQUEST'},400)
 if(!['calls','tokens','rowsRead'].every(k=>Number.isSafeInteger(body.limits?.[k])&&body.limits[k]>0)||body.limits.calls>36||body.limits.tokens>250000||body.limits.rowsRead>100000)return json({code:'INVALID_BUDGET'},400)
 const key=`${body.roundId}:${body.sha}:${scenario.id}:${turn}`
 if(key!==body.idempotencyKey)return json({code:'INVALID_IDEMPOTENCY_KEY'},400)
 const existing=await db.prepare(`SELECT status,evidence_json FROM luna_cert_turns WHERE idempotency_key=?1`).bind(key).first<{status:string;evidence_json:string|null}>()
 if(existing)return existing.status==='complete'?reply(JSON.parse(existing.evidence_json!)):reply({code:'TURN_STATE_UNCERTAIN'},409)
 const locked=await db.prepare(`INSERT INTO luna_cert_turns VALUES(?1,?2,?3,?4,'running',NULL,?5)`).bind(key,body.roundId,scenario.id,turn,Date.now()).run()
 if(!locked.meta.changes)return json({code:'TURN_STATE_UNCERTAIN'},409)
 const meter=certificationMeter(db,body.limits),tenant=`luna-cert-${body.roundId}-${scenario.id}`,conversation=`scenario-${scenario.id}`
 const context:LunaExecutionContext={tenantId:tenant,moduleId:'petshop',conversationId:conversation,customerAddress:f.phone,phoneNumberId:'fixture-no-whatsapp',sourceMessageId:`source-${scenario.id}-${turn}`,traceId:`trace-${scenario.id}-${turn}`,executionMode:'staging'}
 const started=Date.now(),tools:any[]=[],responses:any[]=[],responseModes:string[]=[],errors:string[]=[],faults:any[]=[]
 let stateBefore:any={operational:{},tables:{}},stateAfter:any=stateBefore,result:any=null
 try{
  if(turn===0){ledger.category('setup');await seedCertificationFixture(meter.db,tenant,conversation,scenario.id);ledger.category('admin')}
  stateBefore=await certificationSnapshot(meter.db,tenant,conversation)
  await meter.db.prepare(`INSERT INTO chat_messages(tenant_id,module_id,id,thread_id,external_message_id,direction,actor_type,content_text,created_at_ms) VALUES(?1,'petshop',?2,?3,?4,'inbound','customer',?5,?6)`).bind(tenant,crypto.randomUUID(),conversation,context.sourceMessageId,body.message,Date.now()).run()
  const groq=new GroqProvider({apiKey:env.GROQ_API_KEY,model:env.LUNA_MODEL})
  const provider={model:groq.model,async complete(input:any){
   meter.beforeModel(input)
   const upper=new TextEncoder().encode(JSON.stringify(input)).length+4096+1200
   await ledger.reserveModel(upper)
   let response
   try{response=await groq.complete(input)}catch(error){meter.modelUncertain();throw error}
   // Known usage stays known even if it reveals a budget violation.
   meter.afterModel(response.usage)
   await ledger.settleModel(upper,response.usage)
   responses.push({usage:response.usage,toolCalls:response.toolCalls,content:response.content})
   return response
  }}
  const timeout=scenario.id===19&&turn===0?oneAgendaTimeout(meter.db):null
  const lostCommit=scenario.id===14&&turn===1?loseFirstCommittedBatch(meter.db,tenant):null
  const runtimeDb=lostCommit?.db??timeout?.db??meter.db
  const observer={tool:(event:any)=>tools.push({...event,conversationId:conversation}),response:(mode:string)=>responseModes.push(mode)}
  async function peer(thread:string,step:number,message:string){
   const peerContext={...context,conversationId:thread,sourceMessageId:`${thread}-${step}`,traceId:`peer-${thread}-${step}`}
   await meter.db.prepare(`INSERT INTO chat_threads(tenant_id,module_id,id,channel,external_thread_id,status,created_at_ms,updated_at_ms) VALUES(?1,'petshop',?2,'internal',?2,'open',?3,?3) ON CONFLICT DO NOTHING`).bind(tenant,thread,Date.now()).run()
   await meter.db.prepare(`INSERT INTO chat_messages(tenant_id,module_id,id,thread_id,external_message_id,direction,actor_type,content_text,created_at_ms) VALUES(?1,'petshop',?2,?3,?2,'inbound','customer',?4,?5)`).bind(tenant,peerContext.sourceMessageId,thread,message,Date.now()).run()
   const peerResult=await runLunaTurn({database:meter.db,provider,context:peerContext,observer:{tool:event=>tools.push({...event,conversationId:thread}),response:mode=>responseModes.push(mode)}})
   if(peerResult.reply){const outbound=crypto.randomUUID();await meter.db.prepare(`INSERT INTO chat_messages(tenant_id,module_id,id,thread_id,direction,actor_type,content_text,created_at_ms) VALUES(?1,'petshop',?2,?3,'outbound','assistant',?4,?5)`).bind(tenant,outbound,thread,peerResult.reply,Date.now()).run();await recordProposalPresentation(meter.db,peerContext,peerResult.proposalIds,outbound)}
   responses.push({peer:thread,step,message,result:peerResult})
   return peerResult
  }
  ledger.category('runtime')
  if(scenario.id===15&&turn===3){
   const [main,competing]=await Promise.all([runLunaTurn({database:runtimeDb,provider,context,observer}),peer('benefit-peer',2,'Confirmo o horário.')])
   result=main
   const winners=[main,competing].filter(r=>r.committedOperationIds.length).length
   const conflicts=tools.filter(t=>t.name==='commit_confirmed_proposal'&&!t.result.ok&&['PACKAGE_BENEFITS_CHANGED','PACKAGE_BENEFIT_CAPACITY_EXCEEDED'].includes(t.result.code)).length
   faults.push({kind:'benefit_race',winners,conflicts})
  }else result=await runLunaTurn({database:runtimeDb,provider,context,observer})
  if(lostCommit){
   // Reject the post-commit send: do not persist outbound/presentation evidence.
   // Redeliver the exact same inbound ID through the native runtime and Groq.
   const first=result,firstTools=tools.length
   result=await runLunaTurn({database:meter.db,provider,context,observer})
   const reconciled=tools.slice(firstTools).some(t=>t.name==='get_operation_status'&&t.result.ok&&t.result.data?.idempotent===true)
   faults.push({kind:'post_commit_redelivery',...lostCommit.evidence(),persistedOnce:lostCommit.evidence().commits===1,rejectedSend:true,reconciled,firstResult:first})
  }
  ledger.category('admin')
  if(timeout)faults.push(timeout.evidence())
  if(result.reply){const outbound=crypto.randomUUID();await meter.db.prepare(`INSERT INTO chat_messages(tenant_id,module_id,id,thread_id,direction,actor_type,content_text,created_at_ms) VALUES(?1,'petshop',?2,?3,'outbound','assistant',?4,?5)`).bind(tenant,outbound,conversation,result.reply,Date.now()).run();await recordProposalPresentation(meter.db,context,result.proposalIds,outbound)}
  if(scenario.id===16&&turn===0)faults.push(await blockCanonicalAfternoon(meter.db,tenant))
  if(scenario.id===15&&turn===0){ledger.category('setup');await changePriceAndLastStock(meter.db,tenant);ledger.category('admin');faults.push({kind:'price_and_stock_changed',injected:true})}
  if(scenario.id===15&&turn===1){
   ledger.category('runtime')
   const prepared=await Promise.all([peer('stock-peer-1',1,'Quero uma Ração A, uma unidade, para retirar na loja.'),peer('stock-peer-2',1,'Quero uma Ração A, uma unidade, para retirar na loja.')])
   if(prepared.some(r=>r.status!=='awaiting_confirmation'))throw new Error('CERTIFICATION_RACE_PREPARATION_FAILED')
   const competing=await Promise.all([peer('stock-peer-1',2,'Confirmo.'),peer('stock-peer-2',2,'Confirmo.')])
   const winners=competing.filter(r=>r.committedOperationIds.length).length
   const conflicts=tools.filter(t=>t.name==='commit_confirmed_proposal'&&!t.result.ok&&['INSUFFICIENT_STOCK','ORDER_STOCK_OR_PRICE_CHANGED'].includes(t.result.code)).length
   faults.push({kind:'stock_race',winners,conflicts})
   if(winners!==1||conflicts!==1)throw new Error('CERTIFICATION_STOCK_RACE_FAILED')
   ledger.category('setup');await seedLastBenefit(meter.db,tenant);ledger.category('admin')
  }
  if(scenario.id===15&&turn===2){
   if(result.status!=='awaiting_confirmation')throw new Error('CERTIFICATION_MAIN_BENEFIT_PREPARATION_FAILED')
   ledger.category('runtime');const prepared=await peer('benefit-peer',1,'Quero usar o último banho do pacote para a Mel amanhã às 09h.');if(prepared.status!=='awaiting_confirmation')throw new Error('CERTIFICATION_BENEFIT_RACE_PREPARATION_FAILED');ledger.category('admin')
  }
  stateAfter=await certificationSnapshot(meter.db,tenant,conversation)
 }catch(error){errors.push(error instanceof Error?error.message:'CERTIFICATION_EXECUTION_FAILED')}
 const validation=validate(scenario.id,turn,scenario.messages.length,stateBefore,stateAfter,tools,result?.errorCode??errors[0]??null)
 validation.violations.push(...await operationalAssertions({id:scenario.id,turn,total:scenario.messages.length,tenant,before:stateBefore,after:stateAfter,tools,faults}))
 if(scenario.id===19&&turn===0&&!faults.some(f=>f.injected&&f.attempts===2))validation.violations.push('AGENDA_RECOVERY_NOT_EXERCISED')
 if(scenario.id===16&&turn===1&&(stateAfter.tables.luna_proposals??[]).some((p:any)=>p.status==='awaiting_confirmation'&&JSON.parse(p.payload_json).scheduled_at_ms===Date.parse('2026-10-07T17:00:00Z')))validation.violations.push('OCCUPIED_SLOT_PROPOSED')
 if(meter.unknown())validation.violations.push('CERTIFICATION_ACCOUNTING_UNCERTAIN')
 validation.passed=validation.violations.length===0
 const evidence=sanitized({scenario_id:scenario.id,turn_id:turn,source_message_id:context.sourceMessageId,conversation_id:conversation,operationIds:result?.committedOperationIds??[],timestamp:new Date(started).toISOString(),model:env.LUNA_MODEL,
  configuration,metrics:meter.unknown()?null:meter.metrics,readBreakdown:ledger.local,durationMs:Date.now()-started,messages:[{role:'user',content:body.message},{role:'assistant',content:result?.reply}],toolCalls:tools.map(t=>({id:t.id,name:t.name,args:t.args})),toolResults:tools.map(t=>({id:t.id,result:t.result,recovery:t.recovery})),
  stateBefore,stateAfter,events:stateAfter.tables.luna_operation_events??[],proposals:stateAfter.tables.luna_proposals??[],presentations:stateAfter.tables.luna_proposal_presentations??[],
  // Native authorization evidence is the presented fingerprint, inbound
  // message and commit tool result. There are no generic confirmation tables.
  confirmations:tools.filter(t=>t.name==='commit_confirmed_proposal').map(t=>({sourceMessageId:context.sourceMessageId,args:t.args,result:t.result})),
  commits:(stateAfter.tables.luna_proposals??[]).filter((p:any)=>p.status==='completed').map((p:any)=>({proposalId:p.id,operationId:p.committed_operation_id,fingerprint:p.fingerprint,version:p.version})),
  fallbacks:responseModes.filter(m=>m==='factual_fallback'),responseModes,reformulations:responseModes.filter(m=>m==='rewritten').length,errors,faults,result,responses,checkpoint:{tenant,conversation,nextTurn:turn+1},validation})
 await db.prepare(`UPDATE luna_cert_turns SET status='complete',evidence_json=?2 WHERE idempotency_key=?1 AND status='running'`).bind(key,JSON.stringify(evidence)).run()
 return reply(evidence)
}
export default{...application,async fetch(request:Request,env:Env,ctx:ExecutionContext){
 if(new URL(request.url).pathname.startsWith('/internal/luna-certification/')){try{return await certification(request,env)}catch{return json({code:'CERTIFICATION_INTERNAL_FAILURE'},503)}}
 return application.fetch(request,env,ctx)
}}
