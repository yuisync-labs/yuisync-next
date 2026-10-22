import {env} from 'cloudflare:workers'
import {runInDurableObject} from 'cloudflare:test'
import {getAgentByName} from 'agents'
import {describe,it,expect} from 'vitest'
import {ThinkRecoveryTestAgent} from './thinkTestWorker'
import {command as c,createThinkHarness,type ThinkStep} from './fixtures/luna/thinkHarness'

describe('Two Think conversations competing on local D1',()=>{
 for(const kind of ['cart','booking'] as const){
  it('allows only one customer to reserve the last '+(kind==='cart'?'unit':'slot'),async()=>{
   const h=await createThinkHarness(kind==='cart'?190:191)
   const peerId=h.ctx.conversationId+'-peer',phone='5532999990199',at='2026-10-07T12:00:00Z'
   const ns=(env as EdgeEnv&{LUNA_THINK_RECOVERY:DurableObjectNamespace<ThinkRecoveryTestAgent>}).LUNA_THINK_RECOVERY
   try{
    await h.db.batch([
     h.db.prepare("INSERT INTO clients(tenant_id,module_id,id,name,phone,status,created_at_ms,updated_at_ms) VALUES(?,'petshop','peer-customer','Outro cliente',?,'active',?,?)").bind(h.tenant,phone,h.start,h.start),
     h.db.prepare("INSERT INTO pets(tenant_id,module_id,id,client_id,name,species,weight_kg,status,created_at_ms,updated_at_ms) VALUES(?,'petshop','peer-pet','peer-customer','Bob','dog',8,'active',?,?)").bind(h.tenant,h.start,h.start),
     h.db.prepare("INSERT INTO chat_threads(tenant_id,module_id,id,channel,external_thread_id,status,created_at_ms,updated_at_ms) VALUES(?,'petshop',?,'internal',?,'open',?,?)").bind(h.tenant,peerId,phone,h.start,h.start),
     h.db.prepare("UPDATE inventory_balances SET on_hand_milliunits=1000,reserved_milliunits=0 WHERE tenant_id=? AND product_id='racao-a'").bind(h.tenant),
     h.db.prepare("UPDATE module_settings_extensions SET data_json=json_set(data_json,'$.petbot_booking_capacity',1) WHERE tenant_id=?").bind(h.tenant),
    ])
    const stub=await getAgentByName(ns,h.tenant+':petshop:'+peerId)
    async function peer(message:string,steps:ThinkStep[],source:string){
     const job={...h.job(source,message),context:{...h.job(source,message).context,conversationId:peerId,customerAddress:phone}}
     await runInDurableObject(stub,async agent=>{
      await agent.setScript(steps)
      expect((await agent.onRequest(new Request('https://local/submit',{method:'POST',body:JSON.stringify(job)}))).status).toBe(202)
      agent.setState({...agent.state,pending:agent.state.pending.map(e=>({...e,at:Date.now()-11000}))})
      await agent.flushInbound()
     })
     await runInDurableObject(stub,async agent=>{
      const submissions=await agent.listSubmissions(),last=submissions.reduce((a,b)=>a.createdAt>b.createdAt?a:b)
      await agent.waitForSubmission(last.submissionId,{timeoutMs:15000})
      expect((await agent.inspectSubmission(last.submissionId))?.status).toBe('completed')
     })
    }
    const changes=(pet:string)=>kind==='cart'?[h.add(),h.pickup]:[h.add('banho'),{action:'set_field',field:'pet_id',value:pet},{action:'set_field',field:'scheduled_at',value:at}]
    const open=c('open_tools',{capability:kind==='cart'?'cart':'agenda'})
    await h.run(kind==='cart'?'Uma Ração A, retirada.':'Banho da Mel amanhã às 9.',[open,h.update(changes('mel'),true,'operation',kind)])
    await peer(kind==='cart'?'Uma Ração A, retirada.':'Banho do Bob amanhã às 9.',[open,h.update(changes('peer-pet'),true,'operation',kind)],'peer-prepare')
    const operation=kind==='cart'?'product_order_create':'appointment_create',p=await h.proposal(operation)
    const pp=await h.db.prepare("SELECT id,version FROM luna_proposals WHERE tenant_id=? AND conversation_id=? AND status='awaiting_confirmation'").bind(h.tenant,peerId).first<{id:string;version:number}>()
    expect(pp).not.toBeNull()
    await Promise.all([
     h.run('Confirmo.',[c('commit_confirmed_proposal',p),'As condições mudaram; preciso revisar.'],['INSUFFICIENT_STOCK','ORDER_STOCK_OR_PRICE_CHANGED','SLOT_UNAVAILABLE','SCHEDULE_CAPACITY_EXCEEDED']),
     peer('Confirmo.',[c('commit_confirmed_proposal',{proposal_id:pp!.id,proposal_version:pp!.version}),'As condições mudaram; preciso revisar.'],'peer-confirm'),
    ])
    const table=kind==='cart'?'sales':'appointments'
    expect(await h.db.prepare('SELECT COUNT(*) n FROM '+table+' WHERE tenant_id=?').bind(h.tenant).first()).toEqual({n:1})
    expect(await h.db.prepare("SELECT COUNT(*) n FROM luna_proposals WHERE tenant_id=? AND status='completed'").bind(h.tenant).first()).toEqual({n:1})
    expect(await h.db.prepare('SELECT COUNT(*) n FROM payments WHERE tenant_id=?').bind(h.tenant).first()).toEqual({n:0})
    if(kind==='cart')expect(await h.db.prepare("SELECT reserved_milliunits FROM inventory_balances WHERE tenant_id=? AND product_id='racao-a'").bind(h.tenant).first()).toEqual({reserved_milliunits:1000})
   }finally{h.close()}
  },30000)
 }
})
