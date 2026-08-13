import type { CompatRuntimeBindings } from './compatApiRuntime.js'
import { billingAppointmentStatement } from './appointmentBillingCoreStatement'
import { billingServiceStatement } from './appointmentBillingServiceStatement'
import { billingAllocationStatements } from './appointmentBillingAllocationStatements'
import type { resolveBillingBookingContext } from './appointmentBillingBookingContext'

type Context=Exclude<Awaited<ReturnType<typeof resolveBillingBookingContext>>,{error:Response}>
const json=(body:unknown,status=200)=>Response.json(body,{status,headers:{'cache-control':'no-store'}})
export async function executeBillingBooking(env:CompatRuntimeBindings,payload:Record<string,unknown>,context:Context){
 if(!env.DB)return json({code:'DATABASE_NOT_CONFIGURED'},503)
 const{party,items,allocations,intent,identity}=context,now=Date.now(),covered=new Set(allocations.map((a)=>a.position))
 const billingType:intentType = intent.type==='subscription'||(intent.type==='auto'&&allocations.length>0)?'subscription':'standalone'
 const statements:D1PreparedStatement[]=[
  env.DB.prepare(`INSERT INTO appointment_command_registry(tenant_id,module_id,operation_key,appointment_id,operation_fingerprint,status,created_at_ms,updated_at_ms) VALUES(?1,?2,?3,?4,?5,'completed',?6,?6)`).bind(party.tenantId,party.moduleId,identity.operationKey,identity.appointmentId,identity.fingerprint,now),
  billingAppointmentStatement(env.DB,{tenantId:party.tenantId!,moduleId:party.moduleId!,clientId:party.clientId!,petId:party.petId!,appointmentId:identity.appointmentId,operationKey:identity.operationKey,fingerprint:identity.fingerprint,payload,items,allocations,billingType,now}),
  ...items.map((item,position)=>billingServiceStatement(env.DB!,{tenantId:party.tenantId!,moduleId:party.moduleId!,appointmentId:identity.appointmentId},item,position,covered.has(position))),
  ...billingAllocationStatements(env.DB,{tenantId:party.tenantId!,moduleId:party.moduleId!,appointmentId:identity.appointmentId,allocations,now}),
 ]
 try{await env.DB.batch(statements)}catch(error){
  const message=error instanceof Error?error.message:String(error)
  const existing=await env.DB.prepare('SELECT appointment_id,operation_fingerprint FROM appointment_command_registry WHERE tenant_id=?1 AND module_id=?2 AND operation_key=?3 LIMIT 1').bind(party.tenantId,party.moduleId,identity.operationKey).first<{appointment_id:string;operation_fingerprint:string}>()
  if(existing)return existing.operation_fingerprint===identity.fingerprint?json({data:{appointment_id:existing.appointment_id,idempotent:true,billing_intent:billingType}}):json({code:'IDEMPOTENCY_KEY_REUSED',appointment_id:existing.appointment_id},409)
  if(message.includes('PACKAGE_BENEFIT_CAPACITY_EXCEEDED'))return json({code:'PACKAGE_BENEFIT_CAPACITY_EXCEEDED'},409)
  if(message.includes('PACKAGE_ALLOCATION_SCOPE_MISMATCH'))return json({code:'PACKAGE_ALLOCATION_SCOPE_MISMATCH'},409)
  return json({code:'APPOINTMENT_BILLING_BOOKING_FAILED'},500)
 }
 return json({data:{appointment_id:identity.appointmentId,idempotent:false,billing_intent:billingType,allocation_count:allocations.length}},201)
}
type intentType='standalone'|'subscription'
