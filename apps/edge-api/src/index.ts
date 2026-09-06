import app from './app'
import { authorizePetshopRequest } from './operationAuthorization'
import { resolveRequestId, requestRouteFamily } from './requestContext'
import { emitEdgeLog } from './observability'
import { handleAdminMaintenanceRequest } from './adminMaintenance'
import { handleAiLabApiRequest } from './aiLabApi'
import { handleAppApiRequest } from './appApi'
import { handleBetterAuthRequest } from './auth/betterAuthRuntime'
import { handleAppointmentBillingIntentCompat } from './appointmentBillingIntentCompat'
import { handleAppointmentFinancialReopenApi } from './appointmentFinancialReopenApi'
import { handleAppointmentResponsibleAssignmentApi } from './appointmentResponsibleAssignmentApi'
import { handlePetshopAppointmentsApiRequest } from './petshopAppointmentsApi'
import { handlePetshopClientsApiRequest } from './petshopClientsApi'
import { handleCheckoutApiRequest } from './checkoutApi'
import { handleCompatApiRequest } from './compatApi'
import { handleFinalReadiness } from './finalReadiness'
import { handleFiscalApiRequest } from './fiscalApi'
import { handleInventoryAdjustmentRequest } from './inventoryAdjustment'
import { handleManagedUsersApiRequest } from './managedUsersApi'
import { handleAiLabMigrationRequest } from './migration/aiLabMigrationHttp'
import { handleAuthMigrationRequest } from './migration/authMigrationHttp'
import { handleClientsPetsMigrationRequest } from './migration/clientsPetsMigrationHttp'
import { handleOperationalMigrationRequest } from './migration/operationalMigrationHttp'
import { handlePetshopPlansApiRequest } from './petshopPlansApi'
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

async function dispatch(request: Request, env: EdgeEnv, context: ExecutionContext): Promise<Response> {
    const bindings = env as EdgeAppEnvironment['Bindings']
    const denied = await authorizePetshopRequest(request, bindings)
    if (denied) return denied
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

    const adminMaintenanceResponse = await handleAdminMaintenanceRequest(request, bindings)
    if (adminMaintenanceResponse) return respond(adminMaintenanceResponse)

    const inventoryAdjustmentResponse = await handleInventoryAdjustmentRequest(request, bindings)
    if (inventoryAdjustmentResponse) return respond(inventoryAdjustmentResponse)

    const petshopPlansResponse = await handlePetshopPlansApiRequest(request, bindings)
    if (petshopPlansResponse) return respond(petshopPlansResponse)

    const petshopServicesResponse = await handlePetshopServicesApiRequest(request, bindings)
    if (petshopServicesResponse) return respond(petshopServicesResponse)

    const financialReopenResponse = await handleAppointmentFinancialReopenApi(request, bindings)
    if (financialReopenResponse) return respond(financialReopenResponse)

    const responsibleAssignmentResponse = await handleAppointmentResponsibleAssignmentApi(request, bindings)
    if (responsibleAssignmentResponse) return respond(responsibleAssignmentResponse)

    const petshopAppointmentsResponse = await handlePetshopAppointmentsApiRequest(request, bindings)
    if (petshopAppointmentsResponse) return respond(petshopAppointmentsResponse)

    const petshopClientsResponse = await handlePetshopClientsApiRequest(request, bindings)
    if (petshopClientsResponse) return respond(petshopClientsResponse)

    const explicitBillingResponse = await handleAppointmentBillingIntentCompat(request, bindings)
    if (explicitBillingResponse) return respond(explicitBillingResponse)

    const compatResponse = await handleCompatApiRequest(request, bindings)
    if (compatResponse) return respond(compatResponse)

    const appApiResponse = await handleAppApiRequest(request, bindings)
    if (appApiResponse) return respond(appApiResponse)

    return respond(await app.fetch(request, env, context))
}

export default {
  async fetch(request: Request, env: EdgeEnv, context: ExecutionContext): Promise<Response> {
    const requestId = resolveRequestId(request.headers.get('x-request-id') || undefined)
    const started = Date.now()
    let response: Response
    try {
      const requestHeaders = new Headers(request.headers)
      requestHeaders.set('x-request-id', requestId)
      response = await dispatch(new Request(request, { headers: requestHeaders }), env, context)
    } catch {
      // Never log request bodies, cookies, query strings or database error messages.
      emitEdgeLog('error', 'edge.request.failed', { request_id: requestId })
      response = Response.json({ code: 'INTERNAL_ERROR', request_id: requestId }, { status: 500 })
    }
    const effectiveRequestId = response.headers.get('x-request-id') || requestId
    emitEdgeLog(response.status >= 500 ? 'error' : 'info', 'edge.response', {
      request_id: effectiveRequestId, method: request.method, status: response.status,
      route: requestRouteFamily(request.url),
      duration_ms: Date.now() - started, environment: String(env.APP_ENV),
    })
    // Preserve the Workers WebSocket upgrade response and its socket.
    if (response.status === 101) return response
    const headers = new Headers(response.headers)
    headers.set('x-request-id', effectiveRequestId)
    headers.set('x-content-type-options', 'nosniff')
    headers.set('referrer-policy', 'no-referrer')
    if (new URL(request.url).pathname.startsWith('/api/')) headers.set('cache-control', 'no-store')
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
  },
  queue: handleAsyncQueue,
}
