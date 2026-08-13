import type { CompatRuntimeBindings } from './compatApiRuntime.js'
import { getBetterAuthSession } from './auth/betterAuthRuntime'
import { hasExplicitBillingIntent } from './subscriptionBenefitLedger'
import { asObject, asText } from './appointmentBillingPolicy'
import { resolveBillingBookingContext } from './appointmentBillingBookingContext'
import { executeBillingBooking } from './appointmentBillingBookingExecute'
import { resolveBillingUpdateContext } from './appointmentBillingUpdateContext'
import { executeBillingUpdate } from './appointmentBillingUpdateExecute'
export async function handleAppointmentBillingRoute(request:Request,env:CompatRuntimeBindings){
 const url=new URL(request.url);if(url.pathname!=='/api/compat/rpc'||request.method!=='POST')return null
 let body:Record<string,unknown>;try{body=asObject(await request.clone().json())}catch{return null}
 const name=asText(body.name);if(!['book_petshop_appointment_transaction','update_petshop_appointment_transaction'].includes(name))return null
 const args=asObject(body.args),payload=asObject(args.p_payload)
 if(!hasExplicitBillingIntent(payload)){const session=await getBetterAuthSession(request,env);if(!session?.user?.id)return null}
 if(name==='book_petshop_appointment_transaction'){
  const context=await resolveBillingBookingContext(request,env,payload);if('error'in context)return context.error||null
  return executeBillingBooking(env,payload,context)
 }
 const appointmentId=asText(args.p_appointment_id);if(!appointmentId)return Response.json({code:'APPOINTMENT_ID_REQUIRED'},{status:400})
 const context=await resolveBillingUpdateContext(request,env,appointmentId,payload);if('error'in context)return context.error||null;if('passthrough'in context)return null
 return executeBillingUpdate(env,payload,context)
}
