import {authorizeOperation} from './operationAuthorization'
import {getBetterAuthSession,type BetterAuthRuntimeBindings} from './auth/betterAuthRuntime'
type Bindings=BetterAuthRuntimeBindings&{DB?:D1Database}
const json=(body:unknown,status=200)=>Response.json(body,{status,headers:{'cache-control':'no-store'}})
export async function handleChatQualityApiRequest(request:Request,env:Bindings):Promise<Response|null>{
 const url=new URL(request.url),review=/^\/api\/chat\/quality\/([A-Za-z0-9._:-]{1,160})\/review$/.exec(url.pathname)
 if(url.pathname!=='/api/chat/quality'&&!review)return null
 if(request.method!==(review?'PATCH':'GET'))return json({code:'METHOD_NOT_ALLOWED'},405)
 const denied=await authorizeOperation(request,env,review?'administrative':'operational');if(denied)return denied
 const tenant=request.headers.get('x-tenant-id')!,module=request.headers.get('x-module-id')!
 if(review){
  let body:{status?:unknown;notes?:unknown};try{body=await request.json()}catch{return json({code:'INVALID_JSON'},400)}
  if(!body||!['reviewed','pending'].includes(String(body.status))||typeof body.notes!=='string'||body.notes.length>1000)return json({code:'INVALID_QUALITY_REVIEW'},400)
  const session=await getBetterAuthSession(request,env);if(!session)return json({code:'UNAUTHENTICATED'},401)
  const result=await env.DB!.prepare("UPDATE chat_threads SET context_json=json_set(context_json,'$.quality_review',json(?)),updated_at_ms=? WHERE tenant_id=? AND module_id=? AND id=? AND csat_score BETWEEN 1 AND 5").bind(JSON.stringify({status:body.status,notes:body.notes,reviewed_by:session.user.id,reviewed_at_ms:Date.now()}),Date.now(),tenant,module,review[1]).run()
  return result.meta.changes?json({reviewed:true}):json({code:'RATING_NOT_FOUND'},404)
 }
 const offset=Math.trunc(Math.max(0,Math.min(1000,Number(url.searchParams.get('offset'))||0)))
 const rows=await env.DB!.prepare("SELECT t.id,t.status,t.channel,t.csat_score,t.closed_at_ms,t.updated_at_ms,c.name customer_name,json_extract(t.context_json,'$.quality_review') quality_review FROM chat_threads t LEFT JOIN clients c ON c.tenant_id=t.tenant_id AND c.module_id=t.module_id AND c.id=t.client_id WHERE t.tenant_id=? AND t.module_id=? AND t.csat_score BETWEEN 1 AND 5 ORDER BY t.updated_at_ms DESC,t.id LIMIT 51 OFFSET ?").bind(tenant,module,offset).all<{id:string;status:string;csat_score:number;customer_name:string|null;quality_review:string|null}>()
 const administrative=await authorizeOperation(request,env,'administrative')
 return json({items:rows.results.slice(0,50).map(row=>({...row,quality_review:row.quality_review?JSON.parse(row.quality_review):{status:'pending'}})),hasMore:rows.results.length>50,offset,canReview:!administrative})
}
