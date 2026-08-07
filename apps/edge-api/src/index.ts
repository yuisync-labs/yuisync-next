import app from './app'
import { handleAppApiRequest } from './appApi'
import { handleBetterAuthRequest } from './auth/betterAuthRuntime'
import { handleAuthMigrationRequest } from './migration/authMigrationHttp'
import { handleClientsPetsMigrationRequest } from './migration/clientsPetsMigrationHttp'
import { handleOperationalMigrationRequest } from './migration/operationalMigrationHttp'
import { handleAsyncQueue } from './queueHandler'
import type { EdgeAppEnvironment } from './types'

export { CoordinationDurableObject } from './coordination/coordinationDurableObject'

export default {
  async fetch(request: Request, env: EdgeEnv, context: ExecutionContext): Promise<Response> {
    const bindings = env as EdgeAppEnvironment['Bindings']

    const authMigrationResponse = await handleAuthMigrationRequest(request, bindings)
    if (authMigrationResponse) return authMigrationResponse

    const clientsPetsMigrationResponse = await handleClientsPetsMigrationRequest(request, bindings)
    if (clientsPetsMigrationResponse) return clientsPetsMigrationResponse

    const operationalMigrationResponse = await handleOperationalMigrationRequest(request, bindings)
    if (operationalMigrationResponse) return operationalMigrationResponse

    const authResponse = await handleBetterAuthRequest(request, bindings)
    if (authResponse) return authResponse

    const appApiResponse = await handleAppApiRequest(request, bindings)
    if (appApiResponse) return appApiResponse

    return app.fetch(request, env, context)
  },
  queue: handleAsyncQueue,
}
