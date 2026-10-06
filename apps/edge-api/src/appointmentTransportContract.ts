// Native domain contract. Luna may prepare this snapshot, but the booking
// command has no dependency on the conversation/agent runtime.
export type TransportSnapshot={option_id:string;label:string;fee_cents:number;pickup_required:number;dropoff_required:number;outside_city:number;store_city:string;max_weight_grams:number|null;resource_id:string;capacity:number;window_id:string;window_version:number;starts_at_ms:number;ends_at_ms:number;city:string;address:string;reference:string|null;pet_id:string;weight_grams:number|null}
export function transportBookingStatements(db:D1Database,scope:{tenantId:string;moduleId:string;appointmentId:string;phone:string;now:number},s:TransportSnapshot):D1PreparedStatement[]{
 return[
  db.prepare(`INSERT INTO appointment_transport(tenant_id,module_id,appointment_id,option_id,fee_cents,pickup_address,dropoff_address,pickup_reference,dropoff_reference,contact_phone,status,updated_at_ms) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,'scheduled',?11)`).bind(scope.tenantId,scope.moduleId,scope.appointmentId,s.option_id,s.fee_cents,s.pickup_required?s.address:null,s.dropoff_required?s.address:null,s.pickup_required?s.reference:null,s.dropoff_required?s.reference:null,scope.phone,scope.now),
  db.prepare(`INSERT INTO appointment_transport_reservations VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9)`).bind(scope.tenantId,scope.moduleId,scope.appointmentId,s.resource_id,s.window_id,s.window_version,s.starts_at_ms,s.ends_at_ms,JSON.stringify(s)),
 ]
}
