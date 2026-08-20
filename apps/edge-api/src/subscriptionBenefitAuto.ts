import { loadBenefitCandidates } from './subscriptionBenefitCandidates'
export async function automaticAllocations(db:D1Database,scope:any,items:any[],ignoreAppointmentId=''){
 const out:any[]=[],pending=new Map<string,number>()
 for(let i=0;i<items.length;i++){const code=String(items[i].service_code||items[i].code||'');const rows=await loadBenefitCandidates(db,{...scope,serviceCode:code,ignoreAppointmentId});for(const r of rows.results){const k=`${r.subscription_id}:${r.benefit_key}`,p=pending.get(k)||0;if(+r.baseline_used + +r.active_qty + p >= +r.max_qty)continue;out.push({subscriptionId:r.subscription_id,serviceCode:code,benefitKey:r.benefit_key,position:i,catalogPriceCents:Math.round(Number(items[i].catalog_price||items[i].unit_price||0)*100),planName:r.plan_name});pending.set(k,p+1);break}}
 return out
}