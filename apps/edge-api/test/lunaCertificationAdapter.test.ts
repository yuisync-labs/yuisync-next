import { env } from 'cloudflare:workers'
import { describe,expect,it,vi } from 'vitest'
import { certificationMeter } from '../../../scripts/luna/certificationMeter'
import { seedCertificationFixture } from '../../../scripts/luna/certificationFixtures'
import worker,{ certificationSnapshot,initializeCertificationSchema } from '../../../scripts/luna/stagingWorker'
import { runLunaTurn } from '../src/luna/runLunaTurn'
import { oneAgendaTimeout,blockCanonicalAfternoon } from '../../../scripts/luna/certificationFaults'

const db=(env as EdgeEnv & {DB:D1Database}).DB
const limits={calls:6,tokens:100000,rowsRead:20000}
describe('Isolated staging certification adapter — no external provider',()=>{
 it('injects one real agenda timeout and then delegates recovery to D1',async()=>{
  await seedCertificationFixture(db,'cert-local-timeout','scenario-19',19)
  const fault=oneAgendaTimeout(certificationMeter(db,limits).db)
  const query=()=>fault.db.prepare('SELECT scheduled_at_ms,duration_min FROM appointments WHERE tenant_id=?1').bind('cert-local-timeout').all()
  await expect(query()).rejects.toThrow('FIXTURE_AGENDA_TIMEOUT')
  expect((await query()).results).toEqual([])
  expect(fault.evidence()).toEqual({kind:'agenda_timeout_once',injected:true,attempts:2})
 })
 it('blocks the canonical afternoon through actual agenda data and capacity',async()=>{
  await seedCertificationFixture(db,'cert-local-occupied','scenario-16',16)
  await blockCanonicalAfternoon(db,'cert-local-occupied')
  expect(await db.prepare("SELECT status,scheduled_at_ms FROM appointments WHERE tenant_id=?1 AND id='occupied'").bind('cert-local-occupied').first()).toEqual({status:'blocked',scheduled_at_ms:Date.parse('2026-10-07T17:00:00Z')})
 })
 it('meters actual first/all/batch reads without dropping D1 metadata',async()=>{
  const meter=certificationMeter(db,limits)
  expect(await meter.db.prepare('SELECT 1 AS n').first('n')).toBe(1)
  const all=await meter.db.prepare('SELECT 2 AS n').all()
  const batch=await meter.db.batch([meter.db.prepare('SELECT 3 AS n'),meter.db.prepare('SELECT 4 AS n')])
  expect(all.results).toEqual([{n:2}]);expect(batch.map(r=>r.results[0])).toEqual([{n:3},{n:4}])
  expect(Number.isSafeInteger(meter.metrics.rowsRead)).toBe(true)
  expect(meter.unknown()).toBe(false)
 })
 it('rejects a SQL operation before execution when there is no read reservation',async()=>{
  const meter=certificationMeter(db,{...limits,rowsRead:511})
  await expect(meter.db.prepare('SELECT 1').all()).rejects.toThrow('READ_RESERVATION_EXHAUSTED')
  expect(meter.metrics.rowsRead).toBe(0)
 })
 it('rejects missing metrics, forbidden raw SQL and invalid provider usage',async()=>{
  const raw={all:async()=>({results:[],meta:{}})} as unknown as D1PreparedStatement
  const fake={prepare:()=>raw} as unknown as D1Database
  const meter=certificationMeter(fake,limits)
  await expect(meter.db.prepare('SELECT 1').all()).rejects.toThrow('READ_METRICS_UNAVAILABLE')
  expect(meter.unknown()).toBe(true)
  await expect(meter.db.exec('SELECT 1')).rejects.toThrow('EXEC_UNSUPPORTED')
  expect(()=>meter.afterModel({promptTokens:NaN,completionTokens:1})).toThrow('MODEL_METRICS_UNAVAILABLE')
 })
 it('records known over-budget usage rather than declaring it unknown',()=>{
  const meter=certificationMeter(db,{...limits,tokens:1})
  expect(()=>meter.beforeModel({messages:[]})).toThrow('MODEL_RESERVATION_EXHAUSTED')
  expect(meter.metrics.calls).toBe(0)
  expect(()=>meter.afterModel({promptTokens:2,completionTokens:3})).toThrow('TOKEN_BOUND_EXCEEDED')
  expect(meter.metrics.tokens).toBe(5);expect(meter.unknown()).toBe(false)
 })
 it('seeds canonical fake data and snapshots only existing required native tables',async()=>{
  await seedCertificationFixture(db,'cert-local-snapshot','scenario-1',1)
  const meter=certificationMeter(db,limits)
  const snapshot=await certificationSnapshot(meter.db,'cert-local-snapshot','scenario-1')
  expect(snapshot.tables.clients).toHaveLength(1)
  expect(snapshot.tables.pets).toHaveLength(3)
  expect(snapshot.tables.luna_registration_receipts).toEqual([])
  expect(snapshot.tables).not.toHaveProperty('luna_confirmations')
  expect(snapshot.tables).not.toHaveProperty('luna_operation_receipts')
  expect(meter.metrics.rowsRead).toBeLessThan(512)
 })
 it('seeds forty complete historical turns, not forty single messages',async()=>{
  await seedCertificationFixture(db,'cert-local-history','scenario-7',7)
  const rows=await db.prepare('SELECT direction,COUNT(*) AS n FROM chat_messages WHERE tenant_id=?1 GROUP BY direction').bind('cert-local-history').all()
  expect(rows.results).toEqual([{direction:'inbound',n:40},{direction:'outbound',n:40}])
 })
 const fixtureEnv=()=>({...env,APP_ENV:'staging',LUNA_ENABLED:'false',LUNA_CERT_ENV:'isolated-luna-v2',LUNA_CERT_DATABASE_ID:'fixture-db-id',LUNA_CERT_TOKEN:'local-fake-bearer',LUNA_CERT_DB:db,DB:{} as D1Database,AUTH_DB:{} as D1Database,RELEASE_SHA:'fixture-sha'} as any)
 const request=(path:string,body?:unknown,token='local-fake-bearer')=>new Request(`https://fixture.invalid/internal/luna-certification/${path}`,{method:body?'POST':'GET',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})})
 const ctx={} as ExecutionContext
 it('fails closed outside staging, when automation is enabled, or when fixture DB aliases application DB',async()=>{
  for(const overrides of [{APP_ENV:'production'},{LUNA_ENABLED:'true'},{DB:db},{AUTH_DB:db}]){
   expect((await worker.fetch(request('capabilities'),{...fixtureEnv(),...overrides} as any,ctx)).status).toBe(404)
  }
  expect((await worker.fetch(request('capabilities',undefined,'wrong'),fixtureEnv(),ctx)).status).toBe(401)
 })
 it('allows only compare-and-swap checkpoint creation and prevents lost updates',async()=>{
  const environment=fixtureEnv(),roundId='local-cas-test'
  await initializeCertificationSchema(db)
  await db.prepare("INSERT INTO luna_cert_identity VALUES(1,'fixture-db-id','isolated-luna-v2')").run()
  const capabilities=await (await worker.fetch(request('capabilities',{roundId}),environment,ctx)).json() as {fingerprint:string}
  const save=async(expectedVersion:number,version:number)=>{
   const response=await worker.fetch(request('store/save',{roundId,expectedVersion,state:{roundId,sha:'fixture-sha',version,configurationFingerprint:capabilities.fingerprint}}),environment,ctx)
   return await response.json() as {saved:boolean}
  }
  expect(await save(9,10)).toEqual({saved:false})
  expect(await save(0,1)).toEqual({saved:true})
  expect(await save(0,1)).toEqual({saved:false})
  expect(await save(1,2)).toEqual({saved:true})
  expect(await save(1,2)).toEqual({saved:false})
 })
 it('observes native tool results and response mode without substituting business execution',async()=>{
  const tenant='cert-local-observer',conversation='scenario-observer'
  await seedCertificationFixture(db,tenant,conversation,1)
  await db.prepare(`INSERT INTO chat_messages(tenant_id,module_id,id,thread_id,external_message_id,direction,actor_type,content_text,created_at_ms) VALUES(?1,'petshop','in-observer',?2,'in-observer','inbound','customer','Olá',?3)`).bind(tenant,conversation,Date.now()).run()
  let calls=0
  const tool=vi.fn(),response=vi.fn()
  const provider={model:'offline-observer-only',async complete(){
   calls++
   return {content:calls===1?null:JSON.stringify({blocks:[{kind:'social',text:'Olá!'}]}),toolCalls:calls===1?[{id:'observed-call',type:'function' as const,function:{name:'get_customer_context',arguments:'{}'}}]:[],usage:{promptTokens:10,completionTokens:10},rateLimit:{remainingRequests:900,remainingTokens:7000,resetRequests:null,resetTokens:null},requestLimit:1000}
  }}
  const result=await runLunaTurn({database:db,provider,context:{tenantId:tenant,moduleId:'petshop',conversationId:conversation,customerAddress:'5532999990011',phoneNumberId:'fixture-no-whatsapp',sourceMessageId:'in-observer',traceId:'observer',executionMode:'fixture'},observer:{tool,response}})
  expect(result.errorCode).toBeNull()
  expect(tool).toHaveBeenCalledWith(expect.objectContaining({name:'get_customer_context',args:{},result:expect.objectContaining({ok:true}),recovery:false}))
  expect(response).toHaveBeenCalledOnce()
  expect(result.committedOperationIds).toEqual([])
 })
})
