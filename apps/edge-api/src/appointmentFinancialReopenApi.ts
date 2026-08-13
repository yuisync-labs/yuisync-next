import { getBetterAuthSession, type BetterAuthRuntimeBindings } from './auth/betterAuthRuntime'
import { reopenCompletedAppointment } from './appointmentReopenPolicy'

type Bindings = BetterAuthRuntimeBindings & { DB?: D1Database }
type Scope = { tenantId: string; moduleId: string; principalId: string }
type JsonRecord = Record<string, unknown>
type SaleRow = { id:string; status:string; origin_type:string|null; origin_id:string|null; appointment_id:string|null }
type PaymentRow = { id:string; status:string; provider:string|null; provider_reference:string|null }

const ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/
const json=(body:unknown,status=200)=>Response.json(body,{status,headers:{'cache-control':'no-store'}})
const text=(value:unknown)=>String(value??'').trim()
const object=(value:unknown):JsonRecord=>value&&typeof value==='object'&&!Array.isArray(value)?value as JsonRecord:{}

function financialAccess(role:string,raw:string|null,moduleId:string){
 if(role==='owner'||role==='admin')return true
 try{
  const permissions=JSON.parse(raw||'{}') as Record<string,unknown>
  const value=permissions[moduleId]??permissions['*']
  if(value===true)return true
  if(typeof value==='string')return ['admin','admin_pet','owner'].includes(value)
  if(value&&typeof value==='object'){
   const roleValue=text((value as Record<string,unknown>).role)
   return ['admin','admin_pet','owner'].includes(roleValue)
  }
 }catch{return false}
 return false
}

async function resolveScope(request:Request,bindings:Bindings):Promise<{scope?:Scope;error?:Response}>{
 if(!bindings.DB)return{error:json({code:'DATABASE_NOT_CONFIGURED'},503)}
 const tenantId=text(request.headers.get('x-tenant-id')),moduleId=text(request.headers.get('x-module-id')).toLowerCase()
 if(!ID.test(tenantId)||!ID.test(moduleId)||moduleId!=='petshop')return{error:json({code:'INVALID_SCOPE'},400)}
 const session=await getBetterAuthSession(request,bindings),userId=text(session?.user?.id)
 if(!userId)return{error:json({code:'UNAUTHENTICATED'},401)}
 const row=await bindings.DB.prepare(`SELECT p.id AS principal_id,m.role,m.module_permissions_json FROM identity_principals p JOIN tenant_memberships m ON m.principal_id=p.id WHERE p.provider='better-auth' AND p.subject=?1 AND p.status='active' AND m.tenant_id=?2 AND m.status='active' LIMIT 1`).bind(userId,tenantId).first<{principal_id:string;role:string;module_permissions_json:string|null}>()
 if(!row||!financialAccess(row.role,row.module_permissions_json,moduleId))return{error:json({code:'FINANCIAL_OPERATION_FORBIDDEN'},403)}
 return{scope:{tenantId,moduleId,principalId:row.principal_id}}
}

function targetStatus(value:unknown){
 const status=text(value).toLowerCase()
 return ({agendado:'scheduled',confirmado:'confirmed',em_andamento:'in_progress',scheduled:'scheduled',confirmed:'confirmed',in_progress:'in_progress'} as Record<string,string>)[status]||''
}

export async function handleAppointmentFinancialReopenApi(request:Request,bindings:Bindings):Promise<Response|null>{
 const url=new URL(request.url),match=url.pathname.match(/^\/api\/petshop\/appointments\/([^/]+)\/reopen-financial\/?$/)
 if(!match)return null
 if(request.method!=='POST')return json({code:'METHOD_NOT_ALLOWED'},405)
 const appointmentId=decodeURIComponent(match[1]);if(!ID.test(appointmentId))return json({code:'INVALID_APPOINTMENT'},400)
 const resolved=await resolveScope(request,bindings);if(resolved.error)return resolved.error
 const scope=resolved.scope!,db=bindings.DB!
 let body:JsonRecord;try{body=object(await request.json())}catch{return json({code:'INVALID_JSON'},400)}
 const status=targetStatus(body.status||'scheduled');if(!status)return json({code:'INVALID_REOPEN_STATUS'},400)
 const action=text(body.financial_action||'none').toLowerCase()
 if(!['none','cancel','refund'].includes(action))return json({code:'INVALID_FINANCIAL_ACTION'},400)

 const appointment=await db.prepare('SELECT id,status,version FROM appointments WHERE tenant_id=?1 AND module_id=?2 AND id=?3 LIMIT 1').bind(scope.tenantId,scope.moduleId,appointmentId).first<{id:string;status:string;version:number}>()
 if(!appointment)return json({code:'APPOINTMENT_NOT_FOUND'},404)
 if(appointment.status!=='completed')return json({code:'APPOINTMENT_NOT_COMPLETED',status:appointment.status},409)
 const sale=await db.prepare(`SELECT id,status,origin_type,origin_id,appointment_id FROM sales WHERE tenant_id=?1 AND module_id=?2 AND appointment_id=?3 AND status NOT IN ('cancelled','refunded') ORDER BY created_at_ms DESC LIMIT 1`).bind(scope.tenantId,scope.moduleId,appointmentId).first<SaleRow>()
 let financial:{action:string;sale_id:string|null;status:string|null}={action:'none',sale_id:null,status:null}

 if(sale){
  if((sale.origin_type&&sale.origin_type!=='appointment')||(!sale.origin_type&&sale.appointment_id!==appointmentId))return json({code:'APPOINTMENT_REOPEN_EXTERNAL_SALE_REVIEW_REQUIRED',sale_id:sale.id},409)
  const paymentRows=await db.prepare(`SELECT id,status,provider,provider_reference FROM payments WHERE tenant_id=?1 AND module_id=?2 AND sale_id=?3 ORDER BY created_at_ms,id`).bind(scope.tenantId,scope.moduleId,sale.id).all<PaymentRow>()
  const received=paymentRows.results.some((p)=>['authorized','received'].includes(p.status))
  if(received&&action!=='refund')return json({code:'APPOINTMENT_REOPEN_REFUND_REQUIRED',sale_id:sale.id},409)
  if(!received&&action!=='cancel')return json({code:'APPOINTMENT_REOPEN_SALE_CANCEL_REQUIRED',sale_id:sale.id},409)
  const now=Date.now(),nextSaleStatus=received?'refunded':'cancelled',statements:D1PreparedStatement[]=[]
  for(const payment of paymentRows.results){
   const next=['authorized','received'].includes(payment.status)?'refunded':['pending','awaiting_proof'].includes(payment.status)?'cancelled':payment.status
   if(next!==payment.status)statements.push(db.prepare('UPDATE payments SET status=?4,updated_at_ms=?5 WHERE tenant_id=?1 AND module_id=?2 AND id=?3').bind(scope.tenantId,scope.moduleId,payment.id,next,now))
  }
  statements.push(db.prepare(`UPDATE sales SET status=?4,updated_at_ms=?5,notes=CASE WHEN notes IS NULL OR trim(notes)='' THEN ?6 ELSE notes || ' | ' || ?6 END WHERE tenant_id=?1 AND module_id=?2 AND id=?3 AND status NOT IN ('cancelled','refunded')`).bind(scope.tenantId,scope.moduleId,sale.id,nextSaleStatus,now,`Reabertura do atendimento ${appointmentId}: ${nextSaleStatus}`))
  if(received)statements.push(db.prepare(`INSERT OR IGNORE INTO financial_effects(tenant_id,module_id,operation_key,effect_type,aggregate_id,status,attempt_count,last_error_code,updated_at_ms) VALUES(?1,?2,?3,'refund',?4,'completed',1,NULL,?5)`).bind(scope.tenantId,scope.moduleId,`appointment-reopen:${appointmentId}:refund:${sale.id}`,sale.id,now))
  try{await db.batch(statements)}catch{return json({code:'APPOINTMENT_REOPEN_FINANCIAL_TRANSITION_FAILED'},500)}
  financial={action:received?'refund':'cancel',sale_id:sale.id,status:nextSaleStatus}
 }

 const reopened=await reopenCompletedAppointment(request,bindings as any,appointmentId,status)
 if(reopened.response)return reopened.response
 if(!reopened.reopened)return json({code:'APPOINTMENT_REOPEN_NOT_APPLIED',financial},409)
 return json({data:{appointment_id:appointmentId,status,financial,package_released:reopened.packageReleased===true,reopened:true}})
}
