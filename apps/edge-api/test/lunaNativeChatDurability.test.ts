import { env } from 'cloudflare:workers'
import { evictDurableObject, runInDurableObject } from 'cloudflare:test'
import { describe, expect, it, vi } from 'vitest'
import { LunaNativeAgent } from '../src/luna/nativeCloudflareAgent'
import { GroqSdkProvider } from '../src/luna/providers/groqSdkProvider'
import type { InternalChatJob } from '../src/luna/internalChatTurn'
import { createDesignedHarness } from './fixtures/luna/designedRuntimeHarness'

async function fixture(suffix: string) {
  const h = await createDesignedHarness(1, `-native-${suffix}`), principal = `native-admin-${suffix}`
  await h.db.batch([
    h.db.prepare(`UPDATE chat_threads SET channel='internal' WHERE tenant_id=?1 AND id=?2`).bind(h.tenant, h.ctx.conversationId),
    h.db.prepare(`INSERT INTO identity_principals(id,provider,subject,status,created_at_ms,updated_at_ms) VALUES(?1,'better-auth',?1,'active',?2,?2)`).bind(principal, h.start),
    h.db.prepare(`INSERT INTO tenant_memberships(tenant_id,principal_id,role,status,module_permissions_json,created_at_ms,updated_at_ms) VALUES(?1,?2,'owner','active','{}',?3,?3)`).bind(h.tenant, principal, h.start),
  ])
  const job: InternalChatJob = {kind:'internal-chat', context:{...h.ctx, executionMode:'staging', sourceMessageId:'native-in-1', traceId:'native-trace'}, principalId:principal, message:'Quero uma Ração A.', releaseSha:'native-fixture-v1', model:'openai/gpt-oss-20b'}
  const stub=env.LUNA_NATIVE!.getByName(h.tenant)
  const invoke=<T>(fn:(agent:LunaNativeAgent)=>Promise<T>) => runInDurableObject(stub, async (agent, state) => {
    const bindings=(agent as unknown as {env: Record<string,unknown>}).env
    const prior={...bindings}
    Object.assign(bindings,{APP_ENV:'staging',LUNA_INTERNAL_CHAT_ENABLED:'true',RELEASE_SHA:job.releaseSha,GROQ_API_KEY:'fixture-not-a-key',LUNA_MODEL:job.model})
    try {return await fn(agent)} finally {
      // Explicit SDK callbacks/alarms, never uncontrolled external requests.
      await state.storage.deleteAlarm()
      for(const key of Object.keys(bindings))if(!(key in prior))delete bindings[key]
      Object.assign(bindings,prior)
    }
  })
  const submit=async(payload=job)=>invoke(async agent=>{
    const response=await agent.onRequest(new Request('https://luna.internal/submit',{method:'POST',body:JSON.stringify(payload)}))
    return {status:response.status,body:await response.json() as any}
  })
  const status=(id:string)=>invoke(async agent=>await (await agent.onRequest(new Request(`https://luna.internal/turns/${id}`))).json() as any)
  return {...h,job,principal,stub,invoke,submit,status}
}

describe('Native Cloudflare Agent uses the operational runtime and durable D1 journal',()=>{
 it('accepts before inference, waits for quota and resumes after real eviction without repeating effects',async()=>{
  const f=await fixture('quota');let calls=0
  const provider=vi.spyOn(GroqSdkProvider.prototype,'complete').mockImplementation(async()=>{
    calls++
    const command=calls===1?{name:'search_products',args:{query:'Ração A'}}:calls===2?{name:'draft_add_item',args:{operation_id:'cart',kind:'cart',item_id:'racao-a',quantity:1}}:{name:'finish_turn',args:{intent:'cart',operation_ids:['cart'],social:[],fact_ids:['native-1:product.0'],question:'fulfillment'}}
    return {content:null,toolCalls:[{id:`native-${calls}`,type:'function',function:{name:command.name,arguments:JSON.stringify(command.args)}}],usage:{promptTokens:100,completionTokens:20},requestLimit:1000,tokenLimit:6000,rateLimit:{remainingRequests:900,remainingTokens:calls===1?0:6000,resetRequests:null,resetTokens:'1s'}}
  })
  try {
    const accepted=await f.submit();expect(accepted.status).toBe(202);expect(calls).toBe(0)
    const id=accepted.body.turn_id
    expect((await f.submit()).body.turn_id).toBe(id)
    expect((await f.submit({...f.job,message:'Quero outra coisa.'})).body.code).toBe('LUNA_JOB_PAYLOAD_CONFLICT')
    expect((await f.invoke(agent=>agent.listSchedules())).length).toBeGreaterThan(0)
    await f.invoke(agent=>agent.alarm())
    expect((await f.status(id)).status).toBe('waiting_quota');expect(calls).toBe(1)
    f.clock.mockReturnValue(f.start+2000)
    await evictDurableObject(f.stub)
    await f.invoke(agent=>agent.alarm())
    const complete=await f.status(id)
    expect(complete.status,JSON.stringify(complete)).toBe('complete')
    expect(complete.result.reply).toContain('Ração A: R$ 90,00')
    expect(complete.result.savedUserMessages).toHaveLength(1)
    expect(complete.quotaWaitMs).toBe(2000)
    await f.invoke(agent=>agent.processPendingTurns());expect(calls).toBe(3)
    expect(await f.db.prepare(`SELECT COUNT(*) AS n FROM chat_messages WHERE tenant_id=?1`).bind(f.tenant).first()).toEqual({n:2})
    expect(await f.db.prepare(`SELECT COUNT(*) AS n FROM luna_operation_events WHERE tenant_id=?1`).bind(f.tenant).first()).toEqual({n:1})
    expect(await f.db.prepare(`SELECT COUNT(*) AS n FROM sales WHERE tenant_id=?1`).bind(f.tenant).first()).toEqual({n:0})
    const steps=await f.db.prepare(`SELECT input_json,result_json FROM luna_turn_steps WHERE tenant_id=?1`).bind(f.tenant).all()
    expect(JSON.stringify(steps.results)).not.toContain('fixture-not-a-key')
  } finally {provider.mockRestore();f.close()}
 })
 it('rechecks revoked membership before inference and preserves the blocked job',async()=>{
  const f=await fixture('revoked'),provider=vi.spyOn(GroqSdkProvider.prototype,'complete')
  try {
    const accepted=await f.submit()
    await f.db.prepare(`UPDATE tenant_memberships SET status='inactive' WHERE tenant_id=?1 AND principal_id=?2`).bind(f.tenant,f.principal).run()
    await f.invoke(agent=>agent.processPendingTurns())
    expect(await f.status(accepted.body.turn_id)).toMatchObject({status:'requires_reconciliation',errorCode:'FORBIDDEN'})
    await f.invoke(agent=>agent.processPendingTurns());expect(provider).not.toHaveBeenCalled()
    expect(await f.db.prepare(`SELECT COUNT(*) AS n FROM chat_messages WHERE tenant_id=?1`).bind(f.tenant).first()).toEqual({n:0})
  } finally {provider.mockRestore();f.close()}
 })
 it('rejects cross-tenant scope on an existing instance, without exposing its private payload',async()=>{
  const f=await fixture('scope')
  try {
    const accepted=await f.submit()
    expect((await f.submit({...f.job,context:{...f.job.context,tenantId:'other-tenant'}})).body.code).toBe('LUNA_JOB_SCOPE_CONFLICT')
    expect(await f.status(accepted.body.turn_id)).not.toHaveProperty('payload')
  } finally {f.close()}
 })
})
