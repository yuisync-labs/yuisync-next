import { Agent } from 'agents'
import { executeInternalChatTurn } from '../internalChatApi'

// Cloudflare-native conversational agent per tenant and chat thread.
// Only the authenticated Worker routes internal requests here. The D1
// tenant scope remains server-verified by executeInternalChatTurn; no
// public Agent route is registered and no WhatsApp provider is called.
export class LunaNativeAgent extends Agent<EdgeEnv> {
  async onRequest(request: Request): Promise<Response> {
    const result = await executeInternalChatTurn(request, this.env)
    return result ?? Response.json({ code: 'NOT_FOUND' }, { status: 404 })
  }
}
