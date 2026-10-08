import { authorizeOperation } from './operationAuthorization'
import { getBetterAuthSession, type BetterAuthRuntimeBindings } from './auth/betterAuthRuntime'
import type { LunaNativeAgent } from './luna/nativeCloudflareAgent'
import type { InternalChatJob } from './luna/internalChatTurn'

type Bindings = BetterAuthRuntimeBindings & {
  DB?: D1Database; APP_ENV?: string; LUNA_INTERNAL_CHAT_ENABLED?: string;
  GROQ_API_KEY?: string; LUNA_MODEL?: string; RELEASE_SHA?: string;
  LUNA_NATIVE?: DurableObjectNamespace<LunaNativeAgent>
}
const identifier = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(value)
const json = (body: unknown, status = 200) => Response.json(body, {status, headers: {'cache-control': 'no-store'}})

// Keep this exported read contract until its existing consumers are migrated.
export async function searchInternalChatProducts(db: D1Database, tenantId: string, moduleId: string, query: string) {
  const rows = await db.prepare(`SELECT p.id,p.name,p.price_cents,
    MAX(0, COALESCE(i.on_hand_milliunits,0) - COALESCE(i.reserved_milliunits,0)) AS stock_milliunits
    FROM catalog_products p LEFT JOIN inventory_balances i
      ON i.tenant_id=p.tenant_id AND i.module_id=p.module_id AND i.product_id=p.id
    WHERE p.tenant_id=?1 AND p.module_id=?2 AND p.status='active'
      AND LOWER(p.name) LIKE ?3 ORDER BY p.name LIMIT 8`)
    .bind(tenantId, moduleId, `%${query.toLowerCase()}%`).all<{id: string; name: string; price_cents: number; stock_milliunits: number}>()
  return rows.results.map(row => ({id: row.id, name: row.name, price_reais: row.price_cents / 100, stock_quantity: row.stock_milliunits / 1000}))
}

// Both endpoints authenticate; only submission schedules work. No public Agent
// routing, raw LLM response, or WhatsApp provider is exposed here.
export async function handleInternalChatApiRequest(request: Request, env: Bindings): Promise<Response | null> {
  const url = new URL(request.url), statusMatch = /^\/api\/chat\/turns\/(latest|[a-f0-9]{64})$/.exec(url.pathname)
  if (url.pathname !== '/api/chat/respond' && !statusMatch) return null
  if (request.method !== (statusMatch ? 'GET' : 'POST')) return json({code: 'METHOD_NOT_ALLOWED'}, 405)
  if (env.APP_ENV !== 'staging' || env.LUNA_INTERNAL_CHAT_ENABLED !== 'true') return json({code: 'LUNA_INTERNAL_CHAT_DISABLED'}, 404)
  const auth = await authorizeOperation(request, env, 'operational')
  if (auth) return auth
  if (!env.LUNA_NATIVE) return json({code: 'LUNA_NATIVE_AGENT_NOT_CONFIGURED'}, 503)
  const tenantId = request.headers.get('x-tenant-id')!, moduleId = request.headers.get('x-module-id')!
  let body: Record<string, unknown> = {}
  if (!statusMatch) {
    try {
      const input = await request.json()
      if (!input || typeof input !== 'object' || Array.isArray(input)) return json({code: 'INVALID_JSON'}, 400)
      body = input as Record<string, unknown>
    } catch { return json({code: 'INVALID_JSON'}, 400) }
  }
  const sessionId = statusMatch ? url.searchParams.get('sessionId') : body.sessionId
  const message = typeof body.message === 'string' ? body.message.trim() : ''
  // Stable IDs are mandatory: a network retry cannot create another turn.
  if (!identifier(sessionId) || (!statusMatch && (!identifier(body.clientMessageId) || !message || message.length > 4000))) return json({code: 'INVALID_CHAT_REQUEST'}, 400)
  const thread = await env.DB!.prepare(`SELECT status,channel,external_thread_id FROM chat_threads WHERE tenant_id=?1 AND module_id=?2 AND id=?3 LIMIT 1`).bind(tenantId, moduleId, sessionId).first<{status: string; channel: string; external_thread_id: string}>()
  if (!thread) return json({code: 'CHAT_NOT_FOUND'}, 404)
  const instance = env.LUNA_NATIVE.get(env.LUNA_NATIVE.idFromName(`${tenantId}:${moduleId}:${sessionId}`))
  if (statusMatch) return instance.fetch(new Request(`https://luna.internal/turns/${statusMatch[1]}`))
  if (thread.status !== 'open' || thread.channel !== 'internal') return json({code: 'CHAT_NOT_IN_BOT_MODE'}, 409)
  const phone = (thread.external_thread_id ?? '').replace(/\D/g, '')
  if (!/^\d{8,15}$/.test(phone)) return json({code: 'CHAT_CUSTOMER_PHONE_REQUIRED'}, 409)
  if (!env.GROQ_API_KEY || !env.LUNA_MODEL) return json({code: 'LUNA_PROVIDER_NOT_CONFIGURED'}, 503)
  const session = await getBetterAuthSession(request, env)
  const principal = session?.user.id ? await env.DB!.prepare(`SELECT id FROM identity_principals WHERE provider='better-auth' AND subject=?1 AND status='active' LIMIT 1`).bind(session.user.id).first<{id: string}>() : null
  if (!principal) return json({code: 'UNAUTHENTICATED'}, 401)
  const job: InternalChatJob = {
    kind: 'internal-chat', principalId: principal.id, message, releaseSha: env.RELEASE_SHA ?? 'local', model: env.LUNA_MODEL,
    context: {tenantId, moduleId: 'petshop', conversationId: sessionId, customerAddress: phone,
      phoneNumberId: 'internal-no-whatsapp', sourceMessageId: body.clientMessageId as string,
      traceId: `internal:${body.clientMessageId}`, executionMode: 'staging'},
  }
  return instance.fetch(new Request('https://luna.internal/submit', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(job)}))
}
