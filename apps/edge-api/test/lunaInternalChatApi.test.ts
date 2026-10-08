import { env } from 'cloudflare:workers'
import { beforeAll, afterEach, describe, expect, it, vi } from 'vitest'
import * as auth from '../src/auth/betterAuthRuntime'
import { handleInternalChatApiRequest } from '../src/internalChatApi'

const db=env.DB!,tenant='native-api-tenant',principal='native-api-owner',thread='native-api-thread'
beforeAll(async()=>{
 const now=Date.now()
 await db.batch([
  db.prepare(`INSERT INTO tenants(id,slug,name,status,created_at_ms,updated_at_ms) VALUES(?1,?1,'Fixture','active',?2,?2)`).bind(tenant,now),
  db.prepare(`INSERT INTO identity_principals(id,provider,subject,status,created_at_ms,updated_at_ms) VALUES(?1,'better-auth',?1,'active',?2,?2)`).bind(principal,now),
  db.prepare(`INSERT INTO tenant_memberships(tenant_id,principal_id,role,status,module_permissions_json,created_at_ms,updated_at_ms) VALUES(?1,?2,'owner','active','{}',?3,?3)`).bind(tenant,principal,now),
  db.prepare(`INSERT INTO chat_threads(tenant_id,module_id,id,channel,external_thread_id,status,created_at_ms,updated_at_ms) VALUES(?1,'petshop',?2,'internal','5532999990001','open',?3,?3)`).bind(tenant,thread,now),
 ])
})
afterEach(()=>vi.restoreAllMocks())
function fixture(){
 vi.spyOn(auth,'getBetterAuthSession').mockResolvedValue({user:{id:principal,name:'Fixture',email:'fixture@staging.invalid',emailVerified:true,createdAt:new Date(),updatedAt:new Date()},session:{id:'fixture-session',userId:principal,token:'private-fixture-cookie',expiresAt:new Date(Date.now()+60000),createdAt:new Date(),updatedAt:new Date()}})
 const forward=vi.fn(async(_request:Request)=>Response.json({accepted:true,turn_id:'a'.repeat(64),status:'queued'},{status:202}))
 const namespace={idFromName:vi.fn(name=>name),get:vi.fn(()=>({fetch:forward}))}
 const bindings={...env,APP_ENV:'staging',LUNA_INTERNAL_CHAT_ENABLED:'true',GROQ_API_KEY:'fixture-key',LUNA_MODEL:'openai/gpt-oss-20b',RELEASE_SHA:'fixture-sha',LUNA_NATIVE:namespace} as any
 const submit=(body:unknown,scope=tenant)=>new Request('https://fixture.invalid/api/chat/respond',{method:'POST',headers:{'content-type':'application/json','x-tenant-id':scope,'x-module-id':'petshop',cookie:'private-fixture-cookie'},body:JSON.stringify(body)})
 return{forward,namespace,bindings,submit}
}
describe('Internal chat authenticated durable dispatch',()=>{
 it('constructs trusted identity and payload without forwarding cookies or model-supplied IDs',async()=>{
  const f=fixture()
  const response=await handleInternalChatApiRequest(f.submit({sessionId:thread,clientMessageId:'api-msg-1',message:'Olá',principalId:'attacker',customerAddress:'12345678',tenantId:'attacker'}),f.bindings)
  expect(response?.status).toBe(202);await response!.json()
  expect(f.namespace.idFromName).toHaveBeenCalledWith(`${tenant}:petshop:${thread}`)
  const forwarded=f.forward.mock.calls[0][0]
  expect(forwarded.headers.has('cookie')).toBe(false)
  expect(await forwarded.json()).toMatchObject({principalId:principal,context:{tenantId:tenant,customerAddress:'5532999990001',sourceMessageId:'api-msg-1',executionMode:'staging'}})
 })
 it('rejects missing idempotency identity and unauthorized tenants before dispatch',async()=>{
  const f=fixture()
  expect((await handleInternalChatApiRequest(f.submit({sessionId:thread,message:'Olá'}),f.bindings))?.status).toBe(400)
  expect((await handleInternalChatApiRequest(f.submit({sessionId:thread,clientMessageId:'api-msg',message:'Olá'},'foreign-tenant'),f.bindings))?.status).toBe(403)
  expect(f.forward).not.toHaveBeenCalled()
 })
 it('authenticates scoped status reads and forwards only GET, never another submit',async()=>{
  const f=fixture()
  const request=new Request(`https://fixture.invalid/api/chat/turns/latest?sessionId=${thread}`,{headers:{'x-tenant-id':tenant,'x-module-id':'petshop'}})
  const response=await handleInternalChatApiRequest(request,f.bindings);await response!.json()
  expect(f.forward.mock.calls[0][0].method).toBe('GET')
  expect(new URL(f.forward.mock.calls[0][0].url).pathname).toBe('/turns/latest')
 })
 it('cannot enable internal testing in production even with the flag set',async()=>{
  const f=fixture()
  expect((await handleInternalChatApiRequest(f.submit({}),{...f.bindings,APP_ENV:'production'}))?.status).toBe(404)
  expect(f.forward).not.toHaveBeenCalled()
 })
})
