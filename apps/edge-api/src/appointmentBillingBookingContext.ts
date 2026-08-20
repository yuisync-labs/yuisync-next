import type { CompatRuntimeBindings } from './compatApiRuntime.js'
import { parseBillingIntent } from './subscriptionBenefitLedger'
import { resolveBenefitAllocations } from './subscriptionBenefitResolver'
import { automaticAllocations } from './subscriptionBenefitAuto'
import { resolveBillingParty } from './appointmentBillingScope'
import { resolveBillingCatalog } from './appointmentBillingCatalog'
import { billingCommandIdentity } from './appointmentBillingIdentity'

export async function resolveBillingBookingContext(request:Request,env:CompatRuntimeBindings,payload:Record<string,unknown>){
 if(!env.DB)return{error:Response.json({code:'DATABASE_NOT_CONFIGURED'},{status:503})}
 const party=await resolveBillingParty(request,env,payload);if(party.error)return{error:party.error}
 const catalog=await resolveBillingCatalog({db:env.DB,tenantId:party.tenantId!,moduleId:party.moduleId!,species:party.species!,weightGrams:party.weightGrams??null,payload})
 if(catalog.code)return{error:Response.json({code:catalog.code},{status:409})
 const intent=parseBillingIntent(payload),items=catalog.items||[]
 const result=intent.type==='auto'?{allocations:await automaticAllocations(env.DB,{tenantId:party.tenantId!,moduleId:party.moduleId!,clientId:party.clientId!,petId:party.petId!},items)}:await resolveBenefitAllocations({db:env.DB,tenantId:party.tenantId!,moduleId:party.moduleId!,clientId:party.clientId!,petId:party.petId!,serviceItems:items,intent})
 if('code'in result&&result.code)return{error:Response.json({code:result.code},{status:409})
 const identity=await billingCommandIdentity(request,payload);if('error'in identity)return{error:Response.json({code:identity.error},{status:400})
 return{party,items,allocations:result.allocations||[],intent,identity}
}