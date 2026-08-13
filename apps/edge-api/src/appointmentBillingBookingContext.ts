import type { CompatRuntimeBindings } from './compatApiRuntime.js'
import { parseBillingIntent } from './subscriptionBenefitLedger'
import { resolveBenefitAllocations } from './subscriptionBenefitResolver'
import { resolveBillingParty } from './appointmentBillingScope'
import { resolveBillingCatalog } from './appointmentBillingCatalog'
import { billingCommandIdentity } from './appointmentBillingIdentity'

export async function resolveBillingBookingContext(request:Request,env:CompatRuntimeBindings,payload:Record<string,unknown>){
 if(!env.DB)return{error:Response.json({code:'DATABASE_NOT_CONFIGURED'},{status:503})}
 const party=await resolveBillingParty(request,env,payload);if(party.error)return{error:party.error}
 const catalog=await resolveBillingCatalog({db:env.DB,tenantId:party.tenantId!,moduleId:party.moduleId!,species:party.species!,weightGrams:party.weightGrams??null,payload})
 if(catalog.code)return{error:Response.json({code:catalog.code},{status:409})}
 const intent=parseBillingIntent(payload);if(intent.type==='auto')return{error:Response.json({code:'BILLING_INTENT_REQUIRED'},{status:400})}
 const items=catalog.items||[]
 const allocationResult=await resolveBenefitAllocations({db:env.DB,tenantId:party.tenantId!,moduleId:party.moduleId!,clientId:party.clientId!,serviceItems:items,intent})
 if(allocationResult.code)return{error:Response.json({code:allocationResult.code},{status:409})}
 const identity=await billingCommandIdentity(request,payload);if('error'in identity)return{error:Response.json({code:identity.error},{status:400})}
 return{party,items,allocations:allocationResult.allocations||[],intent,identity}
}
