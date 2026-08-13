import { allocationOperationKey, type BenefitAllocation } from './subscriptionBenefitResolver'
export function billingUpdateAllocationStatements(db:D1Database,input:{tenantId:string;moduleId:string;appointmentId:string;nextVersion:number;marker:number;allocations:BenefitAllocation[]}){
 const s=input,guard=`EXISTS(SELECT 1 FROM appointments a WHERE a.tenant_id=?1 AND a.module_id=?2 AND a.id=?3 AND a.version=?4 AND a.updated_at_ms=?5)`,out:D1PreparedStatement[]=[]
 out.push(db.prepare(`UPDATE subscription_benefit_allocations SET state='released',released_at_ms=?5,updated_at_ms=?5,version=version+1 WHERE tenant_id=?1 AND module_id=?2 AND appointment_id=?3 AND state='reserved' AND ${guard}`).bind(s.tenantId,s.moduleId,s.appointmentId,s.nextVersion,s.marker))
 for(const a of s.allocations){const op=allocationOperationKey(s.appointmentId,a)
  out.push(db.prepare(`UPDATE subscription_benefit_allocations SET state='reserved',subscription_id=?6,appointment_service_position=?7,benefit_key=?8,service_code=?9,catalog_price_cents=?10,reserved_at_ms=?5,released_at_ms=NULL,updated_at_ms=?5,version=version+1 WHERE tenant_id=?1 AND module_id=?2 AND operation_key=?11 AND state='released' AND ${guard}`).bind(s.tenantId,s.moduleId,s.appointmentId,s.nextVersion,s.marker,a.subscriptionId,a.position,a.benefitKey,a.serviceCode,a.catalogPriceCents,op))
  out.push(db.prepare(`INSERT OR IGNORE INTO subscription_benefit_allocations(tenant_id,module_id,id,subscription_id,appointment_id,appointment_service_position,benefit_kind,benefit_key,service_code,state,operation_key,catalog_price_cents,version,reserved_at_ms,consumed_at_ms,released_at_ms,created_at_ms,updated_at_ms) SELECT ?1,?2,?6,?7,?3,?8,'service',?9,?10,'reserved',?11,?12,1,?5,NULL,NULL,?5,?5 WHERE ${guard}`).bind(s.tenantId,s.moduleId,s.appointmentId,s.nextVersion,s.marker,crypto.randomUUID(),a.subscriptionId,a.position,a.benefitKey,a.serviceCode,op,a.catalogPriceCents))
 }
 return out
}
