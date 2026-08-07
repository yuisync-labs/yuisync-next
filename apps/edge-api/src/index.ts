import app from './app'
import { handleAppApiRequest } from './appApi'
import { handleBetterAuthRequest } from './auth/betterAuthRuntime'
import { handleAsyncQueue } from './queueHandler'
import type { EdgeAppEnvironment } from './types'

export { CoordinationDurableObject } from './coordination/coordinationDurableObject'

export default {
  async fetch(request: Request, env: EdgeEnv, context: ExecutionContext): Promise<Response> {
    const bindings = env as EdgeAppEnvironment['Bindings']

    const authResponse = await handleBetterAuthRequest(request, bindings)
    if (authResponse) return authResponse

    const appApiResponse = await handleAppApiRequest(request, bindings)
    if (appApiResponse) return appApiResponse

    return app.fetch(request, env, context)
  },
  queue: handleAsyncQueue,
}
