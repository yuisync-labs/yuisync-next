import app from './app'
import { handleAiLabApiRequest } from './aiLabApi'
import { handleAppApiRequest } from './appApi'
import { handleBetterAuthRequest } from './auth/betterAuthRuntime'
import { handleCompatApiRequest } from './compatApi'
import { handleFinalReadiness } from './finalReadiness'
import { handleAuthMigrationRequest } from './migration/authMigrationHttp'
import { handleClientsPetsMigrationRequest } from './migration/clientsPetsMigrationHttp'
import { handleOperationalMigrationRequest } from './migration/operationalMigrationHttp'
import { handleAsyncQueue } from './queueHandler'
import type { EdgeAppEnvironment } from './types'

export { CoordinationDurableObject } from './coordination/coordinationDurableObject'

export default {
  async fetch(request: Request, env: EdgeEnv, context: ExecutionContext): Promise<Response> {
    const bindings = env as EdgeAppEnvironment['Bindings']

    const readinessResponse = await handleFinalReadiness(request, bindings)
    if (readinessResponse) return readinessResponse

    const authMigrationResponse = await handleAuthMigrationRequest(request, bindings)
    if (authMigrationResponse) return authMigrationResponse

    const clientsPetsMigrationResponse = await handleClientsPetsMigrationRequest(request, bindings)
    if (clientsPetsMigrationResponse) return clientsPetsMigrationResponse

    const operationalMigrationResponse = await handleOperationalMigrationRequest(request, bindings)
    if (operationalMigrationResponse) return operationalMigrationResponse

    const authResponse = await handleBetterAuthRequest(request, bindings)
    if (authResponse) return authResponse

    const aiLabResponse = await handleAiLabApiRequest(request, bindings)
    if (aiLabResponse) return aiLabResponse

    const compatResponse = await handleCompatApiRequest(request, bindings)
    if (compatResponse) return compatResponse

    const appApiResponse = await handleAppApiRequest(request, bindings)
    if (appApiResponse) return appApiResponse

    return app.fetch(request, env, context)
  },
  queue: handleAsyncQueue,
}
