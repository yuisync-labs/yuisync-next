import type { CompatRuntimeBindings } from './compatApiRuntime.js'
import { parseBillingIntent } from './subscriptionBenefitLedger'
import { resolveBenefitAllocations } from './subscriptionBenefitResolver'
import { automaticAllocations } from './subscriptionBenefitAuto'
import { resolveBillingParty } from './appointmentBillingScope'
import { resolveBillingCatalog } from './appointmentBillingCatalog'
import { requestedServiceCodes } from './appointmentBillingPolicy'

type Current={status:string;version:number;pet_id:string;client_id:string}
type Allocation={state:string;subscription_id:string;benefit_key:string;appointment_service_position:number}
export async function resolveBillingUpdateContext(request:Request,env:CompatRuntimeBindings,appointmentId:string,payload:Record<string,unknown>){
 if(!env.DB)return{error:Response.json({code:'DATABASE_NOT_CONFIGURED'},{status:503})}
 const party=await resolveBillingParty(request,env,payload);if(party.error)return{error:party.error}
 const current=await env.DB.prepare('SELECT status,version,pet_id,client_id FROM appointments WHERE tenant_id=?1 AND module_id=?2 AND id=?3 LIMIT 1').bind(party.tenantId,party.moduleId,appointmentId).first<Current>()
 if(!current)return{error:Response.json({code:'APPOINTMENT_NOT_FOUND'},{status:404})}
 const catalog=await resolveBillingCatalog({db:env.DB,tenantId:party.tenantId!,moduleId:party.moduleId!,species:party.species!,weightGrams:party.weightGrams??null,payload});if(catalog.code)return{error:Response.json({code:catalog.code},{status:409})}
 const intent=parseBillingIntent(payload),items=catalog.items||[]
 const desired=intent.type==='auto'?{allocations:await automaticAllocations(env.DB,{tenantId:party.tenantId!,moduleId:party.moduleId!,clientId:party.clientId!},items,appointmentId)}:await resolveBenefitAllocations({db:env.DB,tenantId:party.tenantId!,moduleId:party.moduleId!,clientId:party.clientId!,serviceItems:items,intent})
 if(desired.code)return{error:Response.json({code:desired.code},{status:409})}
 const existingServices=await env.DB.prepare('SELECT service_code FROM appointment_services WHERE tenant_id=?1 AND module_id=?2 AND appointment_id=?3 ORDER BY position').bind(party.tenantId,party.moduleId,appointmentId).all<{service_code:string}>()
 const active=await env.DB.prepare("SELECT state,subscription_id,benefit_key,appointment_service_position FROM subscription_benefit_allocations WHERE tenant_id=?1 AND module_id=?2 AND appointment_id=?3 AND state IN ('reserved','consumed') ORDER BY appointment_service_position").bind(party.tenantId,party.moduleId,appointmentId).all<Allocation>()
 if(current.status!=='completed'&&active.results.some((row)=>row.state==='consumed'))return{error:Response.json({code:'PACKAGE_RECONCILIATION_REQUIRED'},{status:409})}
 const beforeServices=existingServices.results.map((row)=>row.service_code).sort().join('|'),afterServices=requestedServiceCodes(payload).sort().join('|')
 const beforeBilling=active.results.map((row)=>`${row.subscription_id}:${row.benefit_key}:${row.appointment_service_position}`).sort().join('|')
 const afterBilling=(desired.allocations||[]).map((row)=>`${row.subscriptionId}:${row.benefitKey}:${row.position}`).sort().join('|')
 const commercialChanged=current.pet_id!==party.petId||beforeServices!==afterServices||beforeBilling!==afterBilling
 if(current.status==='completed')return commercialChanged?{error:Response.json({code:'APPOINTMENT_REOPEN_REQUIRED'},{status:409})}:{passthrough:true}
 return{party,current,items,allocations:desired.allocations||[],intent,active:active.results,appointmentId}
}
