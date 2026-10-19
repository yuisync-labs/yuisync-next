import { authorizeOperation } from './operationAuthorization'
import { getBetterAuthSession, type BetterAuthRuntimeBindings } from './auth/betterAuthRuntime'
import type { LunaNativeAgent } from './luna/nativeCloudflareAgent'
import type { LunaThinkAgent } from './luna/thinkAgent'
import { THINK_MODEL } from './luna/thinkPolicy'
import { getAgentByName } from 'agents'
import type { InternalChatJob } from './luna/internalChatTurn'
import { lunaProviderConfigured, lunaProviderIdentity, type LunaProviderBindings } from './luna/providers/providerFactory'

type Bindings = BetterAuthRuntimeBindings & LunaProviderBindings & {
  DB?: D1Database; APP_ENV?: string; LUNA_INTERNAL_CHAT_ENABLED?: string;
  GROQ_API_KEY?: string; LUNA_MODEL?: string; RELEASE_SHA?: string;
  LUNA_NATIVE?: DurableObjectNamespace<LunaNativeAgent>
  LUNA_THINK?: DurableObjectNamespace<LunaThinkAgent>; LUNA_RUNTIME?: string; LUNA_THINK_TENANT_IDS?:string
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
  const resume=url.pathname==='/api/chat/automation/resume'
  if (url.pathname !== '/api/chat/respond' && !statusMatch&&!resume) return null
  if (request.method !== (statusMatch ? 'GET' : 'POST')) return json({code: 'METHOD_NOT_ALLOWED'}, 405)
  const think = ['local','staging'].includes(env.APP_ENV??'') && env.LUNA_RUNTIME === 'think'
  if(resume&&!think)return json({code:'NOT_FOUND'},404)
  if ((!think && env.APP_ENV !== 'staging') || env.LUNA_INTERNAL_CHAT_ENABLED !== 'true') return json({code: 'LUNA_INTERNAL_CHAT_DISABLED'}, 404)
  const auth = await authorizeOperation(request, env, 'operational')
  if (auth) return auth
  const namespace = think ? env.LUNA_THINK : env.LUNA_NATIVE
  if (!namespace) return json({code: 'LUNA_NATIVE_AGENT_NOT_CONFIGURED'}, 503)
  const tenantId = request.headers.get('x-tenant-id')!, moduleId = request.headers.get('x-module-id')!
  if(think&&env.APP_ENV==='staging'&&!String(env.LUNA_THINK_TENANT_IDS??'').split(',').includes(tenantId))return json({code:'LUNA_STAGING_TENANT_DISABLED'},403)
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
  if (!identifier(sessionId) || (!statusMatch&&!resume && (!identifier(body.clientMessageId) || !message || message.length > 4000))) return json({code: 'INVALID_CHAT_REQUEST'}, 400)
  const thread = await env.DB!.prepare(`SELECT status,channel,external_thread_id FROM chat_threads WHERE tenant_id=?1 AND module_id=?2 AND id=?3 LIMIT 1`).bind(tenantId, moduleId, sessionId).first<{status: string; channel: string; external_thread_id: string}>()
  if (!thread) return json({code: 'CHAT_NOT_FOUND'}, 404)
  if(resume){
    if(thread.channel!=='internal')return json({code:'NOT_FOUND'},404)
    const session=await getBetterAuthSession(request,env),subject=session?.user.id
    const principal=subject?await env.DB!.prepare("SELECT id FROM identity_principals WHERE provider='better-auth' AND subject=? AND status='active'").bind(subject).first<{id:string}>():null
    if(!principal)return json({code:'UNAUTHENTICATED'},401)
    const conversation=await env.DB!.prepare("SELECT status FROM luna_conversations WHERE tenant_id=? AND module_id=? AND conversation_id=?").bind(tenantId,moduleId,sessionId).first<{status:string}>()
    if(thread.status==='open'&&conversation?.status!=='handoff')return json({resumed:true,idempotent:true})
    if(thread.status!=='handoff'&&!(thread.status==='open'&&conversation?.status==='handoff'))return json({code:'CHAT_NOT_IN_HUMAN_MODE'},409)
    const now=Date.now()
    await env.DB!.batch([
      env.DB!.prepare("UPDATE chat_threads SET status='open',assigned_staff_key=NULL,updated_at_ms=?,context_json=json_set(context_json,'$.think.resumed_by',?,'$.think.resumed_at_ms',?) WHERE tenant_id=? AND module_id=? AND id=? AND status IN ('handoff','open')").bind(now,principal.id,now,tenantId,moduleId,sessionId),
      env.DB!.prepare("UPDATE luna_conversations SET status='active',state_json=json_remove(state_json,'$.handoff_reason'),version=version+1,updated_at_ms=? WHERE tenant_id=? AND module_id=? AND conversation_id=? AND status='handoff' AND EXISTS(SELECT 1 FROM chat_threads WHERE tenant_id=? AND module_id=? AND id=? AND status='open' AND json_extract(context_json,'$.think.resumed_by')=?)").bind(now,tenantId,moduleId,sessionId,tenantId,moduleId,sessionId,principal.id),
    ])
    return json({resumed:true})
  }
  const instance = think ? await getAgentByName(env.LUNA_THINK!,`${tenantId}:${moduleId}:${sessionId}`) : namespace.get(namespace.idFromName(`${tenantId}:${moduleId}:${sessionId}`))
  if (statusMatch) return instance.fetch(new Request(`https://luna.internal/turns/${statusMatch[1]}`))
  if ((thread.status !== 'open' && !(think && thread.status === 'closed')) || thread.channel !== 'internal') return json({code: 'CHAT_NOT_IN_BOT_MODE'}, 409)
  const phone = (thread.external_thread_id ?? '').replace(/\D/g, '')
  if (!/^\d{8,15}$/.test(phone)) return json({code: 'CHAT_CUSTOMER_PHONE_REQUIRED'}, 409)
  if (think ? !env.AI : !lunaProviderConfigured(env)) return json({code: 'LUNA_PROVIDER_NOT_CONFIGURED'}, 503)
  const session = await getBetterAuthSession(request, env)
  const principal = session?.user.id ? await env.DB!.prepare(`SELECT id FROM identity_principals WHERE provider='better-auth' AND subject=?1 AND status='active' LIMIT 1`).bind(session.user.id).first<{id: string}>() : null
  if (!principal) return json({code: 'UNAUTHENTICATED'}, 401)
  const job: InternalChatJob = {
    kind: 'internal-chat', principalId: principal.id, message, releaseSha: env.RELEASE_SHA ?? 'local', ...(think ? {model:THINK_MODEL,provider:'workers-ai'} : lunaProviderIdentity(env)),
    context: {tenantId, moduleId: 'petshop', conversationId: sessionId, customerAddress: phone,
      phoneNumberId: 'internal-no-whatsapp', sourceMessageId: body.clientMessageId as string,
      traceId: `internal:${body.clientMessageId}`, executionMode: 'staging'},
  }
  return instance.fetch(new Request('https://luna.internal/submit', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(job)}))
}
