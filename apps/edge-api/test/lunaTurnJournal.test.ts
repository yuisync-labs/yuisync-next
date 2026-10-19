import { env } from 'cloudflare:workers'
import { describe,expect,it,vi } from 'vitest'
import { createD1TurnJournal,LunaTurnSuspended } from '../src/luna/turnJournal'
import type { LunaExecutionContext } from '../src/luna/contracts'
import { hashCanonicalJson } from '../src/luna/canonicalJson'

const db=env.DB!
const context=(id:string):LunaExecutionContext=>({tenantId:'journal-test',moduleId:'petshop',conversationId:id,sourceMessageId:'in-1',customerAddress:'fixture',phoneNumberId:'no-whatsapp',traceId:id,executionMode:'fixture'})
describe('Luna durable journal — real D1, no provider',()=>{
 it('reuses a completed model checkpoint after runtime reconstruction without another request',async()=>{
  const ctx=context('replay'),call=vi.fn(async()=>({usage:{promptTokens:25,completionTokens:3},toolCalls:[]}))
  const first=await createD1TurnJournal(db,ctx,'release-1').run('model:0',{prompt:'fixture'},call)
  expect(await createD1TurnJournal(db,ctx,'release-1').run('model:0',{prompt:'fixture'},call)).toEqual(first)
  expect(call).toHaveBeenCalledOnce()
 })
 it('rejects a changed fingerprint and isolates another customer, tenant, message and release',async()=>{
  const ctx=context('scope'),call=vi.fn(async()=>true)
  await createD1TurnJournal(db,ctx,'release-1').run('query',{},call)
  await expect(createD1TurnJournal(db,ctx,'release-1').run('query',{different:true},call)).rejects.toMatchObject({code:'LUNA_CHECKPOINT_FINGERPRINT_MISMATCH'})
  await expect(createD1TurnJournal(db,ctx,'release-2').run('query',{},call)).rejects.toMatchObject({code:'LUNA_CHECKPOINT_FINGERPRINT_MISMATCH'})
  for(const changed of [{tenantId:'other'},{sourceMessageId:'in-2'},{conversationId:'other'}]) await createD1TurnJournal(db,{...ctx,...changed},'release-1').run('query',{},call)
  expect(call).toHaveBeenCalledTimes(4)
 })
 it('does not repeat a model request when its result was lost after reservation',async()=>{
  const ctx=context('ambiguous'),fingerprint=await hashCanonicalJson({configuration:'release-1',input:{}})
  await db.prepare(`INSERT INTO luna_turn_steps VALUES(?1,'petshop',?2,?3,'model:0',?4,'{}','running',NULL,NULL,1,1)`).bind(ctx.tenantId,ctx.conversationId,ctx.sourceMessageId,fingerprint).run()
  const call=vi.fn(async()=>true)
  await expect(createD1TurnJournal(db,ctx,'release-1').run('model:0',{},call)).rejects.toMatchObject({code:'LUNA_EXECUTION_RECONCILIATION_REQUIRED'})
  expect(call).not.toHaveBeenCalled()
 })
 it('reconciles an ambiguous commit by receipt, never executing the commit again',async()=>{
  const ctx=context('commit'),fingerprint=await hashCanonicalJson({configuration:'release-1',input:{proposal:'p1'}})
  await db.prepare(`INSERT INTO luna_turn_steps VALUES(?1,'petshop',?2,?3,'tool:commit',?4,'{"proposal":"p1"}','running',NULL,NULL,1,1)`).bind(ctx.tenantId,ctx.conversationId,ctx.sourceMessageId,fingerprint).run()
  const command=vi.fn(async()=>({ok:true,idempotent:false})),reconcile=vi.fn(async()=>({ok:true,idempotent:true}))
  expect(await createD1TurnJournal(db,ctx,'release-1').run('tool:commit',{proposal:'p1'},command,reconcile)).toEqual({ok:true,idempotent:true})
  await createD1TurnJournal(db,ctx,'release-1').run('tool:commit',{proposal:'p1'},command,reconcile)
  expect(command).not.toHaveBeenCalled();expect(reconcile).toHaveBeenCalledOnce()
 })
 it('retains failure and forbids implicit retry of timeout or quota failure',async()=>{
  const ctx=context('failed'),call=vi.fn(async()=>{throw Object.assign(new Error('private diagnostic'),{code:'GROQ_TIMEOUT'})})
  await expect(createD1TurnJournal(db,ctx,'release-1').run('model:0',{},call)).rejects.toMatchObject({code:'GROQ_TIMEOUT'})
  await expect(createD1TurnJournal(db,ctx,'release-1').run('model:0',{},call)).rejects.toMatchObject({code:'GROQ_TIMEOUT'})
  expect(call).toHaveBeenCalledOnce()
  expect((await db.prepare(`SELECT error_code,result_json FROM luna_turn_steps WHERE conversation_id='failed'`).first())).toEqual({error_code:'GROQ_TIMEOUT',result_json:null})
 })
 it('consults the receipt immediately after a post-commit response failure, without repeating the command',async()=>{
  const ctx=context('receipt-after-commit'),command=vi.fn(async()=>{throw new Error('response lost after persistence')}),reconcile=vi.fn(async()=>({ok:true,idempotent:true}))
  const journal=createD1TurnJournal(db,ctx,'release-1')
  expect(await journal.run('tool:commit',{},command,reconcile)).toEqual({ok:true,idempotent:true})
  expect(await journal.run('tool:commit',{},command,reconcile)).toEqual({ok:true,idempotent:true})
  expect(command).toHaveBeenCalledOnce();expect(reconcile).toHaveBeenCalledOnce()
 })
 it('yields to a durable alarm instead of sleeping inside the request',async()=>{
  let now=1000;const journal=createD1TurnJournal(db,context('wait'),'release-1',()=>now)
  await expect(journal.waitUntil(6000)).rejects.toBeInstanceOf(LunaTurnSuspended)
  now=6000;await expect(journal.waitUntil(6000)).resolves.toBeUndefined()
 })
})
