import { executeInformationTool } from './informationTools'
import type { LunaExecutionContext, LunaToolResult } from './contracts'
import type { DeliverySnapshot } from '../saleDeliveryAddress'

const string = (v:unknown) => typeof v==='string'?v.trim():''
export async function resolveDeliverySnapshot(db:D1Database,ctx:LunaExecutionContext,value:unknown):Promise<LunaToolResult<DeliverySnapshot>> {
  if(!value||typeof value!=='object'||Array.isArray(value))return{ok:false,code:'DELIVERY_ADDRESS_REQUIRED',retryable:false}
  const a=value as Record<string,unknown>
  for(const [field,max] of [['street',200],['number',40],['city',160],['neighborhood',160]] as const)if(!string(a[field])||string(a[field]).length>max)return{ok:false,code:'DELIVERY_ADDRESS_INVALID',retryable:false}
  const quoted=await executeInformationTool('get_delivery_quote',{city:string(a.city),neighborhood:string(a.neighborhood)},ctx,db)
  if(!quoted.ok)return quoted
  const data=quoted.data as Record<string,unknown>
  return{ok:true,data:{street:string(a.street),number:string(a.number),city:String(data.city),neighborhood:String(data.neighborhood),reference:string(a.reference)||null,complement:string(a.complement)||null,postal_code:string(a.postal_code)||null,fee_cents:Number(data.fee_cents),coverage_snapshot_json:String(data.coverage_snapshot_json)}}
}
