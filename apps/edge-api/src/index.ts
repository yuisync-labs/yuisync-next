import app from './app'
import { handleAsyncQueue } from './queueHandler'

export { CoordinationDurableObject } from './coordination/coordinationDurableObject'

export default {
  async fetch(request: Request, env: EdgeEnv, context: ExecutionContext): Promise<Response> {
    return app.fetch(request, env, context)
  },
  queue: handleAsyncQueue,
}
