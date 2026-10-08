import { Agent } from 'agents'
import { executeInternalChatTurn } from '../internalChatApi'

// The Durable Object may receive another request while the current request
// awaits Groq or D1. Serialize turns so retries and simultaneous messages
// cannot interleave D1 history reads and generation within one chat thread.
export function serializeAgentTurns<RequestType, ResultType>(
  execute: (request: RequestType) => Promise<ResultType>,
): (request: RequestType) => Promise<ResultType> {
  let settled: Promise<void> = Promise.resolve()
  return (request) => {
    const current = settled.then(() => execute(request))
    // A failed request must not permanently block the next turn.
    settled = current.then(() => undefined, () => undefined)
    return current
  }
}

// The authenticated Worker alone reaches this private instance. Its name
// contains the tenant, module and thread; the D1 scope is re-authorized
// inside executeInternalChatTurn. No public Agent route or WhatsApp calls.
export class LunaNativeAgent extends Agent<EdgeEnv> {
  private readonly runTurn = serializeAgentTurns(async (request: Request): Promise<Response> => {
    const result = await executeInternalChatTurn(request, this.env)
    return result ?? Response.json({ code: 'NOT_FOUND' }, { status: 404 })
  })

  onRequest(request: Request): Promise<Response> {
    return this.runTurn(request)
  }
}
