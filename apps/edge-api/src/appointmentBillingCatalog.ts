import { asObject, asText, requestedServiceCodes, type JsonRecord } from './appointmentBillingPolicy'

type ServiceRow={id:string;code:string;name:string;group_type:string;default_price_cents:number;default_duration_min:number;commission_basis_points:number;min_weight_kg:number|null;max_weight_kg:number|null;min_weight_grams:number|null;max_weight_grams:number|null;species_target:string|null;status:string}
export type BillingService=JsonRecord&{id:string;service_id:string;code:string;service_code:string;name:string;group_type:string;unit_price:number;catalog_price:number;duration_min:number;commission_rate:number;min_weight_grams:number|null;max_weight_grams:number|null;species_target:string|null;benefit_used:boolean}

export async function resolveBillingCatalog(input:{db:D1Database;tenantId:string;moduleId:string;species:string;weightGrams:number|null;payload:JsonRecord}){
 const {db,tenantId,moduleId,species,weightGrams,payload}=input,codes=requestedServiceCodes(payload)
 if(!codes.length)return{code:'SERVICE_REQUIRED'};if(codes.length>10)return{code:'TOO_MANY_SERVICES'}
 const raw=Array.isArray(payload.services)?payload.services:Array.isArray(payload.service_items)?payload.service_items:[]
 const requested=new Map(raw.map((v)=>{const x=asObject(v);return[asText(x.code||x.service_code||x.service_type||x.id),x]}))
 const items:BillingService[]=[];let group=''
 for(const code of codes){
  const s=await db.prepare('SELECT id,code,name,group_type,default_price_cents,default_duration_min,commission_basis_points,min_weight_kg,max_weight_kg,min_weight_grams,max_weight_grams,species_target,status FROM services WHERE tenant_id=?1 AND module_id=?2 AND code=?3 LIMIT 1').bind(tenantId,moduleId,code).first<ServiceRow>()
  if(!s||s.status!=='active')return{code:'SERVICE_NOT_FOUND'};if(!group)group=s.group_type;else if(group!==s.group_type)return{code:'MIXED_SERVICE_GROUPS'};if(s.species_target&&s.species_target!==species)return{code:'SERVICE_SPECIES_MISMATCH'}
  const min=s.min_weight_grams??(s.min_weight_kg==null?null:Math.round(s.min_weight_kg*1000)),max=s.max_weight_grams??(s.max_weight_kg==null?null:Math.round(s.max_weight_kg*1000))
  if(weightGrams!==null&&((min!==null&&weightGrams<min)||(max!==null&&weightGrams>max)))return{code:'SERVICE_WEIGHT_MISMATCH'}
  const x=requested.get(code)||{}
  items.push({...x,id:s.id,service_id:s.id,code:s.code,service_code:s.code,name:s.name,group_type:s.group_type,unit_price:s.default_price_cents/100,catalog_price:s.default_price_cents/100,duration_min:s.default_duration_min,commission_rate:s.commission_basis_points/100,min_weight_grams:min,max_weight_grams:max,species_target:s.species_target,benefit_used:false})
 }
 return{items}
}
