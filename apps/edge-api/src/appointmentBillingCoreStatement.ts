import { appointmentEpoch, asNumber, asText, normalizeStatus, type JsonRecord } from './appointmentBillingPolicy'
import { allocationSnapshot, type BenefitAllocation } from './subscriptionBenefitResolver'
import type { BillingService } from './appointmentBillingCatalog'

export function billingAppointmentStatement(db:D1Database,input:{tenantId:string;moduleId:string;clientId:string;petId:string;appointmentId:string;operationKey:string;fingerprint:string;payload:JsonRecord;items:BillingService[];allocations:BenefitAllocation[];billingType:'standalone'|'subscription';now:number}){
 const {tenantId,moduleId,clientId,petId,appointmentId,operationKey,fingerprint,payload,items,allocations,billingType,now}=input
 const total=items.reduce((sum,item)=>sum+Math.max(0,Math.round(asNumber(item.catalog_price??item.unit_price)*100)),0)
 const discount=allocations.reduce((sum,a)=>sum+a.catalogPriceCents,0),primary=allocations[0]||null
 const benefits=allocations.map((a)=>({...allocationSnapshot(a,'reserved'),subscription_id:a.subscriptionId}))
 const labels=[...new Set(allocations.map((a)=>a.planName).filter(Boolean))].join(' + ')||null
 const duration=Math.max(15,Math.round(asNumber(payload.duration_min,items.reduce((sum,item)=>sum+asNumber(item.duration_min,60),0)||60)))
 return db.prepare(`INSERT INTO appointments(tenant_id,module_id,id,client_id,pet_id,scheduled_at_ms,duration_min,service_group,status,source,subtotal_cents,transport_fee_cents,notes,version,created_at_ms,updated_at_ms,operation_key,operation_fingerprint,employee_id,groomer_id,responsible_staff_key,responsible_staff_name,delivery_staff_key,delivery_staff_name,subscription_id,subscription_benefit_used,subscription_benefit_status,subscription_benefits_json,subscription_label,subscription_discount_cents,billing_intent_type,billing_intent_subscription_id) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,0,?12,1,?13,?13,?14,?15,?16,?17,?18,?19,?20,?21,?22,?23,?24,?25,?26,?27,?28,?29)`)
  .bind(tenantId,moduleId,appointmentId,clientId,petId,appointmentEpoch(payload.scheduled_at),duration,asText(items[0]?.group_type||payload.service_group)||'outro',normalizeStatus(payload.status),asText(payload.source)||'manual',total,asText(payload.notes)||null,now,operationKey,fingerprint,asText(payload.employee_id)||null,asText(payload.groomer_id)||null,asText(payload.responsible_staff_key)||null,asText(payload.responsible_staff_name)||null,asText(payload.delivery_staff_key)||null,asText(payload.delivery_staff_name)||null,primary?.subscriptionId||null,allocations.length?1:0,allocations.length?'reserved':null,JSON.stringify(benefits),labels,discount,billingType,primary?.subscriptionId||null)
}
