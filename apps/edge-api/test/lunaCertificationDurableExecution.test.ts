import { env } from 'cloudflare:workers'
import { evictDurableObject,runInDurableObject } from 'cloudflare:test'
import { describe,expect,it,vi } from 'vitest'
import staging,{LunaConversationDurableObject,initializeCertificationSchema} from '../../../scripts/luna/stagingWorker'
import { certificationBlock } from '../../../scripts/luna/certificationBlocks'
import { GroqSdkProvider } from '../src/luna/providers/groqSdkProvider'
import { LUNA_SCENARIO_CLOCK } from './fixtures/luna/designedScenarios'

describe('Staging certification durable execution, simulated provider only',()=>{
 it('admits exactly five fixed blocks, without alternate budget-reset round IDs',()=>{
  for(let n=1;n<=5;n++)expect(certificationBlock('abcdef1234567890',`groq-ui-abcdef123456-b${n}`)).toEqual({block:n,first:(n-1)*4+1,last:n*4})
  for(const suffix of ['0','6','01','1-retry','1.0',''])expect(certificationBlock('abcdef1234567890','groq-ui-abcdef123456-b'+suffix)).toBeNull()
 })
 it('returns 202 before any inference and resumes the same job after quota without duplicate messages or tools',async()=>{
  const DB=env.DB!,fixture={prepare:(sql:string)=>DB.prepare(sql),batch:(s:D1PreparedStatement[])=>DB.batch(s)} as D1Database
  await initializeCertificationSchema(DB)
  await DB.prepare(`INSERT INTO luna_cert_identity VALUES(1,'durable-local-fixture','isolated-luna-v2')`).run()
  const bindings={...env,DB:{} as D1Database,AUTH_DB:{} as D1Database,LUNA_CERT_DB:fixture,LUNA_CERT_DATABASE_ID:'durable-local-fixture',APP_ENV:'staging',LUNA_ENABLED:'false',LUNA_CERT_ENV:'isolated-luna-v2',LUNA_CERT_TOKEN:'fixture-token',GROQ_API_KEY:'fixture-only',LUNA_MODEL:'openai/gpt-oss-20b',RELEASE_SHA:'abcdef1234567890'} as any
  const body={roundId:'groq-ui-abcdef123456-b1',sha:bindings.RELEASE_SHA,scenarioId:1,turn:0,message:'Quero uma Ração A.',idempotencyKey:'groq-ui-abcdef123456-b1:abcdef1234567890:1:0',limits:{calls:6,tokens:100000,rowsRead:20000}}
  const capabilities=await staging.fetch(new Request('https://fixture.invalid/internal/luna-certification/capabilities',{method:'POST',headers:{authorization:'Bearer fixture-token','content-type':'application/json'},body:JSON.stringify({roundId:body.roundId})}),bindings,{} as ExecutionContext)
  const config=await capabilities.json() as {fingerprint:string}
  const stub=env.LUNA_AGENT!.getByName('certification-local-durable')
  // Use real SQLite DO storage and a real eviction. Alarm dispatch is explicit
  // in this clock-controlled test, not background execution of the native entrypoint.
  const invoke=<T>(fn:(instance:LunaConversationDurableObject)=>Promise<T>)=>runInDurableObject(stub,async(_instance,state)=>{try{return await fn(new LunaConversationDurableObject(state,bindings))}finally{await state.storage.deleteAlarm()}})
  const jobId='e'.repeat(64),submit=()=>new Request('https://luna.internal/certification/submit',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jobId,body,configuration:config.fingerprint})})
  const start=Date.parse(LUNA_SCENARIO_CLOCK.now),clock=vi.spyOn(Date,'now').mockReturnValue(start)
  let calls=0
  const provider=vi.spyOn(GroqSdkProvider.prototype,'complete').mockImplementation(async()=>{
   calls++
   const command=calls===1?{name:'search_products',args:{query:'Ração A'}}:calls===2?{name:'draft_add_item',args:{operation_id:'cart',kind:'cart',item_id:'racao-a',quantity:1}}:{name:'finish_turn',args:{intent:'cart',operation_ids:['cart'],social:[],fact_ids:['cert-model-1:product.0'],question:'fulfillment'}}
   return {content:null,toolCalls:[{id:`cert-model-${calls}`,type:'function',function:{name:command.name,arguments:JSON.stringify(command.args)}}],usage:{promptTokens:100,completionTokens:20},requestLimit:1000,tokenLimit:6000,rateLimit:{remainingRequests:900,remainingTokens:calls===1?0:6000,resetRequests:null,resetTokens:'1s'}}
  })
  try {
   expect((await invoke(instance=>instance.fetch(submit()))).status).toBe(202)
   expect(calls).toBe(0)
   expect((await invoke(instance=>instance.fetch(submit()))).status).toBe(202)
   await invoke(instance=>instance.alarm())
   const pending=await invoke(async instance=>await (await instance.fetch(new Request(`https://luna.internal/turns/${jobId}`))).json()) as any
   expect(pending.status).toBe('waiting_quota');expect(calls).toBe(1)
   expect(await DB.prepare(`SELECT COUNT(*) AS n FROM chat_messages WHERE tenant_id=?1 AND direction='inbound'`).bind('luna-cert-'+body.roundId+'-1').first()).toEqual({n:1})
   clock.mockReturnValue(start+2000)
   await evictDurableObject(stub)
   await invoke(instance=>instance.alarm())
   const completed=await invoke(async instance=>await (await instance.fetch(new Request(`https://luna.internal/turns/${jobId}`))).json()) as any
   expect(completed.status,JSON.stringify(completed)).toBe('complete')
   expect(completed.result.validation).toEqual({passed:true,violations:[]})
   expect(completed.result.metrics.calls).toBe(3)
   expect(completed.result.result.reply).toContain('Ração A: R$ 90,00')
   expect(completed.quotaWaitMs).toBe(2000)
   expect(calls).toBe(3)
   await invoke(instance=>instance.alarm());expect(calls).toBe(3)
   expect(await DB.prepare(`SELECT COUNT(*) AS n FROM chat_messages WHERE tenant_id=?1 AND direction='inbound'`).bind('luna-cert-'+body.roundId+'-1').first()).toEqual({n:1})
   expect(await DB.prepare(`SELECT COUNT(*) AS n FROM luna_operation_events WHERE tenant_id=?1`).bind('luna-cert-'+body.roundId+'-1').first()).toEqual({n:1})
   expect(await DB.prepare(`SELECT COUNT(*) AS n FROM sales WHERE tenant_id=?1`).bind('luna-cert-'+body.roundId+'-1').first()).toEqual({n:0})
  }finally{provider.mockRestore();clock.mockRestore()}
 },60_000)
})
