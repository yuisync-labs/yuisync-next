import type { LunaExecutionContext,LunaToolResult } from './contracts'
import { isConversationCustomer } from './customerIdentity'
import type { TransportSnapshot } from '../appointmentTransportContract'
export type { TransportSnapshot } from '../appointmentTransportContract'
export async function resolveTransportSnapshot(db:D1Database,ctx:LunaExecutionContext,petId:string,start:number,duration:number,raw:unknown):Promise<LunaToolResult<TransportSnapshot>>{
 if(!raw||typeof raw!=='object'||Array.isArray(raw))return{ok:false,code:'TRANSPORT_FIELDS_REQUIRED',retryable:false}
 const args=raw as Record<string,unknown>
 if(!Number.isSafeInteger(start)||!Number.isSafeInteger(duration)||duration<15||duration>1440||typeof args.option_id!=='string'||args.option_id.length>80)return{ok:false,code:'TRANSPORT_FIELDS_REQUIRED',retryable:false}
 if(typeof args.address!=='string'||!args.address.trim()||typeof args.city!=='string'||!args.city.trim())return{ok:false,code:'TRANSPORT_ADDRESS_REQUIRED',retryable:false,missing_fields:['address','city']}
 if(args.address.length>500||args.city.length>120||(args.reference!=null&&(typeof args.reference!=='string'||args.reference.length>500)))return{ok:false,code:'TRANSPORT_FIELDS_REQUIRED',retryable:false}
 const pet=await db.prepare(`SELECT client_id,weight_kg FROM pets WHERE tenant_id=?1 AND module_id=?2 AND id=?3 AND status='active'`).bind(ctx.tenantId,ctx.moduleId,petId).first<{client_id:string;weight_kg:number|null}>()
 if(!pet||!await isConversationCustomer(db,ctx,pet.client_id))return{ok:false,code:'CUSTOMER_SCOPE_DENIED',retryable:false}
 const option=await db.prepare(`SELECT o.*,s.store_city FROM transport_options o JOIN tenant_module_settings s ON s.tenant_id=o.tenant_id AND s.module_id=o.module_id WHERE o.tenant_id=?1 AND o.module_id=?2 AND o.id=?3 AND o.status='active'`).bind(ctx.tenantId,ctx.moduleId,args.option_id).first<{id:string;label:string;fee_cents:number;pickup_required:number;dropoff_required:number;outside_city:number;max_weight_grams:number|null;store_city:string|null}>()
 if(!option||!option.store_city||!(option.pickup_required||option.dropoff_required))return{ok:false,code:'TRANSPORT_OPTION_UNAVAILABLE',retryable:false}
 const normalized=(s:string)=>s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLowerCase()
 if(Number(normalized(option.store_city)!==normalized(args.city))!==option.outside_city)return{ok:false,code:'TRANSPORT_OUTSIDE_COVERAGE',retryable:false}
 const weight=pet.weight_kg==null?null:Math.round(pet.weight_kg*1000)
 if(option.max_weight_grams!=null&&(weight==null||weight<=0))return{ok:false,code:'PET_WEIGHT_REQUIRED',retryable:false}
 if(option.max_weight_grams!=null&&weight!>option.max_weight_grams)return{ok:false,code:'TRANSPORT_WEIGHT_EXCEEDED',retryable:false}
 const end=start+duration*60000
 const window=await db.prepare(`SELECT r.id AS resource_id,r.capacity,w.id AS window_id,w.version AS window_version FROM transport_option_resources m JOIN transport_resources r ON r.tenant_id=m.tenant_id AND r.module_id=m.module_id AND r.id=m.resource_id JOIN transport_availability_windows w ON w.tenant_id=r.tenant_id AND w.module_id=r.module_id AND w.resource_id=r.id WHERE m.tenant_id=?1 AND m.module_id=?2 AND m.option_id=?3 AND r.status='active' AND w.starts_at_ms<=?4 AND w.ends_at_ms>=?5 ORDER BY w.starts_at_ms,w.id LIMIT 1`).bind(ctx.tenantId,ctx.moduleId,option.id,start,end).first<{resource_id:string;capacity:number;window_id:string;window_version:number}>()
 if(!window)return{ok:false,code:'TRANSPORT_CAPACITY_UNAVAILABLE',retryable:false}
 const count=await db.prepare(`SELECT COUNT(*) AS count FROM transport_resource_allocations WHERE tenant_id=?1 AND module_id=?2 AND resource_id=?3 AND starts_at_ms<?5 AND ends_at_ms>?4`).bind(ctx.tenantId,ctx.moduleId,window.resource_id,start,end).first<{count:number}>()
 if(count!.count>=window.capacity)return{ok:false,code:'TRANSPORT_SLOT_UNAVAILABLE',retryable:false}
 return{ok:true,data:{...window,option_id:option.id,label:option.label,fee_cents:option.fee_cents,pickup_required:option.pickup_required,dropoff_required:option.dropoff_required,outside_city:option.outside_city,store_city:option.store_city,max_weight_grams:option.max_weight_grams,starts_at_ms:start,ends_at_ms:end,city:args.city,address:args.address.trim(),reference:typeof args.reference==='string'?args.reference.trim()||null:null,pet_id:petId,weight_grams:weight}}
}
