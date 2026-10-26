import {env} from 'cloudflare:workers'
import {runInDurableObject} from 'cloudflare:test'
import {expect} from 'vitest'
import {createWorkersAI} from 'workers-ai-provider'
import {createThinkHarness} from './thinkHarness'
import {THINK_MODEL} from '../../../src/luna/thinkPolicy'
export const liveService=(env as unknown as {LIVE_MODEL:Fetcher}).LIVE_MODEL
export async function createLiveHarness(id:number){
 const h=await createThinkHarness(900+id,'-live-matrix');h.close()
 await h.db.batch([
  h.db.prepare("UPDATE catalog_product_attributes SET food_form='wet' WHERE tenant_id=? AND product_id='sache'").bind(h.tenant),
  h.db.prepare("UPDATE catalog_product_profiles SET net_weight_grams=4000 WHERE tenant_id=? AND product_id='areia'").bind(h.tenant),
  h.db.prepare("INSERT INTO catalog_product_profile_values(tenant_id,module_id,product_id,facet,ordinal,value_text) VALUES(?,'petshop','coleira-azul','color',0,'azul')").bind(h.tenant),
  h.db.prepare("UPDATE catalog_product_profiles SET pack_count=28 WHERE tenant_id=? AND product_id='tapete'").bind(h.tenant),
  ...[['areia','cat'],['petisco','dog'],['cama-g','dog'],['coleira-azul','dog'],['tapete','dog']].map(([product,species])=>h.db.prepare("INSERT INTO catalog_product_profile_species(tenant_id,module_id,product_id,species) VALUES(?,'petshop',?,?)").bind(h.tenant,product,species)),
  h.db.prepare("INSERT INTO catalog_product_species(tenant_id,module_id,product_id,species) VALUES(?,'petshop','petisco','dog')").bind(h.tenant),
 ])
 async function attachLiveModel(stub=h.stub){await runInDurableObject(stub,async agent=>{
  // This bridge includes external orchestration latency. Keep the production
  // token/step/tool budgets, but exclude bridge overhead from its 60s timeout.
  const beforeTurn=agent.beforeTurn.bind(agent)
  agent.beforeTurn=async ctx=>({...await beforeTurn(ctx),timeout:600000})
  agent.getModel=()=>createWorkersAI({binding:{run:async(model:string,input:unknown)=>{
   const response=await liveService.fetch('https://live-model.local/run',{method:'POST',body:JSON.stringify({caseId:id,model,input})})
   if(!response.ok)throw Error('LIVE_MODEL_ERROR_'+response.status+':'+await response.text())
   return response.json()
  }} as never})(THINK_MODEL,{chat_template_kwargs:{enable_thinking:false}})
 })}
 await attachLiveModel()
 let index=0
 const turns:Record<string,any>[]=[]
 const submissions:{body:ReturnType<typeof h.job>;turnId:string}[]=[]
 async function turn(message:string|string[],peer?:{stub:typeof h.stub;job:typeof h.job}){
  const stub=peer?.stub??h.stub,makeJob=peer?.job??h.job
  const turnIndex=++index;const parts=Array.isArray(message)?message:[message];const ids:string[]=[]
  for(const [part,text] of parts.entries()){
   const job=makeJob('live-'+turnIndex+'-'+part,text)
   ids.push(await runInDurableObject(stub,async agent=>{
    const response=await agent.onRequest(new Request('https://local/submit',{method:'POST',body:JSON.stringify(job)}));expect(response.status).toBe(202)
    return (await response.json() as {turn_id:string}).turn_id
   }))
   submissions.push({body:job,turnId:ids.at(-1)!})
  }
  // The battery groups fragments for 1.5s (LUNA_INBOX_DEBOUNCE_MS), not production's 10s.
  await new Promise(resolve=>setTimeout(resolve,1600))
  await runInDurableObject(stub,async agent=>{
   await agent.flushInbound();const submissions=await agent.listSubmissions(),newest=submissions.reduce((a,b)=>a.createdAt>b.createdAt?a:b)
   await agent.waitForSubmission(newest.submissionId,{timeoutMs:600000})
  })
  const result=await runInDurableObject(stub,async agent=>await(await agent.onRequest(new Request('https://local/turns/'+ids.at(-1)))).json() as Record<string,any>)
  // Diagnostic trace for the report: which tools ran, with what, and why a handoff happened.
  const trace=await runInDurableObject(stub,async agent=>{
   const last=Object.values(agent.state.turns as Record<string,{results?:{name:string;input?:unknown;result?:unknown}[]}>).at(-1)
   const clip=(v:unknown)=>JSON.stringify(v??null).slice(0,300)
   return (last?.results??[]).map(r=>({tool:r.name,input:clip(r.input),result:clip(r.result)}))
  })
  const handoff=await h.db.prepare("SELECT json_extract(context_json,'$.think.handoff_summary.reason') reason FROM chat_threads WHERE tenant_id=? AND id=?").bind(h.tenant,h.ctx.conversationId).first<{reason:string|null}>()
  turns.push({messages:parts,result,trace,handoffReason:handoff?.reason??null});await evidence('running')
  expect(result.status,JSON.stringify(result)).toBe('complete')
  return result.result as {status:string;reply:string;[key:string]:any}
 }
 async function evidence(status:string,extra:Record<string,unknown>={}){await liveService.fetch('https://live-model.local/evidence',{method:'POST',body:JSON.stringify({id,status,turns,...extra})})}
 return {...h,turn,turns,submissions,evidence,attachLiveModel}
}
