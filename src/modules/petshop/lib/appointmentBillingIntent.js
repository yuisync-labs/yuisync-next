import { buildCatalogUsageSummary } from './catalogPlanServices'
export function resolveAppointmentBillingIntent(subscriptions=[],catalogServices=[],serviceCodes=[]){
 const allocations=[]
 for(const code of [...new Set((serviceCodes||[]).map(String).filter(Boolean))])for(const subscription of subscriptions||[]){const entry=buildCatalogUsageSummary(subscription,catalogServices).find((item)=>String(item.service_code||item.service_type)===code&&Number(item.remaining||0)>0);if(!entry)continue;allocations.push({service_code:code,subscription_id:String(subscription.id)});break}
 return allocations.length?{type:'subscription',allocations}:{type:'standalone',allocations:[]}
}
