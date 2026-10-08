// Alternate entrypoint used ONLY by the staging certification configuration.
// Never imported by production, never sends WhatsApp, never binds fixture SQL
// to the application's DB. The business runtime itself remains native Luna.
import application from '../../apps/edge-api/src/index'
export * from '../../apps/edge-api/src/index'
import { runLunaTurn } from '../../apps/edge-api/src/luna/runLunaTurn'
import { LunaProviderError } from '../../apps/edge-api/src/luna/providers/providerError'
import { createLunaProvider, lunaProviderIdentity, lunaProviderConfigured } from '../../apps/edge-api/src/luna/providers/providerFactory'
import { glmNeurons } from '../../apps/edge-api/src/luna/providers/workersAiProvider'
import { recordProposalPresentation } from '../../apps/edge-api/src/luna/proposalPresentation'
import { LUNA_DESIGNED_SCENARIOS,LUNA_SCENARIO_FIXTURE as f,LUNA_SCENARIO_CLOCK } from '../../apps/edge-api/test/fixtures/luna/designedScenarios'
import { seedCertificationFixture } from './certificationFixtures'
import { certificationMeter } from './certificationMeter'
import { oneAgendaTimeout,blockCanonicalAfternoon,loseFirstCommittedBatch,changePriceAndLastStock,seedLastBenefit } from './certificationFaults'
import { operationalAssertions } from './certificationAssertions'
import { openCertificationLedger } from './certificationLedger'
import { CERTIFICATION_SCHEMA } from './certificationSchema'
import { LUNA_OPERATIONAL_SYSTEM_PROMPT } from '../../apps/edge-api/src/luna/systemPrompt'
import type { LunaExecutionContext } from '../../apps/edge-api/src/luna/contracts'
import { getBetterAuthSession } from '../../apps/edge-api/src/auth/betterAuthRuntime'
import { certificationPlayground } from './certificationPlayground'
import { lunaNow } from '../../apps/edge-api/src/luna/clock'
import { FINISH_TURN } from '../../apps/edge-api/src/luna/finishTurn'
import { browserCheckpoint } from './browserCheckpoint'
import { certificationBlock } from './certificationBlocks'
import { LunaConversationDurableObject as NativeConversation } from '../../apps/edge-api/src/luna/conversationDurableObject'
import { createD1TurnJournal,LunaCheckpointError,LunaTurnSuspended,type LunaTurnJournal } from '../../apps/edge-api/src/luna/turnJournal'
import type { DurableTurnJob } from '../../apps/edge-api/src/luna/durableTurnQueue'
import { hashCanonicalJson } from '../../apps/edge-api/src/luna/canonicalJson'
type Env=EdgeEnv & {LUNA_CERT_DB?:D1Database;LUNA_CERT_TOKEN?:string;RELEASE_SHA?:string;GROQ_API_KEY?:string;LUNA_CERT_ENV?:string;LUNA_CERT_DATABASE_ID?:string;LUNA_CERT_OPERATOR_ID?:string;LUNA_CERT_GATES_SHA?:string;LUNA_CERT_SAMPLE_ONLY?:string}
const json=(body:unknown,status=200)=>Response.json(body,{status,headers:{'cache-control':'no-store'}})
export function certificationTurnTokens(value?:string){
 const tokens=value===undefined?12000:Number(value)
 if(!Number.isSafeInteger(tokens)||tokens<1000||tokens>32000)throw new Error('CERTIFICATION_TURN_TOKEN_LIMIT_INVALID')
 return tokens
}
function sanitized(value:unknown):unknown{
 if(typeof value==='string'&&/^[\[{]/.test(value.trim())){try{return JSON.stringify(sanitized(JSON.parse(value)))}catch{/* ordinary text */}}
 if(typeof value==='string')return value.replace(/\b(?:gsk_|cfut_|sk_live_|sk_test_)[A-Za-z0-9_-]+/g,'[secret]').replace(/\b[\w.+-]+@[\w.-]+\.[a-z]{2,}\b/gi,'[email]').replace(/\b\d{10,15}\b/g,'[fixture-phone]')
 if(Array.isArray(value))return value.map(sanitized)
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([k])=>!['authorization','apiKey','reasoning','reasoning_content'].includes(k)).map(([k,v])=>[k,sanitized(v)]))
 return value
}
export async function initializeCertificationSchema(db:D1Database){return await db.batch(CERTIFICATION_SCHEMA.map(sql=>db.prepare(sql)))}
async function identity(env:Env){
 const selection=lunaProviderIdentity(env)
 const payload={sha:env.RELEASE_SHA,provider:selection.provider,model:env.LUNA_MODEL,protocol:2,prompt:LUNA_OPERATIONAL_SYSTEM_PROMPT,scenarios:LUNA_DESIGNED_SCENARIOS,fixture:f,clock:LUNA_SCENARIO_CLOCK,databaseId:env.LUNA_CERT_DATABASE_ID,turnTokenLimit:certificationTurnTokens(env.LUNA_MAX_TOKENS_PER_TURN),...(selection.provider==='workers-ai'?{thinking:false,transportVersion:1}:{})}
 const fingerprint=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(payload))))).map(b=>b.toString(16).padStart(2,'0')).join('')
 return{fingerprint,...selection,scenarioVersion:2,promptVersion:env.RELEASE_SHA}
}
const tables=['chat_messages','luna_operation_events','luna_proposals','luna_proposal_presentations','luna_registration_receipts','luna_conversation_memory','luna_response_drafts','luna_turn_decisions','sales','sale_items','sale_delivery_addresses','payments','appointments','inventory_movements','pending_order_stock_reservations','subscription_benefit_allocations','appointment_transport_reservations','inventory_balances','clients','pets']
export async function certificationSnapshot(db:D1Database,tenant:string,conversation:string){
 // Fixed bounded queries, one D1 batch rather than 21 sequential round trips.
 const [stateResult,...tableResults]=await db.batch([
  db.prepare(`SELECT state_json,summary_text FROM luna_conversations WHERE tenant_id=?1 AND module_id='petshop' AND conversation_id=?2`).bind(tenant,conversation),
  ...tables.map(table=>db.prepare(`SELECT * FROM ${table} WHERE tenant_id=?1 LIMIT 201`).bind(tenant)),
 ])
 const state=stateResult.results[0] as {state_json:string;summary_text:string|null}|undefined
 const result:Record<string,unknown[]>={}
 // Schema names are fixed in source; not supplied by an HTTP request or model.
 for(const [index,table] of tables.entries()){
  // All names are required by the certified migration set. A missing table is
  // a failed baseline, not an excuse to omit evidence. No schema scans per turn.
  result[table]=tableResults[index].results
  if(result[table].length>200)throw new Error('CERTIFICATION_SNAPSHOT_TRUNCATED')
 }
 return{operational:JSON.parse(state?.state_json??'{}'),summary:state?.summary_text??null,tables:result}
}
function validate(id:number,turn:number,total:number,before:any,after:any,tools:any[],error:string|null){
 const violations:string[]=[],scenario=LUNA_DESIGNED_SCENARIOS.find(s=>s.id===id)!
 if(error)violations.push(error)
 // Runtime-only, read-only termination is valid in every scenario. Domain
 // permissions and each scenario's forbidden commercial actions stay intact.
 for(const tool of tools)if((tool.name!==FINISH_TURN.name&&!scenario.allowedTools.includes(tool.name))||scenario.forbiddenTools.includes(tool.name))violations.push(`TOOL_NOT_ALLOWED:${tool.name}`)
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
type Execution={jobId:string;previous?:any;saveProgress:(value:unknown)=>Promise<void>}
const certificationObject=(env:Env,roundId:string)=>{if(!env.LUNA_AGENT)throw new LunaCheckpointError('LUNA_AGENT_NOT_CONFIGURED');return env.LUNA_AGENT.get(env.LUNA_AGENT.idFromName(`certification:${env.RELEASE_SHA}:${roundId}`))}
async function certification(request:Request,env:Env,execution?:Execution){
 if(env.APP_ENV!=='staging'||env.LUNA_ENABLED!=='false'||env.LUNA_CERT_ENV!=='isolated-luna-v2'||!env.LUNA_CERT_DATABASE_ID||!env.LUNA_CERT_DB||env.LUNA_CERT_DB===env.DB||env.LUNA_CERT_DB===env.AUTH_DB||!env.LUNA_CERT_TOKEN)return json({code:'CERTIFICATION_DISABLED'},404)
 const browserRequest=new URL(request.url).pathname.startsWith('/api/ai-lab/luna/certification/')
 if(browserRequest){
  if(env.LUNA_CERT_GATES_SHA!==env.RELEASE_SHA||!env.LUNA_CERT_OPERATOR_ID)return json({code:'CERTIFICATION_FINAL_GATES_REQUIRED'},409)
  if(request.method!=='POST'||request.headers.get('origin')!==new URL(request.url).origin||!request.headers.get('cookie'))return json({code:'UNAUTHENTICATED'},401)
 }else if(request.headers.get('authorization')!==`Bearer ${env.LUNA_CERT_TOKEN}`)return json({code:'UNAUTHORIZED'},401)
 const path=new URL(request.url).pathname,configuration=await identity(env)
 const body=await request.json() as any
 if(!/^[a-zA-Z0-9_-]{1,100}$/.test(body.roundId??''))return json({code:'INVALID_ROUND'},400)
 const block=certificationBlock(env.RELEASE_SHA??'',body.roundId,configuration.provider)
 const sample=block&&'sample' in block&&block.sample
 if(env.LUNA_CERT_SAMPLE_ONLY==='true'&&!sample)return json({code:'CERTIFICATION_SAMPLE_ONLY'},409)
 if(browserRequest&&!block&&body.roundId!==`${configuration.provider}-ui-${env.RELEASE_SHA?.slice(0,12)}`)return json({code:'INVALID_ROUND'},400)
 // Tables are provisioned once before the round. Never issue recurring DDL or
 // unmetered schema scans on cold starts. Missing tables fail closed.
 const ledger=await openCertificationLedger(env.LUNA_CERT_DB,body.roundId,configuration.fingerprint),db=ledger.db
 if(browserRequest){
  if(!env.AUTH_DB||!env.DB)return json({code:'UNAUTHENTICATED'},401)
  const session=await getBetterAuthSession(request,{...env,AUTH_DB:ledger.instrument(env.AUTH_DB)})
  if(!session||session.user.id!==env.LUNA_CERT_OPERATOR_ID)return json({code:'FORBIDDEN'},403)
  const operator=await ledger.instrument(env.DB).prepare(`SELECT p.id FROM identity_principals p JOIN platform_administrators a ON a.principal_id=p.id WHERE p.provider='better-auth' AND p.subject=?1 AND p.status='active' AND a.status='active' LIMIT 1`).bind(session.user.id).first()
  if(!operator)return json({code:'FORBIDDEN'},403)
 }
 const identityRow=await db.prepare('SELECT database_id,environment FROM luna_cert_identity WHERE id=1').first<{database_id:string;environment:string}>()
 if(identityRow?.database_id!==env.LUNA_CERT_DATABASE_ID||identityRow.environment!==env.LUNA_CERT_ENV)return json({code:'CERTIFICATION_DATABASE_IDENTITY_MISMATCH'},409)
 const reply=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json','cache-control':'no-store','x-luna-cert-budget':JSON.stringify(ledger.usage())}})
 if(path.endsWith('/capabilities'))return reply({environment:'staging',isolated:true,fixtureOnly:true,whatsappEnabled:false,releaseSha:env.RELEASE_SHA,...configuration})
 if(path.endsWith('/budget'))return reply(ledger.usage())
 if(path.endsWith('/browser-state')){
  const scenarios=sample?LUNA_DESIGNED_SCENARIOS.filter(s=>block.scenarioIds.includes(s.id)):block?LUNA_DESIGNED_SCENARIOS.filter(s=>s.id>=block.first&&s.id<=block.last):LUNA_DESIGNED_SCENARIOS
  const keys=scenarios.flatMap(s=>s.messages.map((_,turn)=>`${body.roundId}:${env.RELEASE_SHA}:${s.id}:${turn}`))
  const rows=await db.prepare(`SELECT scenario_id,turn_id,status,evidence_json,created_at_ms FROM luna_cert_turns WHERE round_id=?1 AND idempotency_key IN (${keys.map((_,i)=>'?'+(i+2)).join(',')}) ORDER BY scenario_id,turn_id LIMIT 201`).bind(body.roundId,...keys).all<any>()
  const state=browserCheckpoint(scenarios,rows.results),active=state.blocked??state.next
  let job:unknown=null
  if(block&&active){const jobId=await hashCanonicalJson({key:`${body.roundId}:${env.RELEASE_SHA}:${active.scenarioId}:${active.turn}`,configuration:configuration.fingerprint});const status=await certificationObject(env,body.roundId).fetch(`https://luna.internal/turns/${jobId}`);if(status.ok)job=await status.json()}
  let progress:unknown=null
  if(job&&active){const tenant=`luna-cert-${body.roundId}-${active.scenarioId}`;progress=await db.prepare(`SELECT step_key,status,updated_at_ms,error_code FROM luna_turn_steps WHERE tenant_id=?1 AND module_id='petshop' AND conversation_id=?2 AND source_message_id=?3 AND status='complete' ORDER BY updated_at_ms DESC LIMIT 1`).bind(tenant,`scenario-${active.scenarioId}`,`source-${active.scenarioId}-${active.turn}`).first()}
  const blockRounds=[...Array.from({length:5},(_,index)=>`${configuration.provider}-ui-${env.RELEASE_SHA?.slice(0,12)}-b${index+1}`),`${configuration.provider}-ui-${env.RELEASE_SHA?.slice(0,12)}-sample`]
  const aggregate=await db.prepare(`SELECT SUM(calls) AS calls,SUM(input_tokens+output_tokens) AS tokens,SUM(runtime_reads+admin_reads+setup_reads) AS rowsRead,SUM(reserved_calls) AS reservedCalls,SUM(reserved_tokens) AS reservedTokens,SUM(reserved_reads) AS reservedReads FROM luna_cert_budget WHERE round_id IN (?1,?2,?3,?4,?5,?6)`).bind(...blockRounds).first()
  return reply({...state,job,progress,block,aggregate,budget:ledger.usage()})
 }
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
 if(!scenario||!Number.isInteger(turn)||scenario.messages[turn]!==body.message||body.sha!==env.RELEASE_SHA||!lunaProviderConfigured(env))return json({code:'INVALID_CERTIFICATION_REQUEST'},400)
 if(block&&(scenario.id<block.first||scenario.id>block.last))return json({code:'SCENARIO_OUTSIDE_BLOCK'},400)
 if(sample&&!block.scenarioIds.includes(scenario.id))return json({code:'SCENARIO_OUTSIDE_SAMPLE'},400)
 if(browserRequest&&!block)return json({code:'LEGACY_ROUND_PRESERVED_READ_ONLY'},409)
 if(!['calls','tokens','rowsRead'].every(k=>Number.isSafeInteger(body.limits?.[k])&&body.limits[k]>0)||body.limits.calls>36||body.limits.tokens>250000||body.limits.rowsRead>100000)return json({code:'INVALID_BUDGET'},400)
 const key=`${body.roundId}:${body.sha}:${scenario.id}:${turn}`
 if(key!==body.idempotencyKey)return json({code:'INVALID_IDEMPOTENCY_KEY'},400)
 if(browserRequest){
  const priorId=sample?block.scenarioIds[block.scenarioIds.indexOf(scenario.id)-1]:scenario.id-1
  const preceding=turn>0?{id:scenario.id,turn:turn-1}:priorId>0?{id:priorId,turn:LUNA_DESIGNED_SCENARIOS.find(s=>s.id===priorId)!.messages.length-1}:null
  if(preceding){const precedingRound=preceding.id<block!.first?`${configuration.provider}-ui-${env.RELEASE_SHA?.slice(0,12)}-b${block!.block-1}`:body.roundId;const precedingKey=`${precedingRound}:${env.RELEASE_SHA}:${preceding.id}:${preceding.turn}`;const row=await db.prepare(`SELECT evidence_json FROM luna_cert_turns WHERE idempotency_key=?1 AND round_id=?2 AND status='complete'`).bind(precedingKey,precedingRound).first<{evidence_json:string}>();const evidence=row?JSON.parse(row.evidence_json):null;if(!evidence?.validation.passed||!evidence?.metrics)return json({code:'PREVIOUS_CHECKPOINT_NOT_APPROVED'},409)}
  const jobId=await hashCanonicalJson({key,configuration:configuration.fingerprint})
  return certificationObject(env,body.roundId).fetch('https://luna.internal/certification/submit',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jobId,body,configuration:configuration.fingerprint})})
 }
 const existing=await db.prepare(`SELECT status,evidence_json FROM luna_cert_turns WHERE idempotency_key=?1`).bind(key).first<{status:string;evidence_json:string|null}>()
 if(existing?.status==='complete')return reply(JSON.parse(existing.evidence_json!))
 if(existing&&!execution)return reply({code:'TURN_STATE_UNCERTAIN'},409)
 const meter=certificationMeter(db,body.limits,execution?.previous?.metrics),tenant=`luna-cert-${body.roundId}-${scenario.id}`,conversation=`scenario-${scenario.id}`
 const context:LunaExecutionContext={tenantId:tenant,moduleId:'petshop',conversationId:conversation,customerAddress:f.phone,phoneNumberId:'fixture-no-whatsapp',sourceMessageId:`source-${scenario.id}-${turn}`,traceId:`trace-${scenario.id}-${turn}`,executionMode:'staging',nowMs:Date.parse(LUNA_SCENARIO_CLOCK.now)+(turn+1)*1000}
 const journalFor=(ctx:LunaExecutionContext)=>execution?createD1TurnJournal(meter.db,ctx,`${configuration.fingerprint}:durable-v1`):undefined
 const journal=journalFor(context)
 const maxTokens=certificationTurnTokens(env.LUNA_MAX_TOKENS_PER_TURN)
 const checkpoint=<T>(name:string,input:unknown,run:()=>Promise<T>,j:LunaTurnJournal|undefined=journal)=>j?j.run(name,input,run):run()
 const baseline=await checkpoint('cert-budget-baseline',{},async()=>ledger.usage())
 await checkpoint('cert-lock',{key,jobId:execution?.jobId??null},async()=>{if(existing)throw new LunaCheckpointError('TURN_STATE_UNCERTAIN');const locked=await db.prepare(`INSERT INTO luna_cert_turns VALUES(?1,?2,?3,?4,'running',NULL,?5)`).bind(key,body.roundId,scenario.id,turn,Date.now()).run();if(!locked.meta.changes)throw new LunaCheckpointError('TURN_STATE_UNCERTAIN');return true})
 const started=execution?.previous?.started??Date.now(),tools:any[]=[],responses:any[]=[...(execution?.previous?.responses??[])],responseModes:string[]=[],errors:string[]=[],faults:any[]=[...(execution?.previous?.faults??[])]
 let stateBefore:any={operational:{},tables:{}},stateAfter:any=stateBefore,result:any=null
 try{
  if(turn===0){ledger.category('setup');await checkpoint('cert-fixture',{tenant,scenario:scenario.id},async()=>{await seedCertificationFixture(meter.db,tenant,conversation,scenario.id);return true});ledger.category('admin')}
  stateBefore=await checkpoint('cert-before',{},()=>certificationSnapshot(meter.db,tenant,conversation))
  await checkpoint('cert-inbound',{message:body.message},async()=>{await meter.db.prepare(`INSERT INTO chat_messages(tenant_id,module_id,id,thread_id,external_message_id,direction,actor_type,content_text,created_at_ms) VALUES(?1,'petshop',?2,?3,?4,'inbound','customer',?5,?6)`).bind(tenant,crypto.randomUUID(),conversation,context.sourceMessageId,body.message,lunaNow(context)).run();return true})
  const transport=createLunaProvider(env)
  const provider={model:transport.model,operationalReplies:transport.operationalReplies,async complete(input:any){
   const upper=transport.reservationTokens(input)
   const current=ledger.usage()
   if(configuration.provider==='workers-ai'){
    // Conservative per-SHA test budget, not the account's remaining daily
    // allowance. Include unknown reserved tokens at the higher output rate.
    const rounds=[...Array.from({length:5},(_,i)=>`workers-ai-ui-${env.RELEASE_SHA?.slice(0,12)}-b${i+1}`),`workers-ai-ui-${env.RELEASE_SHA?.slice(0,12)}-sample`]
    const spent=await db.prepare(`SELECT COALESCE(SUM(input_tokens),0) AS p,COALESCE(SUM(output_tokens),0) AS c,COALESCE(SUM(reserved_tokens),0) AS reserved FROM luna_cert_budget WHERE round_id IN (?1,?2,?3,?4,?5,?6)`).bind(...rounds).first<{p:number;c:number;reserved:number}>()
    if(!spent||glmNeurons({promptTokens:spent.p,completionTokens:spent.c+spent.reserved+upper})>8000)throw new Error('CERTIFICATION_NEURON_RESERVATION_EXHAUSTED')
   }
   if(current.calls+current.reserved_calls-baseline.calls+1>body.limits.calls||current.input_tokens+current.output_tokens+current.reserved_tokens-baseline.input_tokens-baseline.output_tokens+upper>body.limits.tokens)throw new Error('CERTIFICATION_MODEL_RESERVATION_EXHAUSTED')
   meter.beforeModel(input,upper)
   await ledger.reserveModel(upper)
   let response
   const modelStarted=Date.now()
   try{response=await transport.complete(input)}catch(error){
    if(error instanceof LunaProviderError && error.usage){meter.afterModel(error.usage);await ledger.settleModel(upper,error.usage)}else meter.modelUncertain()
    responses.push({providerError:error instanceof LunaProviderError?error.code:'LUNA_PROVIDER_REQUEST_FAILED',...(error instanceof LunaProviderError?{usage:error.usage}:{})});throw error
   }
   // Known usage stays known even if it reveals a budget violation.
   const modelDurationMs=Date.now()-modelStarted
   meter.afterModel(response.usage)
   await ledger.settleModel(upper,response.usage)
   responses.push({usage:response.usage,toolCalls:response.toolCalls,content:response.content,modelDurationMs,limits:{requests:response.requestLimit,tokens:response.tokenLimit,remainingRequests:response.rateLimit.remainingRequests,remainingTokens:response.rateLimit.remainingTokens}})
   return response
  }}
  const timeout=scenario.id===19&&turn===0?oneAgendaTimeout(meter.db):null
  const lostCommit=scenario.id===14&&turn===1?loseFirstCommittedBatch(meter.db,tenant):null
  const runtimeDb=lostCommit?.db??timeout?.db??meter.db
  const observer={tool:(event:any)=>tools.push({...event,conversationId:conversation}),response:(mode:string)=>responseModes.push(mode)}
  async function peer(thread:string,step:number,message:string){
   const peerContext={...context,conversationId:thread,sourceMessageId:`${thread}-${step}`,traceId:`peer-${thread}-${step}`,nowMs:lunaNow(context)+step*100}
   const peerJournal=journalFor(peerContext)
   await checkpoint('cert-peer-inbound',{message},async()=>{await meter.db.batch([
    meter.db.prepare(`INSERT INTO chat_threads(tenant_id,module_id,id,channel,external_thread_id,status,created_at_ms,updated_at_ms) VALUES(?1,'petshop',?2,'internal',?2,'open',?3,?3) ON CONFLICT DO NOTHING`).bind(tenant,thread,Date.now()),
    meter.db.prepare(`INSERT INTO chat_messages(tenant_id,module_id,id,thread_id,external_message_id,direction,actor_type,content_text,created_at_ms) VALUES(?1,'petshop',?2,?3,?2,'inbound','customer',?4,?5)`).bind(tenant,peerContext.sourceMessageId,thread,message,lunaNow(peerContext)),
   ]);return true},peerJournal)
   const peerResult=await runLunaTurn({database:meter.db,provider,context:peerContext,journal:peerJournal,maxTokens,observer:{tool:event=>tools.push({...event,conversationId:thread}),response:mode=>responseModes.push(mode)}})
   if(peerResult.reply){const outbound=await checkpoint('cert-peer-outbound',{reply:peerResult.reply},async()=>{const id=crypto.randomUUID();await meter.db.prepare(`INSERT INTO chat_messages(tenant_id,module_id,id,thread_id,direction,actor_type,content_text,created_at_ms) VALUES(?1,'petshop',?2,?3,'outbound','assistant',?4,?5)`).bind(tenant,id,thread,peerResult.reply,lunaNow(peerContext)).run();return id},peerJournal);await checkpoint('cert-peer-presentation',{outbound,proposals:peerResult.proposalIds},async()=>{await recordProposalPresentation(meter.db,peerContext,peerResult.proposalIds,outbound);return true},peerJournal)}
   responses.push({peer:thread,step,message,result:peerResult})
   return peerResult
  }
  async function concurrent<T>(tasks:Promise<T>[]):Promise<T[]>{const settled=await Promise.allSettled(tasks);const failure=settled.find(result=>result.status==='rejected');if(failure?.status==='rejected')throw failure.reason;return settled.map(result=>(result as PromiseFulfilledResult<T>).value)}
  ledger.category('runtime')
  if(scenario.id===15&&turn===3){
   const [main,competing]=await concurrent([runLunaTurn({database:runtimeDb,provider,context,observer,journal,maxTokens}),peer('benefit-peer',2,'Confirmo o horário.')])
   result=main
   const winners=[main,competing].filter(r=>r.committedOperationIds.length).length
   const conflicts=tools.filter(t=>t.name==='commit_confirmed_proposal'&&!t.result.ok&&['PACKAGE_BENEFITS_CHANGED','PACKAGE_BENEFIT_CAPACITY_EXCEEDED'].includes(t.result.code)).length
   faults.push({kind:'benefit_race',winners,conflicts})
  }else result=await runLunaTurn({database:runtimeDb,provider,context,observer,journal,maxTokens})
  if(lostCommit){
   // Reject the post-commit send: do not persist outbound/presentation evidence.
   // Redeliver the exact same inbound ID through the native runtime and Groq.
   const first=result,firstTools=tools.length
   const recoveryJournal:LunaTurnJournal|undefined=journal?{run:(name,input,run,reconcile)=>journal.run(`redelivery:${name}`,input,run,reconcile),waitUntil:at=>journal.waitUntil(at)}:undefined
   result=await runLunaTurn({database:meter.db,provider,context,observer,journal:recoveryJournal,maxTokens})
   const reconciled=tools.slice(firstTools).some(t=>t.name==='get_operation_status'&&t.result.ok&&t.result.data?.idempotent===true)
   faults.push({kind:'post_commit_redelivery',...lostCommit.evidence(),persistedOnce:lostCommit.evidence().commits===1,rejectedSend:true,reconciled,firstResult:first})
  }
  ledger.category('admin')
  if(timeout)faults.push(timeout.evidence())
  if(result.reply){const outbound=await checkpoint('cert-outbound',{reply:result.reply},async()=>{const id=crypto.randomUUID();await meter.db.prepare(`INSERT INTO chat_messages(tenant_id,module_id,id,thread_id,direction,actor_type,content_text,created_at_ms) VALUES(?1,'petshop',?2,?3,'outbound','assistant',?4,?5)`).bind(tenant,id,conversation,result.reply,lunaNow(context)).run();return id});await checkpoint('cert-presentation',{outbound,proposals:result.proposalIds},async()=>{await recordProposalPresentation(meter.db,context,result.proposalIds,outbound);return true})}
  if(scenario.id===16&&turn===0)faults.push(await checkpoint('cert-fault-afternoon',{},()=>blockCanonicalAfternoon(meter.db,tenant)))
  if(scenario.id===15&&turn===0){ledger.category('setup');await checkpoint('cert-fault-stock',{},async()=>{await changePriceAndLastStock(meter.db,tenant);return true});ledger.category('admin');faults.push({kind:'price_and_stock_changed',injected:true})}
  if(scenario.id===15&&turn===1){
   ledger.category('runtime')
   const prepared=await concurrent([peer('stock-peer-1',1,'Quero uma Ração A, uma unidade, para retirar na loja.'),peer('stock-peer-2',1,'Quero uma Ração A, uma unidade, para retirar na loja.')])
   if(prepared.some(r=>r.status!=='awaiting_confirmation'))throw new Error('CERTIFICATION_RACE_PREPARATION_FAILED')
   const competing=await concurrent([peer('stock-peer-1',2,'Confirmo.'),peer('stock-peer-2',2,'Confirmo.')])
   const winners=competing.filter(r=>r.committedOperationIds.length).length
   const conflicts=tools.filter(t=>t.name==='commit_confirmed_proposal'&&!t.result.ok&&['INSUFFICIENT_STOCK','ORDER_STOCK_OR_PRICE_CHANGED'].includes(t.result.code)).length
   faults.push({kind:'stock_race',winners,conflicts})
   if(winners!==1||conflicts!==1)throw new Error('CERTIFICATION_STOCK_RACE_FAILED')
   ledger.category('setup');await checkpoint('cert-fault-benefit',{},async()=>{await seedLastBenefit(meter.db,tenant);return true});ledger.category('admin')
  }
  if(scenario.id===15&&turn===2){
   if(result.status!=='awaiting_confirmation')throw new Error('CERTIFICATION_MAIN_BENEFIT_PREPARATION_FAILED')
   ledger.category('runtime');const prepared=await peer('benefit-peer',1,'Quero usar o último banho do pacote para a Mel amanhã às 09h.');if(prepared.status!=='awaiting_confirmation')throw new Error('CERTIFICATION_BENEFIT_RACE_PREPARATION_FAILED');ledger.category('admin')
  }
  stateAfter=await certificationSnapshot(meter.db,tenant,conversation)
 }catch(error){if(execution&&(error instanceof LunaTurnSuspended||error instanceof LunaCheckpointError)){await execution.saveProgress({started,responses,faults,metrics:meter.metrics,budget:ledger.usage()});throw error}errors.push(error instanceof Error?error.message:'CERTIFICATION_EXECUTION_FAILED');ledger.category('admin');try{stateAfter=await certificationSnapshot(meter.db,tenant,conversation)}catch{errors.push('CERTIFICATION_POST_FAILURE_SNAPSHOT_UNAVAILABLE')}}
 const validation=validate(scenario.id,turn,scenario.messages.length,stateBefore,stateAfter,tools,result?.errorCode??errors[0]??null)
 validation.violations.push(...await operationalAssertions({id:scenario.id,turn,total:scenario.messages.length,tenant,before:stateBefore,after:stateAfter,tools,faults}))
 if(scenario.id===19&&turn===0&&!faults.some(f=>f.injected&&f.attempts===2))validation.violations.push('AGENDA_RECOVERY_NOT_EXERCISED')
 if(scenario.id===16&&turn===1&&(stateAfter.tables.luna_proposals??[]).some((p:any)=>p.status==='awaiting_confirmation'&&JSON.parse(p.payload_json).scheduled_at_ms===Date.parse('2026-10-07T17:00:00Z')))validation.violations.push('OCCUPIED_SLOT_PROPOSED')
 if(meter.unknown())validation.violations.push('CERTIFICATION_ACCOUNTING_UNCERTAIN')
 validation.passed=validation.violations.length===0
 const cumulative=await ledger.settledUsage(),turnMetrics={calls:cumulative.calls-baseline.calls,promptTokens:cumulative.input_tokens-baseline.input_tokens,completionTokens:cumulative.output_tokens-baseline.output_tokens,tokens:cumulative.input_tokens+cumulative.output_tokens-baseline.input_tokens-baseline.output_tokens,rowsRead:cumulative.totalReads-baseline.totalReads}
 if(cumulative.reserved_calls||cumulative.reserved_tokens||cumulative.reserved_reads||cumulative.uncertain){validation.violations.push('CERTIFICATION_ACCOUNTING_UNCERTAIN');validation.passed=false}
 const evidence=sanitized({scenario_id:scenario.id,turn_id:turn,source_message_id:context.sourceMessageId,conversation_id:conversation,operationIds:result?.committedOperationIds??[],timestamp:new Date(started).toISOString(),model:env.LUNA_MODEL,
  configuration,sampleOnly:!!sample,metrics:meter.unknown()?null:turnMetrics,...(configuration.provider==='workers-ai'?{estimatedNeurons:glmNeurons(turnMetrics),neuronEstimateNotInvoice:true}:{}),readBreakdown:ledger.local,durationMs:Date.now()-started,messages:[{role:'user',content:body.message},{role:'assistant',content:result?.reply}],toolCalls:tools.map(t=>({id:t.id,name:t.name,args:t.args})),toolResults:tools.map(t=>({id:t.id,result:t.result,recovery:t.recovery})),
  stateBefore,stateAfter,events:stateAfter.tables.luna_operation_events??[],proposals:stateAfter.tables.luna_proposals??[],presentations:stateAfter.tables.luna_proposal_presentations??[],
  // Native authorization evidence is the presented fingerprint, inbound
  // message and commit tool result. There are no generic confirmation tables.
  confirmations:tools.filter(t=>t.name==='commit_confirmed_proposal').map(t=>({sourceMessageId:context.sourceMessageId,args:t.args,result:t.result})),
  commits:(stateAfter.tables.luna_proposals??[]).filter((p:any)=>p.status==='completed').map((p:any)=>({proposalId:p.id,operationId:p.committed_operation_id,fingerprint:p.fingerprint,version:p.version})),
  fallbacks:responseModes.filter(m=>m==='factual_fallback'),responseModes,reformulations:responseModes.filter(m=>m==='rewritten').length,errors,faults,result,responses,checkpoint:{tenant,conversation,nextTurn:turn+1},validation})
 await db.prepare(`UPDATE luna_cert_turns SET status='complete',evidence_json=?2 WHERE idempotency_key=?1 AND status='running'`).bind(key,JSON.stringify(evidence)).run()
 return reply({...evidence as Record<string,unknown>,budget:ledger.usage()})
}
// Same DO binding, staging-only subclass. No certification fixture dependency
// is imported into the production Worker or its conversation implementation.
export class LunaConversationDurableObject extends NativeConversation {
 protected override async executeJob(job:DurableTurnJob):Promise<unknown>{
  const payload=job.payload as {body?:any;configuration?:string}
  if(!payload.body)return super.executeJob(job)
  const env=this.env as Env,previous=await this.ctx.storage.get(`cert-progress:${job.id}`)
  if(payload.body.sha!==env.RELEASE_SHA||payload.configuration!==(await identity(env)).fingerprint)throw new LunaCheckpointError('CERTIFICATION_JOB_RELEASE_CHANGED')
  const response=await certification(new Request('https://luna.internal/internal/luna-certification/turn',{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${env.LUNA_CERT_TOKEN}`},body:JSON.stringify(payload.body)}),env,{jobId:job.id,previous,saveProgress:value=>this.ctx.storage.put(`cert-progress:${job.id}`,value)})
  const result=await response.json()
  if(!response.ok)throw new LunaCheckpointError((result as {code?:string}).code??'CERTIFICATION_EXECUTION_FAILED')
  return result
 }
 override async fetch(request:Request):Promise<Response>{
  if(new URL(request.url).pathname==='/certification/submit'&&request.method==='POST'){
   const env=this.env as Env
   if(env.APP_ENV!=='staging'||env.LUNA_ENABLED!=='false'||env.LUNA_CERT_ENV!=='isolated-luna-v2')return json({code:'CERTIFICATION_DISABLED'},404)
   const payload=await request.json() as {jobId:string;body:any;configuration:string}
   if(payload.body.sha!==env.RELEASE_SHA||payload.configuration!==(await identity(env)).fingerprint)return json({code:'CERTIFICATION_JOB_RELEASE_CHANGED'},409)
   const expectedId=await hashCanonicalJson({key:`${payload.body.roundId}:${env.RELEASE_SHA}:${payload.body.scenarioId}:${payload.body.turn}`,configuration:payload.configuration})
   if(payload.jobId!==expectedId)return json({code:'CERTIFICATION_JOB_ID_MISMATCH'},409)
   const job=await this.enqueue(()=>this.jobs().submit(payload.jobId,{body:payload.body,configuration:payload.configuration}))
   return json({accepted:true,turn_id:job.id,status:job.status},202)
  }
  return super.fetch(request)
 }
}
export default{...application,async fetch(request:Request,env:Env,ctx:ExecutionContext){
 const path=new URL(request.url).pathname
 if(path==='/luna-certification'&&request.method==='GET'&&env.APP_ENV==='staging'&&env.LUNA_CERT_ENV==='isolated-luna-v2')return certificationPlayground(env.RELEASE_SHA??'',lunaProviderIdentity(env),env.LUNA_CERT_SAMPLE_ONLY==='true')
 if(path.startsWith('/internal/luna-certification/')||path.startsWith('/api/ai-lab/luna/certification/')){try{return await certification(request,env)}catch{return json({code:'CERTIFICATION_INTERNAL_FAILURE'},503)}}
 return application.fetch(request,env,ctx)
}}
