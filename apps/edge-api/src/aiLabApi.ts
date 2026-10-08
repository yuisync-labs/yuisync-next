import { getBetterAuthSession, type BetterAuthRuntimeBindings } from './auth/betterAuthRuntime'
import type { LunaExecutionContext } from './luna/contracts'
import type { LunaConversationDurableObject } from './luna/conversationDurableObject'
import type { LunaPlaygroundJob } from './luna/playgroundTurn'
import { authorizeOperation } from './operationAuthorization'

type AiLabBindings = BetterAuthRuntimeBindings & {
  DB?: D1Database
  OPENAI_API_KEY?: string
  GROQ_API_KEY?: string
  LUNA_PROVIDER?: string
  LUNA_MODEL?: string
  LUNA_PLAYGROUND_ENABLED?: string
  LUNA_MAX_MODEL_CALLS_PER_TURN?: string
  LUNA_MAX_TOOL_CALLS_PER_TURN?: string
  LUNA_MAX_TOKENS_PER_TURN?: string
  LUNA_AGENT?:DurableObjectNamespace<LunaConversationDurableObject>
  RELEASE_SHA?:string
}
type CompanyRow = {
  id: string; tenant_id: string; module_id: string; niche_id: string; name: string; system_prompt: string;
  bot_name: string; temperature_milli: number; model_name: string;
}
type Scope = { tenantId: string; moduleId: string; principalId: string }

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { 'cache-control': 'no-store' } })
}
function id(value: unknown): string | null {
  const normalized = String(value ?? '').trim()
  return /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(normalized) ? normalized : null
}
function moduleId(value: unknown): string | null {
  const normalized = String(value ?? '').trim().toLowerCase()
  return /^[a-z0-9][a-z0-9_-]{0,63}$/.test(normalized) ? normalized : null
}
function positive(value: unknown, fallback: number): number {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

async function resolveScope(request: Request, bindings: AiLabBindings,administrative=false): Promise<{ scope?: Scope; error?: Response }> {
  if (!bindings.DB) return { error: json({ code: 'DATABASE_NOT_CONFIGURED' }, 503) }
  const tenantId = id(request.headers.get('x-tenant-id'))
  const activeModule = moduleId(request.headers.get('x-module-id'))
  if (!tenantId || !activeModule) return { error: json({ code: 'INVALID_SCOPE' }, 400) }
  if(administrative){const error=await authorizeOperation(request,bindings,'administrative');if(error)return{error}}
  const session = await getBetterAuthSession(request, bindings)
  const userId = id(session?.user?.id)
  if (!userId) return { error: json({ code: 'UNAUTHENTICATED' }, 401) }
  const principal = await bindings.DB.prepare("SELECT id FROM identity_principals WHERE provider='better-auth' AND subject=?1 AND status='active' LIMIT 1")
    .bind(userId).first<{ id: string }>()
  if (!principal) return { error: json({ code: 'FORBIDDEN' }, 403) }
  if(administrative)return{scope:{tenantId,moduleId:activeModule,principalId:principal.id}}
  const membership = await bindings.DB.prepare("SELECT role,module_permissions_json FROM tenant_memberships WHERE tenant_id=?1 AND principal_id=?2 AND status='active' LIMIT 1")
    .bind(tenantId, principal.id).first<{ role: string; module_permissions_json: string }>()
  if (!membership) return { error: json({ code: 'FORBIDDEN' }, 403) }
  let allowed = membership.role === 'owner' || membership.role === 'admin'
  try {
    const permissions = JSON.parse(membership.module_permissions_json || '{}') as Record<string, unknown>
    allowed ||= permissions['*'] === true || permissions[activeModule] === true || Boolean(permissions[activeModule] && typeof permissions[activeModule] === 'object')
  } catch { /* deny malformed non-admin membership */ }
  if (!allowed) return { error: json({ code: 'FORBIDDEN' }, 403) }
  return { scope: { tenantId, moduleId: activeModule, principalId: principal.id } }
}

async function playground(request: Request, bindings: AiLabBindings): Promise<Response> {
  const resolved = await resolveScope(request, bindings)
  if (!resolved.scope) return resolved.error || json({ code: 'FORBIDDEN' }, 403)
  if (!bindings.OPENAI_API_KEY) return json({ code: 'OPENAI_NOT_CONFIGURED' }, 503)
  let body: { company_id?: unknown; customer_phone?: unknown; message?: unknown }
  try { body = await request.json() as typeof body } catch { return json({ code: 'INVALID_JSON' }, 400) }
  const companyId = id(body.company_id)
  const message = String(body.message ?? '').trim()
  const phone = String(body.customer_phone ?? '').trim().slice(0, 80)
  if (!companyId || !message || message.length > 4000) return json({ code: 'INVALID_PLAYGROUND_REQUEST' }, 400)

  const company = await bindings.DB!.prepare(`SELECT * FROM ai_companies WHERE tenant_id=?1 AND module_id=?2 AND id=?3 AND status='active' LIMIT 1`)
    .bind(resolved.scope.tenantId, resolved.scope.moduleId, companyId).first<CompanyRow>()
  if (!company) return json({ code: 'COMPANY_NOT_FOUND' }, 404)

  const niche = await bindings.DB!.prepare(`SELECT base_prompt FROM ai_niches WHERE id=?1 LIMIT 1`).bind(company.niche_id).first<{ base_prompt: string }>()
  const versions = await bindings.DB!.prepare(`SELECT layer,content,version FROM ai_prompt_versions WHERE tenant_id=?1 AND module_id=?2 AND company_id=?3 AND is_active=1 ORDER BY layer,version DESC`)
    .bind(resolved.scope.tenantId, resolved.scope.moduleId, companyId).all<{ layer: string; content: string; version: number }>()
  const latest = new Map<string, string>()
  for (const row of versions.results) if (!latest.has(row.layer)) latest.set(row.layer, row.content)
  const docs = await bindings.DB!.prepare(`SELECT title,content_text FROM ai_training_documents WHERE tenant_id=?1 AND module_id=?2 AND company_id=?3 AND status='active' AND content_text IS NOT NULL ORDER BY updated_at_ms DESC LIMIT 8`)
    .bind(resolved.scope.tenantId, resolved.scope.moduleId, companyId).all<{ title: string; content_text: string }>()
  const rag = docs.results.map((doc) => `### ${doc.title}\n${String(doc.content_text || '').slice(0, 4000)}`).join('\n\n').slice(0, 18000)
  const prompt = [
    latest.get('core') || 'Voce e um assistente profissional do YuiSync.',
    latest.get('niche') || niche?.base_prompt || '',
    latest.get('company') || company.system_prompt || '',
    rag ? `CONHECIMENTO DE APOIO:\n${rag}` : '',
    'Este e o playground administrativo. Nao execute efeitos externos, pagamentos ou agendamentos reais. Responda como o bot responderia ao cliente.',
  ].filter(Boolean).join('\n\n')

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 30_000)
  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${bindings.OPENAI_API_KEY}` },
      body: JSON.stringify({
        model: company.model_name || 'gpt-4o-mini',
        temperature: Math.max(0, Math.min(2, Number(company.temperature_milli || 500) / 1000)),
        messages: [{ role: 'system', content: prompt }, { role: 'user', content: message }],
      }),
      signal: controller.signal,
    })
    if (!response.ok) {
      console.error('ai_lab.openai.failed', { status: response.status })
      return json({ code: 'AI_PROVIDER_UNAVAILABLE' }, 503)
    }
    const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }> }
    const reply = String(payload.choices?.[0]?.message?.content || '').trim() || 'Sem resposta do modelo.'
    const runId = crypto.randomUUID()
    const now = Date.now()
    await bindings.DB!.prepare(`INSERT INTO ai_playground_runs(tenant_id,module_id,id,company_id,created_by,customer_phone,input_message,parsed_intent_json,action,reply,raw_response_json,created_at_ms) VALUES(?1,?2,?3,?4,?5,?6,?7,'{}','preview',?8,?9,?10)`)
      .bind(resolved.scope.tenantId, resolved.scope.moduleId, runId, companyId, resolved.scope.principalId, phone || 'playground', message, reply, JSON.stringify({ model: company.model_name || 'gpt-4o-mini' }), now).run()
    return json({ data: { id: runId, action: 'preview', reply, intent: null, created_at: new Date(now).toISOString() } })
  } catch (error) {
    console.error('ai_lab.playground.failed', { code: error instanceof Error ? error.name : 'unknown' })
    return json({ code: 'AI_PROVIDER_UNAVAILABLE' }, 503)
  } finally {
    clearTimeout(timeout)
  }
}

async function lunaPlayground(request: Request, bindings: AiLabBindings): Promise<Response> {
  const resolved = await resolveScope(request, bindings,true)
  if (!resolved.scope) return resolved.error || json({ code: 'FORBIDDEN' }, 403)
  if (resolved.scope.moduleId !== 'petshop') return json({ code: 'LUNA_MODULE_NOT_SUPPORTED' }, 400)
  if (bindings.LUNA_PLAYGROUND_ENABLED !== 'true') return json({ code: 'LUNA_PLAYGROUND_DISABLED' }, 404)
  if (bindings.LUNA_PROVIDER !== 'groq' || !bindings.GROQ_API_KEY || !bindings.LUNA_MODEL) {
    return json({ code: 'LUNA_PROVIDER_NOT_CONFIGURED' }, 503)
  }
  if(!bindings.LUNA_AGENT)return json({code:'LUNA_AGENT_NOT_CONFIGURED'},503)
  let body: { company_id?: unknown; customer_phone?: unknown; message?: unknown;idempotency_key?:unknown }
  try { body = await request.json() as typeof body } catch { return json({ code: 'INVALID_JSON' }, 400) }
  const companyId = id(body.company_id)
  const message = String(body.message ?? '').trim()
  const phone = String(body.customer_phone ?? '').replace(/\D/g, '').slice(0, 20)
  if (!companyId || phone.length < 8 || !message || message.length > 4000) return json({ code: 'INVALID_PLAYGROUND_REQUEST' }, 400)
  const company = await bindings.DB!.prepare(`
    SELECT id FROM ai_companies WHERE tenant_id=?1 AND module_id=?2 AND id=?3 AND status='active' LIMIT 1
  `).bind(resolved.scope.tenantId, resolved.scope.moduleId, companyId).first<{ id: string }>()
  if (!company) return json({ code: 'COMPANY_NOT_FOUND' }, 404)

  const key=String(body.idempotency_key??'')
  if(!/^[0-9a-f-]{36}$/.test(key))return json({code:'IDEMPOTENCY_KEY_REQUIRED'},400)
  const conversationId = `luna-playground:${resolved.scope.principalId}:${phone}`
  const sourceMessageId = `luna-playground:${key}`
  const traceId = key
  const context: LunaExecutionContext = {
    tenantId: resolved.scope.tenantId,
    moduleId: 'petshop',
    conversationId,
    sourceMessageId,
    customerAddress: phone,
    phoneNumberId: 'luna-playground',
    traceId,
    executionMode: 'staging',
  }
  const payload:LunaPlaygroundJob={kind:'playground',context,companyId,principalId:resolved.scope.principalId,message,releaseSha:bindings.RELEASE_SHA??'local'}
  const stub=bindings.LUNA_AGENT.getByName(`${context.tenantId}:petshop:${conversationId}`)
  const response=await stub.fetch('https://luna.internal/playground',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)})
  return json({data:await response.json()},response.status)
}

async function lunaPlaygroundStatus(request:Request,bindings:AiLabBindings){
 const resolved=await resolveScope(request,bindings,true)
 if(!resolved.scope)return resolved.error!
 if(bindings.LUNA_PLAYGROUND_ENABLED!=='true')return json({code:'LUNA_PLAYGROUND_DISABLED'},404)
 if(!bindings.LUNA_AGENT)return json({code:'LUNA_AGENT_NOT_CONFIGURED'},503)
 const url=new URL(request.url),phone=(url.searchParams.get('customer_phone')??'').replace(/\D/g,'').slice(0,20),turn=url.searchParams.get('turn_id')??'latest'
 if(phone.length<8||!/^(?:[a-f0-9]{64}|latest)$/.test(turn))return json({code:'INVALID_PLAYGROUND_REQUEST'},400)
 const stub=bindings.LUNA_AGENT.getByName(`${resolved.scope.tenantId}:petshop:luna-playground:${resolved.scope.principalId}:${phone}`)
 return stub.fetch(`https://luna.internal/turns/${turn}`)
}

export async function handleAiLabApiRequest(request: Request, bindings: AiLabBindings): Promise<Response | null> {
  const pathname = new URL(request.url).pathname
  if (pathname === '/api/ai-lab/luna/playground' && request.method === 'POST') return lunaPlayground(request, bindings)
  if (pathname === '/api/ai-lab/luna/playground/status' && request.method === 'GET') return lunaPlaygroundStatus(request, bindings)
  if (pathname === '/api/ai-lab/playground' && request.method === 'POST') return playground(request, bindings)
  if (pathname.startsWith('/api/ai-lab/')) return json({ code: 'NOT_FOUND' }, 404)
  return null
}
