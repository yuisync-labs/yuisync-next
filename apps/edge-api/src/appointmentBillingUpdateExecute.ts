import type { CompatRuntimeBindings } from './compatApiRuntime.js'
import { billingAppointmentUpdateStatement } from './appointmentBillingUpdateStatement'
import { guardedBillingServiceInsert } from './appointmentBillingUpdateServiceStatement'
import { billingUpdateAllocationStatements } from './appointmentBillingUpdateAllocationStatements'
import { billingTransportStatements } from './appointmentBillingTransportStatements'

const json=(body:unknown,status=200)=>Response.json(body,{status,headers:{'cache-control':'no-store'}})
export async function executeBillingUpdate(env:CompatRuntimeBindings,payload:Record<string,unknown>,context:any){
 if(!env.DB)return json({code:'DATABASE_NOT_CONFIGURED'},503)
 const{party,current,items,allocations,intent,appointmentId}=context,marker=Date.now(),nextVersion=Number(current.version)+1,covered=new Set<number>(allocations.map((a:any)=>a.position)),scope={tenantId:party.tenantId,moduleId:party.moduleId,appointmentId,nextVersion,marker}
 const billingType=intent.type==='subscription'||(intent.type==='auto'&&allocations.length>0)?'subscription':'standalone'
 const statements:D1PreparedStatement[]=[
  billingAppointmentUpdateStatement(env.DB,{tenantId:party.tenantId,moduleId:party.moduleId,appointmentId,version:Number(current.version),payload,items,allocations,billingType,now:marker}),
  env.DB.prepare(`DELETE FROM appointment_services WHERE tenant_id=?1 AND module_id=?2 AND appointment_id=?3 AND EXISTS(SELECT 1 FROM appointments a WHERE a.tenant_id=?1 AND a.module_id=?2 AND a.id=?3 AND a.version=?4 AND a.updated_at_ms=?5)`).bind(party.tenantId,party.moduleId,appointmentId,nextVersion,marker),
  ...items.map((item:any,position:number)=>guardedBillingServiceInsert(env.DB!,scope,item,position,covered.has(position))),
  ...billingTransportStatements(env.DB,{tenantId:party.tenantId,moduleId:party.moduleId,appointmentId,payload,now:marker,allowDelete:true}),
  ...billingUpdateAllocationStatements(env.DB,{...scope,allocations}),
 ]
 try{await env.DB.batch(statements)}catch(error){const message=error instanceof Error?error.message:String(error);if(message.includes('PACKAGE_BENEFIT_CAPACITY_EXCEEDED'))return json({code:'PACKAGE_BENEFIT_CAPACITY_EXCEEDED'},409);if(message.includes('PACKAGE_ALLOCATION_SCOPE_MISMATCH'))return json({code:'PACKAGE_ALLOCATION_SCOPE_MISMATCH'},409);return json({code:'APPOINTMENT_BILLING_UPDATE_FAILED'},500)}
 const updated=await env.DB.prepare('SELECT version,updated_at_ms FROM appointments WHERE tenant_id=?1 AND module_id=?2 AND id=?3 LIMIT 1').bind(party.tenantId,party.moduleId,appointmentId).first<{version:number;updated_at_ms:number}>()
 if(!updated||Number(updated.version)!==nextVersion||Number(updated.updated_at_ms)!==marker)return json({code:'APPOINTMENT_CONCURRENT_CHANGE'},409)
 return json({data:{appointment_id:appointmentId,billing_intent:billingType,allocation_count:allocations.length,snapshot_policy:'refreshed'}})
}