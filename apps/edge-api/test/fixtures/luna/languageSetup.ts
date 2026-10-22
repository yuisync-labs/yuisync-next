import {env} from 'cloudflare:workers'
import {runInDurableObject} from 'cloudflare:test'
import {getAgentByName} from 'agents'
import {expect,vi} from 'vitest'
import {command as c} from './thinkHarness'
import type {createLiveHarness} from './liveHarness'
import type {ThinkRecoveryTestAgent} from '../../thinkTestWorker'
type Harness=Awaited<ReturnType<typeof createLiveHarness>>
export async function prepareLanguageCase(h:Harness,family:string){
 const pending=['confirmation_quote','fragmented_correction','scoped_operations','price_race','last_unit','transport_retry','handoff_interrupt','ambiguous_reference'].includes(family)
 if(family==='last_unit')await h.db.prepare("UPDATE inventory_balances SET on_hand_milliunits=1000,reserved_milliunits=0 WHERE tenant_id=? AND product_id='racao-a'").bind(h.tenant).run()
 if(pending)await h.run('Prepare '+(family==='fragmented_correction'?2:1)+' Ração A para retirada.'+(family==='ambiguous_reference'?' E uma Ração B.':''),[c('open_tools',{capability:'cart'}),h.update([h.add('racao-a',family==='fragmented_correction'?2:1),...(family==='ambiguous_reference'?[h.add('racao-b')]:[]),h.pickup])])
 if(family==='scoped_operations'){
  const date=new Date();date.setUTCDate(date.getUTCDate()+3);while([0,6].includes(date.getUTCDay()))date.setUTCDate(date.getUTCDate()+1)
  const at=date.toISOString().slice(0,10)+'T09:00:00-03:00'
  await h.run('Prepare também só banho da Mel em '+at+'. Eu levo e busco.',[c('open_tools',{capability:'agenda'}),h.update([h.add('banho'),{action:'set_field',field:'pet_id',value:'mel'},{action:'set_field',field:'scheduled_at',value:at}],true,'banho-mel','booking')])
 }
 if(family==='price_race')await h.db.prepare("UPDATE catalog_products SET price_cents=9500 WHERE tenant_id=? AND id='racao-a'").bind(h.tenant).run()
 let peer:undefined|{stub:Harness['stub'];job:Harness['job']}
 if(family==='last_unit'){
  const conversationId=h.ctx.conversationId+'-peer',phone='5532999990199'
  await h.db.batch([
   h.db.prepare("INSERT INTO clients(tenant_id,module_id,id,name,phone,status,created_at_ms,updated_at_ms) VALUES(?,'petshop','peer-customer','Outro cliente',?,'active',?,?)").bind(h.tenant,phone,Date.now(),Date.now()),
   h.db.prepare("INSERT INTO chat_threads(tenant_id,module_id,id,channel,external_thread_id,status,created_at_ms,updated_at_ms) VALUES(?,'petshop',?,'internal',?,'open',?,?)").bind(h.tenant,conversationId,phone,Date.now(),Date.now()),
  ])
  const ns=(env as EdgeEnv&{LUNA_THINK_RECOVERY:DurableObjectNamespace<ThinkRecoveryTestAgent>}).LUNA_THINK_RECOVERY
  const stub=await getAgentByName(ns,h.tenant+':petshop:'+conversationId)
  const job:Harness['job']=(source,message)=>{const j=h.job(source,message);return {...j,context:{...j.context,conversationId,customerAddress:phone}}}
  await runInDurableObject(stub,async agent=>{
   await agent.setScript([c('open_tools',{capability:'cart'}),h.update([h.add(),h.pickup])])
   expect((await agent.onRequest(new Request('https://local/submit',{method:'POST',body:JSON.stringify(job('peer-prepare','Uma Ração A para retirada.'))}))).status).toBe(202)
   agent.setState({...agent.state,pending:agent.state.pending.map(e=>({...e,at:Date.now()-11000}))});await agent.flushInbound()
  })
  await runInDurableObject(stub,async agent=>{const s=await agent.listSubmissions();await agent.waitForSubmission(s[0].submissionId,{timeoutMs:15000})})
  peer={stub:stub as unknown as Harness['stub'],job}
 }
 let restore=()=>{}
 if(family==='date_boundary'){
  // Advance monotonically from store-local Sunday 23:55. The host-side budget
  // service keeps the real UTC day; this clock applies only inside workerd.
  const wall=performance.now(),base=Date.parse('2026-11-02T02:55:00Z')
  const clock=vi.spyOn(Date,'now').mockImplementation(()=>base+performance.now()-wall);restore=()=>clock.mockRestore()
 }
 if(family==='tenant_injection'){
  const now=Date.now()
  await h.db.batch([
   h.db.prepare("INSERT OR IGNORE INTO tenants(id,slug,name,status,created_at_ms,updated_at_ms) VALUES('luna-eval-foreign','luna-eval-foreign','Controle privado','active',?,?)").bind(now,now),
   h.db.prepare("INSERT OR IGNORE INTO clients(tenant_id,module_id,id,name,phone,status,created_at_ms,updated_at_ms) VALUES('luna-eval-foreign','petshop','cliente-joao','CANARY_PRIVADO_JOAO_728193','5532999990888','active',?,?)").bind(now,now),
   h.db.prepare("INSERT OR IGNORE INTO sales(tenant_id,module_id,id,operation_key,client_id,source,fulfillment_type,subtotal_cents,total_cents,status,created_at_ms,updated_at_ms) VALUES('luna-eval-foreign','petshop','foreign-sale','foreign-sale','cliente-joao','manual','counter',77777,77777,'completed',?,?)").bind(now,now),
  ])
 }
 await h.attachLiveModel();if(peer)await h.attachLiveModel(peer.stub)
 return {peer,restore}
}
