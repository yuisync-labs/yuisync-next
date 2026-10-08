import {env} from 'cloudflare:workers'
import {runInDurableObject,evictDurableObject} from 'cloudflare:test'
import {describe,expect,it,vi} from 'vitest'
import {createDurableTurnJournal} from '../src/luna/durableTurnJournal'
import {createD1TurnJournal} from '../src/luna/turnJournal'
import type {LunaExecutionContext} from '../src/luna/contracts'
import {hashCanonicalJson} from '../src/luna/canonicalJson'

const context=(name:string):LunaExecutionContext=>({tenantId:'durable-journal-fixture',moduleId:'petshop',conversationId:name,sourceMessageId:'source',customerAddress:'fixture',phoneNumberId:'no-whatsapp',traceId:name,executionMode:'fixture'})
describe('native durable execution journal, real SQLite DO/D1',()=>{
 it('survives eviction without querying D1 or issuing the external call again, then mirrors receipts in a batch',async()=>{
  const stub=env.LUNA_AGENT!.getByName('local-journal-restart'),ctx=context('restart'),call=vi.fn(async()=>({ok:true,usage:{promptTokens:100,completionTokens:10}}))
  const first=await runInDurableObject(stub,async(_instance,state)=>createDurableTurnJournal(state.storage,env.DB!,ctx,'release-1').run('model:0',{prompt:'fixture'},call))
  expect(await env.DB!.prepare(`SELECT COUNT(*) n FROM luna_turn_steps WHERE conversation_id=?1`).bind(ctx.conversationId).first()).toEqual({n:0})
  await evictDurableObject(stub)
  const forbidden={prepare(){throw new Error('Unexpected remote replay')}} as unknown as D1Database
  expect(await runInDurableObject(stub,async(_instance,state)=>createDurableTurnJournal(state.storage,forbidden,ctx,'release-1').run('model:0',{prompt:'fixture'},call))).toEqual(first)
  for(const [release,prompt] of [['release-2','fixture'],['release-1','changed']])await expect(runInDurableObject(stub,async(_instance,state)=>createDurableTurnJournal(state.storage,forbidden,ctx,release).run('model:0',{prompt},call))).rejects.toMatchObject({code:'LUNA_CHECKPOINT_FINGERPRINT_MISMATCH'})
  await runInDurableObject(stub,async(_instance,state)=>createDurableTurnJournal(state.storage,env.DB!,ctx,'release-1').flush())
  expect(await env.DB!.prepare(`SELECT status FROM luna_turn_steps WHERE conversation_id=?1`).bind(ctx.conversationId).first()).toEqual({status:'complete'})
  expect(call).toHaveBeenCalledOnce()
 })
 it('hydrates legacy completed receipts but never retries a legacy uncertain or failed model request',async()=>{
  const stub=env.LUNA_AGENT!.getByName('local-journal-legacy'),ctx=context('legacy'),call=vi.fn(async()=>true)
  await createD1TurnJournal(env.DB!,ctx,'release-1').run('known',{},call)
  await expect(createD1TurnJournal(env.DB!,ctx,'release-1').run('model:lost',{},async()=>{throw Object.assign(new Error('timeout'),{code:'GROQ_TIMEOUT'})})).rejects.toMatchObject({code:'GROQ_TIMEOUT'})
  const fingerprint=await hashCanonicalJson({configuration:'release-1',input:{}})
  await env.DB!.prepare(`INSERT INTO luna_turn_steps VALUES(?1,'petshop',?2,?3,'model:unknown',?4,'{}','running',NULL,NULL,1,1)`).bind(ctx.tenantId,ctx.conversationId,ctx.sourceMessageId,fingerprint).run()
  await runInDurableObject(stub,async(_instance,state)=>{
   const journal=createDurableTurnJournal(state.storage,env.DB!,ctx,'release-1')
   expect(await journal.run('known',{},call)).toBe(true)
   await expect(journal.run('model:lost',{},call)).rejects.toMatchObject({code:'GROQ_TIMEOUT'})
   await expect(journal.run('model:unknown',{},call)).rejects.toMatchObject({code:'LUNA_EXECUTION_RECONCILIATION_REQUIRED'})
  })
  expect(call).toHaveBeenCalledOnce()
 })
 it('persists failed external calls locally before eviction and does not refund or retry them',async()=>{
  const stub=env.LUNA_AGENT!.getByName('local-journal-failure'),ctx=context('failure'),call=vi.fn(async()=>{throw Object.assign(new Error('response lost'),{code:'GROQ_TIMEOUT'})})
  await expect(runInDurableObject(stub,async(_instance,state)=>createDurableTurnJournal(state.storage,env.DB!,ctx,'release-1').run('model:0',{},call))).rejects.toMatchObject({code:'GROQ_TIMEOUT'})
  await evictDurableObject(stub)
  await runInDurableObject(stub,async(_instance,state)=>{
   const journal=createDurableTurnJournal(state.storage,env.DB!,ctx,'release-1')
   await expect(journal.run('model:0',{},call)).rejects.toMatchObject({code:'GROQ_TIMEOUT'})
   await journal.flush()
  })
  expect(call).toHaveBeenCalledOnce()
  expect(await env.DB!.prepare(`SELECT status,error_code FROM luna_turn_steps WHERE conversation_id=?1`).bind(ctx.conversationId).first()).toEqual({status:'failed',error_code:'GROQ_TIMEOUT'})
 })
 it('queries a committed operation receipt before any repetition after a response failure',async()=>{
  const stub=env.LUNA_AGENT!.getByName('local-journal-commit'),ctx=context('commit'),effect=vi.fn(async()=>{throw new Error('result lost after commit')}),lookup=vi.fn(async()=>({ok:true,idempotent:true}))
  await runInDurableObject(stub,async(_instance,state)=>{
   const journal=createDurableTurnJournal(state.storage,env.DB!,ctx,'release-1')
   expect(await journal.run('tool:commit',{},effect,lookup)).toEqual({ok:true,idempotent:true})
   await journal.flush()
  })
  await evictDurableObject(stub)
  expect(await runInDurableObject(stub,async(_instance,state)=>createDurableTurnJournal(state.storage,env.DB!,ctx,'release-1').run('tool:commit',{},effect,lookup))).toEqual({ok:true,idempotent:true})
  expect(effect).toHaveBeenCalledOnce();expect(lookup).toHaveBeenCalledOnce()
 })
 it('preserves local completed receipts if the audit mirror fails; no effect is replayed during mirror recovery',async()=>{
  const stub=env.LUNA_AGENT!.getByName('local-journal-mirror'),ctx=context('mirror'),effect=vi.fn(async()=>true)
  const broken={prepare:env.DB!.prepare.bind(env.DB!),batch:async()=>{throw new Error('D1 temporarily unavailable')}} as unknown as D1Database
  await runInDurableObject(stub,async(_instance,state)=>{
   const journal=createDurableTurnJournal(state.storage,broken,ctx,'release-1')
   expect(await journal.run('effect',{},effect)).toBe(true)
   await expect(journal.flush()).rejects.toThrow('D1 temporarily unavailable')
  })
  await evictDurableObject(stub)
  await runInDurableObject(stub,async(_instance,state)=>{
   const journal=createDurableTurnJournal(state.storage,env.DB!,ctx,'release-1')
   expect(await journal.run('effect',{},effect)).toBe(true)
   await journal.flush()
  })
  expect(effect).toHaveBeenCalledOnce()
 })
})
