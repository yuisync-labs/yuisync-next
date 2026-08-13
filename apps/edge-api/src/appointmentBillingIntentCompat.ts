import type { CompatRuntimeBindings } from './compatApiRuntime.js'
import { hasExplicitBillingIntent } from './subscriptionBenefitLedger'
import { asObject, asText } from './appointmentBillingPolicy'
import { resolveBillingBookingContext } from './appointmentBillingBookingContext'
import { executeBillingBooking } from './appointmentBillingBookingExecute'

export async function handleAppointmentBillingIntentCompat(request:Request,env:CompatRuntimeBindings):Promise<Response|null>{
 const url=new URL(request.url);if(url.pathname!=='/api/compat/rpc'||request.method!=='POST')return null
 let body:Record<string,unknown>;try{body=asObject(await request.clone().json())}catch{return null}
 if(asText(body.name)!=='book_petshop_appointment_transaction')return null
 const payload=asObject(asObject(body.args).p_payload);if(!hasExplicitBillingIntent(payload))return null
 const context=await resolveBillingBookingContext(request,env,payload);if('error'in context)return context.error
 return executeBillingBooking(env,payload,context)
}
