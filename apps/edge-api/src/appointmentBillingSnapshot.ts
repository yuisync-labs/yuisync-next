import { allocationSnapshot, type BenefitAllocation } from './subscriptionBenefitResolver'
import { asNumber } from './appointmentBillingPolicy'
import type { BillingService } from './appointmentBillingCatalog'
export function billingSnapshot(items:BillingService[],allocations:BenefitAllocation[]){
 const total=items.reduce((sum,item)=>sum+Math.max(0,Math.round(asNumber(item.catalog_price??item.unit_price)*100)),0)
 const discount=allocations.reduce((sum,item)=>sum+item.catalogPriceCents,0),primary=allocations[0]||null
 return{total,discount,primarySubscriptionId:primary?.subscriptionId||null,benefitUsed:allocations.length?1:0,benefitStatus:allocations.length?'reserved':null,benefitsJson:JSON.stringify(allocations.map((item)=>({...allocationSnapshot(item,'reserved'),subscription_id:item.subscriptionId}))),label:[...new Set(allocations.map((item)=>item.planName).filter(Boolean))].join(' + ')||null}
}
