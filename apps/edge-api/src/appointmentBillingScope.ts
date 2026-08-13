import { getBetterAuthSession } from './auth/betterAuthRuntime'
import type { CompatRuntimeBindings } from './compatApiRuntime.js'
import { asText } from './appointmentBillingPolicy'

type PetRow={client_id:string;species:string;weight_kg:number|null;status:string}
export async function resolveBillingParty(request:Request,env:CompatRuntimeBindings,payload:Record<string,unknown>){
 if(!env.DB)return{error:Response.json({code:'DATABASE_NOT_CONFIGURED'},{status:503})}
 const tenantId=asText(request.headers.get('x-tenant-id')),moduleId=asText(request.headers.get('x-module-id')).toLowerCase(),petId=asText(payload.pet_id)
 if(!tenantId||!moduleId||!petId)return{error:Response.json({code:'APPOINTMENT_PARTY_REQUIRED'},{status:400})}
 const session=await getBetterAuthSession(request,env),userId=asText(session?.user?.id)
 if(!userId)return{error:Response.json({code:'UNAUTHENTICATED'},{status:401})}
 const principal=await env.DB.prepare("SELECT id FROM identity_principals WHERE provider='better-auth' AND subject=?1 AND status='active' LIMIT 1").bind(userId).first<{id:string}>()
 if(!principal?.id)return{error:Response.json({code:'FORBIDDEN'},{status:403})}
 const membership=await env.DB.prepare("SELECT role,module_permissions_json FROM tenant_memberships WHERE tenant_id=?1 AND principal_id=?2 AND status='active' LIMIT 1").bind(tenantId,principal.id).first<{role:string;module_permissions_json:string|null}>()
 if(!membership)return{error:Response.json({code:'FORBIDDEN'},{status:403})}
 const pet=await env.DB.prepare('SELECT client_id,species,weight_kg,status FROM pets WHERE tenant_id=?1 AND module_id=?2 AND id=?3 LIMIT 1').bind(tenantId,moduleId,petId).first<PetRow>()
 if(!pet||pet.status!=='active')return{error:Response.json({code:'PET_NOT_FOUND'},{status:404})}
 const requested=asText(payload.client_id);if(requested&&requested!==pet.client_id)return{error:Response.json({code:'PET_CLIENT_MISMATCH'},{status:409})}
 return{tenantId,moduleId,petId,clientId:pet.client_id,species:pet.species,weightGrams:pet.weight_kg==null?null:Math.round(Number(pet.weight_kg)*1000)}
}
