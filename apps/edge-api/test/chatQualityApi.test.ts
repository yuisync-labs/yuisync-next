import {env} from 'cloudflare:workers'
import {beforeAll,afterEach,describe,it,expect,vi} from 'vitest'
import * as auth from '../src/auth/betterAuthRuntime'
import {handleChatQualityApiRequest} from '../src/chatQualityApi'
const tenant='quality-tenant',principal='quality-admin',db=env.DB!
beforeAll(async()=>{
 const now=Date.now();await db.batch([
  db.prepare("INSERT INTO tenants(id,slug,name,status,created_at_ms,updated_at_ms) VALUES(?,?,'Quality','active',?,?)").bind(tenant,tenant,now,now),
  ...['quality-admin','quality-staff'].flatMap(id=>[
   db.prepare("INSERT INTO identity_principals(id,provider,subject,status,created_at_ms,updated_at_ms) VALUES(?,'better-auth',?,'active',?,?)").bind(id,id,now,now),
   db.prepare("INSERT INTO tenant_memberships(tenant_id,principal_id,role,status,module_permissions_json,created_at_ms,updated_at_ms) VALUES(?,?,?,'active',?, ?,?)").bind(tenant,id,id===principal?'owner':'staff',id===principal?'{}':'{"petshop":{"role":"funcionario_pet"}}',now,now),
  ]),
  db.prepare("INSERT INTO chat_threads(tenant_id,module_id,id,channel,external_thread_id,status,csat_score,context_json,created_at_ms,updated_at_ms) VALUES(?,'petshop','rated','internal','5532999990011','closed',2,'{\"think\":{\"outcome\":\"completed\"}}',?,?)").bind(tenant,now,now),
 ])
})
afterEach(()=>vi.restoreAllMocks())
function session(id=principal){vi.spyOn(auth,'getBetterAuthSession').mockResolvedValue({user:{id,name:'Fixture',email:'fixture@staging.invalid',emailVerified:true,createdAt:new Date(),updatedAt:new Date()},session:{id:'s',userId:id,token:'fake',expiresAt:new Date(Date.now()+60000),createdAt:new Date(),updatedAt:new Date()}})}
const request=(scope=tenant,review=false)=>new Request('https://next/api/chat/quality'+(review?'/rated/review':''),{method:review?'PATCH':'GET',headers:{'x-tenant-id':scope,'x-module-id':'petshop'},...(review?{body:JSON.stringify({status:'reviewed',notes:'Conferido com a equipe.'})}:{})})
describe('CSAT reception and tenant-scoped quality review',()=>{
 it('shows ratings to staff but prevents administrative review',async()=>{session('quality-staff');const r=await handleChatQualityApiRequest(request(),env);expect(await r!.json()).toMatchObject({canReview:false,items:[{id:'rated',csat_score:2}]});expect((await handleChatQualityApiRequest(request(tenant,true),env))!.status).toBe(403)})
 it('records authenticated reviewer without changing the customer rating or Think state',async()=>{session();expect((await handleChatQualityApiRequest(request(tenant,true),env))!.status).toBe(200);const r=await db.prepare('SELECT csat_score,context_json FROM chat_threads WHERE tenant_id=? AND id=?').bind(tenant,'rated').first<{csat_score:number;context_json:string}>();expect(r!.csat_score).toBe(2);expect(JSON.parse(r!.context_json)).toMatchObject({think:{outcome:'completed'},quality_review:{reviewed_by:principal,status:'reviewed'}})})
 it('rejects another tenant and an unauthenticated caller',async()=>{session();expect((await handleChatQualityApiRequest(request('foreign'),env))!.status).toBe(403);vi.restoreAllMocks();vi.spyOn(auth,'getBetterAuthSession').mockResolvedValue(null);expect((await handleChatQualityApiRequest(request(),env))!.status).toBe(401)})
})
