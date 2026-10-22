import {env} from 'cloudflare:workers'
import {runInDurableObject,runDurableObjectAlarm,abortAllDurableObjects} from 'cloudflare:test'
import {describe,it,expect} from 'vitest'
import {ThinkRecoveryTestAgent} from './thinkTestWorker'
import {command,createThinkHarness} from './fixtures/luna/thinkHarness'

describe('Think durable domain recovery',()=>{
 it('recovers an eviction after the domain commit without duplicating the sale or rating request',async()=>{
  const ns=(env as EdgeEnv&{LUNA_THINK_RECOVERY:DurableObjectNamespace<ThinkRecoveryTestAgent>}).LUNA_THINK_RECOVERY
  const h=await createThinkHarness(160,'-restart',ns)
  let recoveryStub=h.stub as DurableObjectStub<ThinkRecoveryTestAgent>
  try{
   await h.run('Uma Ração A, retirada.',[command('open_tools',{capability:'cart'}),h.update([h.add(),h.pickup])])
   const proposal=await h.proposal()
   h.clock.mockReturnValue(h.start+40000)
   await runInDurableObject(recoveryStub,async(agent:ThinkRecoveryTestAgent)=>{
    Reflect.deleteProperty(agent,'getModel')
    await agent.setScript([command('commit_confirmed_proposal',proposal)],true)
    const admitted=await agent.onRequest(new Request('https://local/submit',{method:'POST',body:JSON.stringify(h.job('restart-confirm','Confirmo.'))}))
    expect(admitted.status).toBe(202)
    agent.setState({...agent.state,pending:agent.state.pending.map(e=>({...e,at:Date.now()-11000}))})
    await agent.flushInbound()
   })
   for(let attempt=0;attempt<80;attempt++){
    if((await h.saleRows()).results.length)break
    await new Promise(resolve=>setTimeout(resolve,50))
   }
   expect((await h.saleRows()).results).toHaveLength(1)
   // Native Actions lease reclaim and fiber recovery, without a custom retry loop.
   h.clock.mockReturnValue(h.start+380000)
   try{await runDurableObjectAlarm(recoveryStub)}catch(error){expect(String(error)).toContain('TEST_CRASH_AFTER_DOMAIN_COMMIT')}
   // An aborted RPC stub is poisoned; acquire a fresh stub after resetting actors.
   await abortAllDurableObjects()
   recoveryStub=ns.get(recoveryStub.id)
   await runDurableObjectAlarm(recoveryStub)
   recoveryStub=ns.get(recoveryStub.id)
   await runInDurableObject(recoveryStub,async(agent:ThinkRecoveryTestAgent)=>{
    const submissions=await agent.listSubmissions()
    const latest=submissions.reduce((a,b)=>a.createdAt>b.createdAt?a:b)
    await agent.waitForSubmission(latest.submissionId,{timeoutMs:20000})
    expect((await agent.inspectSubmission(latest.submissionId))?.status).toBe('completed')
    const recovered=Object.values(agent.state.turns).find(turn=>turn.batch.entries.some(entry=>entry.job.context.sourceMessageId==='restart-confirm'))
    expect(recovered?.modelCalls).toBe(2)
    expect(recovered?.results.filter(result=>result.name==='commit_confirmed_proposal')).toHaveLength(1)
   })
   expect((await h.saleRows()).results).toHaveLength(1)
   expect(await h.db.prepare("SELECT reserved_milliunits FROM inventory_balances WHERE tenant_id=? AND product_id='racao-a'").bind(h.tenant).first()).toEqual({reserved_milliunits:1000})
   const ratings=await h.db.prepare("SELECT id FROM chat_messages WHERE tenant_id=? AND direction='outbound' AND content_text LIKE '%1 a 5 estrelas%'").bind(h.tenant).all()
   expect(ratings.results).toHaveLength(1)
   expect(await h.db.prepare('SELECT status FROM chat_threads WHERE tenant_id=?').bind(h.tenant).first()).toEqual({status:'closed'})
  }finally{h.close()}
 },40000)
})
