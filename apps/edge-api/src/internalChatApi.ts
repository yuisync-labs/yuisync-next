import { createGroq } from '@ai-sdk/groq'
import { generateText, isStepCount, tool } from 'ai'
import { z } from 'zod'
import { authorizeOperation } from './operationAuthorization'
import type { BetterAuthRuntimeBindings } from './auth/betterAuthRuntime'
import type { LunaNativeAgent } from './luna/nativeCloudflareAgent'

type Bindings = BetterAuthRuntimeBindings & {
  DB?: D1Database
  APP_ENV?: string
  LUNA_INTERNAL_CHAT_ENABLED?: string
  GROQ_API_KEY?: string
  LUNA_MODEL?: string
  LUNA_NATIVE?: DurableObjectNamespace<LunaNativeAgent>
}

type PersistedMessage = {
  id: string
  actor_type: string
  content_text: string
  created_at_ms: number
}

const identifier = (value: unknown): value is string =>
  typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(value)

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { 'cache-control': 'no-store' } })
}

// Staging-only internal chat. This endpoint never calls the WhatsApp provider,
// never commits commercial operations, and always scopes D1 by authenticated tenant.
// It provides a native Agents SDK instance for each authenticated test thread,
// without using the WhatsApp provider or running commercial write tools.
export async function handleInternalChatApiRequest(request: Request, env: Bindings): Promise<Response | null> {
  const path = new URL(request.url).pathname
  if (path !== '/api/chat/respond') return null
  if (request.method !== 'POST') return json({ code: 'METHOD_NOT_ALLOWED' }, 405)
  if (env.APP_ENV !== 'staging' || env.LUNA_INTERNAL_CHAT_ENABLED !== 'true') {
    return json({ code: 'LUNA_INTERNAL_CHAT_DISABLED' }, 404)
  }
  const auth = await authorizeOperation(request, env, 'operational')
  if (auth) return auth
  if (!env.LUNA_NATIVE) return json({ code: 'LUNA_NATIVE_AGENT_NOT_CONFIGURED' }, 503)
  let input: unknown
  try { input = await request.clone().json() } catch { return json({ code: 'INVALID_JSON' }, 400) }
  const body = input && typeof input === 'object' && !Array.isArray(input)
    ? input as Record<string, unknown> : {}
  if (!identifier(body.sessionId)) return json({ code: 'INVALID_CHAT_REQUEST' }, 400)
  const tenantId = request.headers.get('x-tenant-id')!
  const moduleId = request.headers.get('x-module-id')!
  const instance = env.LUNA_NATIVE.get(
    env.LUNA_NATIVE.idFromName(`${tenantId}:${moduleId}:${body.sessionId}`),
  )
  return instance.fetch(new Request('https://luna.internal/api/chat/respond', {
    method: 'POST',
    headers: request.headers,
    body: JSON.stringify(body),
  }))
}

export async function executeInternalChatTurn(request: Request, env: Bindings): Promise<Response | null> {
  const path = new URL(request.url).pathname
  if (path !== '/api/chat/respond') return null
  if (request.method !== 'POST') return json({ code: 'METHOD_NOT_ALLOWED' }, 405)
  if (env.APP_ENV !== 'staging' || env.LUNA_INTERNAL_CHAT_ENABLED !== 'true') {
    return json({ code: 'LUNA_INTERNAL_CHAT_DISABLED' }, 404)
  }

  const auth = await authorizeOperation(request, env, 'operational')
  if (auth) return auth
  const db = env.DB!
  if (!env.GROQ_API_KEY || !env.LUNA_MODEL) return json({ code: 'LUNA_PROVIDER_NOT_CONFIGURED' }, 503)
  const tenantId = request.headers.get('x-tenant-id')!
  const moduleId = request.headers.get('x-module-id')!
  if (moduleId !== 'petshop') return json({ code: 'INVALID_MODULE' }, 400)

  let parsed: unknown
  try { parsed = await request.json() } catch { return json({ code: 'INVALID_JSON' }, 400) }
  const body = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    ? parsed as Record<string, unknown> : {}
  const sessionId = body.sessionId
  const message = typeof body.message === 'string' ? body.message.trim() : ''
  const rawMessageId = body.clientMessageId
  if (!identifier(sessionId) || !message || message.length > 4000 || (rawMessageId !== undefined && !identifier(rawMessageId))) {
    return json({ code: 'INVALID_CHAT_REQUEST' }, 400)
  }
  const sourceId = typeof rawMessageId === 'string' ? rawMessageId : crypto.randomUUID()
  const responseId = `internal-response:${sourceId}`

  const session = await db.prepare(`SELECT id,status FROM chat_threads
    WHERE tenant_id=?1 AND module_id=?2 AND id=?3 LIMIT 1`)
    .bind(tenantId, moduleId, sessionId).first<{ id: string; status: string }>()
  if (!session) return json({ code: 'CHAT_NOT_FOUND' }, 404)
  if (session.status !== 'open') return json({ code: 'CHAT_NOT_IN_BOT_MODE' }, 409)

  const priorAnswer = await db.prepare(`SELECT content_text FROM chat_messages
    WHERE tenant_id=?1 AND module_id=?2 AND thread_id=?3 AND external_message_id=?4 LIMIT 1`)
    .bind(tenantId, moduleId, sessionId, responseId).first<{ content_text: string }>()
  if (priorAnswer) return json({ reply: priorAnswer.content_text, reused: true, savedUserMessages: [] })

  const priorInbound = await db.prepare(`SELECT content_text FROM chat_messages
    WHERE tenant_id=?1 AND module_id=?2 AND thread_id=?3 AND id=?4 AND actor_type='customer' LIMIT 1`)
    .bind(tenantId, moduleId, sessionId, sourceId).first<{ content_text: string }>()
  if (priorInbound && priorInbound.content_text !== message) return json({ code: 'CHAT_MESSAGE_ID_REUSED' }, 409)

  const now = Date.now()
  if (!priorInbound) {
    await db.batch([
      db.prepare(`INSERT INTO chat_messages
        (tenant_id,module_id,id,thread_id,direction,actor_type,content_text,created_at_ms)
        VALUES (?1,?2,?3,?4,'inbound','customer',?5,?6)`)
        .bind(tenantId, moduleId, sourceId, sessionId, message, now),
      db.prepare(`UPDATE chat_threads SET last_message_at_ms=?1,updated_at_ms=?1
        WHERE tenant_id=?2 AND module_id=?3 AND id=?4`).bind(now, tenantId, moduleId, sessionId),
    ])
  }
  const history = await db.prepare(`SELECT id,actor_type,content_text,created_at_ms FROM chat_messages
    WHERE tenant_id=?1 AND module_id=?2 AND thread_id=?3
      AND actor_type IN ('customer','assistant','human')
    ORDER BY created_at_ms DESC,id DESC LIMIT 20`)
    .bind(tenantId, moduleId, sessionId).all<PersistedMessage>()

  const company = await db.prepare(`SELECT name,system_prompt FROM ai_companies
    WHERE tenant_id=?1 AND module_id=?2 AND status='active'
    ORDER BY created_at_ms DESC LIMIT 1`)
    .bind(tenantId, moduleId).first<{ name: string; system_prompt: string }>()
  const system = [
    'Você é Luna, atendente virtual de um petshop. Fale em português brasileiro de forma natural, útil e breve.',
    'Conduza a conversa livremente e lembre do histórico. Consulte o catálogo antes de afirmar preços, disponibilidade ou serviços.',
    'Nunca invente preço, estoque, horário, pedido ou agendamento. Não afirme que efetuou vendas, reservas, pagamentos ou cadastros.',
    'Se o cliente quiser concluir uma ação comercial, explique que o atendimento ainda precisa da confirmação operacional; não simule sucesso.',
    'Não diagnostique doenças de animais. Quando necessário, encaminhe para atendimento humano.',
    company?.name ? `Negócio: ${company.name}` : '',
    company?.system_prompt || '',
  ].filter(Boolean).join('\n\n')

  const tools = {
    search_products: tool({
      description: 'Procura produtos no catálogo real do petshop. Use antes de responder valores de produtos.',
      inputSchema: z.object({ query: z.string().min(1).max(80) }),
      execute: async ({ query }) => {
        const rows = await db.prepare(`SELECT p.id,p.name,p.price_cents,
          COALESCE(i.on_hand_milliunits,0) AS stock_milliunits
          FROM catalog_products p LEFT JOIN inventory_balances i
            ON i.tenant_id=p.tenant_id AND i.module_id=p.module_id AND i.product_id=p.id
          WHERE p.tenant_id=?1 AND p.module_id=?2 AND p.status='active'
            AND LOWER(p.name) LIKE ?3 ORDER BY p.name LIMIT 8`)
          .bind(tenantId, moduleId, `%${query.toLowerCase()}%`).all<{
            id: string; name: string; price_cents: number; stock_milliunits: number
          }>()
        return rows.results.map(row => ({
          id: row.id, name: row.name, price_reais: row.price_cents / 100,
          stock_quantity: row.stock_milliunits / 1000,
        }))
      },
    }),
    search_services: tool({
      description: 'Consulta serviços e preços base no D1; valores finais podem depender de pet, porte e condições.',
      inputSchema: z.object({ query: z.string().min(1).max(80) }),
      execute: async ({ query }) => {
        const rows = await db.prepare(`SELECT id,name,default_price_cents,default_duration_min
          FROM services WHERE tenant_id=?1 AND module_id=?2 AND status='active'
          AND LOWER(name) LIKE ?3 ORDER BY name LIMIT 8`)
          .bind(tenantId, moduleId, `%${query.toLowerCase()}%`).all<{
            id: string; name: string; default_price_cents: number; default_duration_min: number
          }>()
        return rows.results.map(row => ({
          id: row.id, name: row.name, starting_price_reais: row.default_price_cents / 100,
          estimated_minutes: row.default_duration_min,
        }))
      },
    }),
  }

  try {
    const groq = createGroq({ apiKey: env.GROQ_API_KEY })
    const answer = await generateText({
      model: groq(env.LUNA_MODEL),
      system,
      messages: [...history.results].reverse().map(row => ({
        role: row.actor_type === 'customer' ? 'user' as const : 'assistant' as const,
        content: row.content_text,
      })),
      tools,
      stopWhen: isStepCount(4),
      maxRetries: 0,
      maxOutputTokens: 650,
      temperature: 0.4,
    })
    const reply = answer.text.trim()
    if (!reply) return json({ code: 'LUNA_EMPTY_RESPONSE' }, 503)
    const finishedAt = Date.now()
    await db.batch([
      db.prepare(`INSERT OR IGNORE INTO chat_messages
        (tenant_id,module_id,id,thread_id,external_message_id,direction,actor_type,content_text,created_at_ms)
        VALUES (?1,?2,?3,?4,?5,'outbound','assistant',?6,?7)`)
        .bind(tenantId, moduleId, crypto.randomUUID(), sessionId, responseId, reply, finishedAt),
      db.prepare(`UPDATE chat_threads SET last_message_at_ms=?1,updated_at_ms=?1
        WHERE tenant_id=?2 AND module_id=?3 AND id=?4`)
        .bind(finishedAt, tenantId, moduleId, sessionId),
    ])
    return json({
      reply, savedUserMessages: [{ id: sourceId, role: 'user', content: message, sent_at: new Date(now).toISOString() }],
    })
  } catch {
    return json({ code: 'LUNA_PROVIDER_UNAVAILABLE' }, 503)
  }
}
