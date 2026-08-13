import { allocationOperationKey, type BenefitAllocation } from './subscriptionBenefitResolver'
export function billingAllocationStatements(db:D1Database,input:{tenantId:string;moduleId:string;appointmentId:string;allocations:BenefitAllocation[];now:number}){
 const{tenantId,moduleId,appointmentId,allocations,now}=input
 return allocations.map((a)=>db.prepare(`INSERT INTO subscription_benefit_allocations(tenant_id,module_id,id,subscription_id,appointment_id,appointment_service_position,benefit_kind,benefit_key,service_code,state,operation_key,catalog_price_cents,version,reserved_at_ms,consumed_at_ms,released_at_ms,created_at_ms,updated_at_ms) VALUES(?1,?2,?3,?4,?5,?6,'service',?7,?8,'reserved',?9,?10,1,?11,NULL,NULL,?11,?11)`).bind(tenantId,moduleId,crypto.randomUUID(),a.subscriptionId,appointmentId,a.position,a.benefitKey,a.serviceCode,allocationOperationKey(appointmentId,a),a.catalogPriceCents,now))
}
