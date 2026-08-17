import app from './app'
import { handleAiLabApiRequest } from './aiLabApi'
import { handleAppApiRequest } from './appApi'
import { handleBetterAuthRequest } from './auth/betterAuthRuntime'
import { handleAppointmentBillingIntentCompat } from './appointmentBillingIntentCompat'
import { handleAppointmentFinancialReopenApi } from './appointmentFinancialReopenApi'
import { handleCheckoutApiRequest } from './checkoutApi'
import { handleCompatApiRequest } from './compatApi'
import { handleFinalReadiness } from './finalReadiness'
import { handleFiscalApiRequest } from './fiscalApi'
import { handleManagedUsersApiRequest } from './managedUsersApi'
import { handleAiLabMigrationRequest } from './migration/aiLabMigrationHttp'
import { handleAuthMigrationRequest } from './migration/authMigrationHttp'
import { handleClientsPetsMigrationRequest } from './migration/clientsPetsMigrationHttp'
import { handleOperationalMigrationRequest } from './migration/operationalMigrationHttp'
import { handlePetshopServicesApiRequest } from './petshopServicesApi'
import { handleAsyncQueue } from './queueHandler'
import { handleRealtimeApiRequest, scheduleRealtimeInvalidation } from './realtimeApi'
import type { EdgeAppEnvironment } from './types'
import { handleWhatsappApiRequest } from './whatsappApi'
import { handleWhatsappDeliveryStatusRequest } from './whatsappDeliveryStatusApi'
import { handleWhatsappOnboardingApiRequest } from './whatsappOnboardingApi'
import { handleWhatsappUnifiedOutboundApiRequest } from './whatsappOutboundApi'
import { handleWhatsappTemplateApiRequest } from './whatsappTemplateApi'

export { CoordinationDurableObject } from './coordination/coordinationDurableObject'

export default {
  async fetch(request: Request, env: EdgeEnv, context: ExecutionContext): Promise<Response> {
    const bindings = env as EdgeAppEnvironment['Bindings']
    const mutationProbe: Request | null = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method)
      ? request.clone() as Request
      : null
    const respond = (response: Response): Response => {
      if (mutationProbe) scheduleRealtimeInvalidation(mutationProbe, response.clone(), bindings, context)
      return response
    }

    const readinessResponse = await handleFinalReadiness(request, bindings)
    if (readinessResponse) return respond(readinessResponse)

    const authMigrationResponse = await handleAuthMigrationRequest(request, bindings)
    if (authMigrationResponse) return respond(authMigrationResponse)

    const clientsPetsMigrationResponse = await handleClientsPetsMigrationRequest(request, bindings)
    if (clientsPetsMigrationResponse) return respond(clientsPetsMigrationResponse)

    const aiLabMigrationResponse = await handleAiLabMigrationRequest(request, bindings)
    if (aiLabMigrationResponse) return respond(aiLabMigrationResponse)

    const operationalMigrationResponse = await handleOperationalMigrationRequest(request, bindings)
    if (operationalMigrationResponse) return respond(operationalMigrationResponse)

    const realtimeResponse = await handleRealtimeApiRequest(request, bindings)
    if (realtimeResponse) return realtimeResponse

    const whatsappUnifiedOutboundResponse = await handleWhatsappUnifiedOutboundApiRequest(request, bindings)
    if (whatsappUnifiedOutboundResponse) return respond(whatsappUnifiedOutboundResponse)

    const whatsappStatusResponse = await handleWhatsappDeliveryStatusRequest(request.clone() as Request, bindings)
    if (whatsappStatusResponse) return respond(whatsappStatusResponse)

    const whatsappResponse = await handleWhatsappApiRequest(request, bindings)
    if (whatsappResponse) return respond(whatsappResponse)

    const whatsappOnboardingResponse = await handleWhatsappOnboardingApiRequest(request, bindings)
    if (whatsappOnboardingResponse) return respond(whatsappOnboardingResponse)

    const whatsappTemplateResponse = await handleWhatsappTemplateApiRequest(request, bindings)
    if (whatsappTemplateResponse) return respond(whatsappTemplateResponse)

    const authResponse = await handleBetterAuthRequest(request, bindings)
    if (authResponse) return respond(authResponse)

    const aiLabResponse = await handleAiLabApiRequest(request, bindings)
    if (aiLabResponse) return respond(aiLabResponse)

    const checkoutResponse = await handleCheckoutApiRequest(request, bindings)
    if (checkoutResponse) return respond(checkoutResponse)

    const fiscalResponse = await handleFiscalApiRequest(request, bindings)
    if (fiscalResponse) return respond(fiscalResponse)

    const managedUsersResponse = await handleManagedUsersApiRequest(request, bindings)
    if (managedUsersResponse) return respond(managedUsersResponse)

    const petshopServicesResponse = await handlePetshopServicesApiRequest(request, bindings)
    if (petshopServicesResponse) return respond(petshopServicesResponse)

    const financialReopenResponse = await handleAppointmentFinancialReopenApi(request, bindings)
    if (financialReopenResponse) return respond(financialReopenResponse)

    const explicitBillingResponse = await handleAppointmentBillingIntentCompat(request, bindings)
    if (explicitBillingResponse) return respond(explicitBillingResponse)

    const compatResponse = await handleCompatApiRequest(request, bindings)
    if (compatResponse) return respond(compatResponse)

    const appApiResponse = await handleAppApiRequest(request, bindings)
    if (appApiResponse) return respond(appApiResponse)

    return respond(await app.fetch(request, env, context))
  },
  queue: handleAsyncQueue,
}
