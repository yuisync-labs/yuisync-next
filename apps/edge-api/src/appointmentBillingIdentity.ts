import { asObject, asText, requestedServiceCodes, type JsonRecord } from './appointmentBillingPolicy'

async function sha256(value:string){const bytes=new TextEncoder().encode(value),digest=await crypto.subtle.digest('SHA-256',bytes);return[...new Uint8Array(digest)].map((b)=>b.toString(16).padStart(2,'0')).join('')}
export async function billingCommandIdentity(request:Request,payload:JsonRecord){
 const raw=asObject(payload.billing_intent)
 const allocations=(Array.isArray(raw.allocations)?raw.allocations:[]).map((v)=>{const x=asObject(v);return[asText(x.service_code||x.code),asText(x.subscription_id)]}).sort()
 const fingerprint=await sha256(JSON.stringify({tenant_id:asText(request.headers.get('x-tenant-id')),module_id:asText(request.headers.get('x-module-id')).toLowerCase(),client_id:asText(payload.client_id),pet_id:asText(payload.pet_id),scheduled_at:asText(payload.scheduled_at),services:requestedServiceCodes(payload).sort(),transport_mode:asText(payload.transport_mode),billing_type:asText(raw.type||payload.billing_intent_type),allocations}))
 const callerKey=asText(payload.idempotency_key||payload.operation_key)
 if(!callerKey)return{error:'IDEMPOTENCY_REQUIRED' as const}
 if(callerKey.length>512)return{error:'INVALID_IDEMPOTENCY_KEY' as const}
 const identityHash=await sha256(JSON.stringify({tenant_id:asText(request.headers.get('x-tenant-id')),module_id:asText(request.headers.get('x-module-id')).toLowerCase(),caller_key:callerKey}))
 return{fingerprint,operationKey:`appointment-booking:${identityHash}`,appointmentId:`${identityHash.slice(0,8)}-${identityHash.slice(8,12)}-${identityHash.slice(12,16)}-${identityHash.slice(16,20)}-${identityHash.slice(20,32)}`}
}
