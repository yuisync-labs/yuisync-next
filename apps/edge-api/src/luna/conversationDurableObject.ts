import { DurableObject } from 'cloudflare:workers'

import {
  parseLunaMessageReceivedEventV1,
  type LunaMessageReceivedEventV1,
} from '../../../../shared/contracts/v1/index'
import { sendWhatsAppOutboundText } from '../whatsappOutboundService'
import { GroqProvider } from './providers/groqProvider'
import { runLunaTurn } from './runLunaTurn'

export type LunaRuntimeBindings = Readonly<{
  DB?: D1Database
  LUNA_ENABLED?: string
  LUNA_PROVIDER?: string
  LUNA_MODEL?: string
  GROQ_API_KEY?: string
  LUNA_MAX_MODEL_CALLS_PER_TURN?: string
  LUNA_MAX_TOOL_CALLS_PER_TURN?: string
  LUNA_MAX_TOKENS_PER_TURN?: string
  APP_ENV?: string
  WHATSAPP_CREDENTIAL_ENCRYPTION_KEY?: string
  WHATSAPP_GRAPH_VERSION?: string
}>

export type LunaQueueBindings = LunaRuntimeBindings & Readonly<{
  LUNA_AGENT?: DurableObjectNamespace<LunaConversationDurableObject>
}>

function positive(value: string | undefined, fallback: number): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : fallback
}

function enabled(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === 'true'
}

async function setHandoff(database: D1Database, event: LunaMessageReceivedEventV1, reason: string): Promise<void> {
  const now = Date.now()
  await database.batch([
    database.prepare(`UPDATE chat_threads SET status='handoff',updated_at_ms=?4 WHERE tenant_id=?1 AND module_id=?2 AND id=?3`)
      .bind(event.tenant_id, event.payload.module_id, event.payload.conversation_id, now),
    database.prepare(`UPDATE luna_conversations SET status='handoff',state_json=json_set(state_json,'$.handoff_reason',?4),updated_at_ms=?5,version=version+1 WHERE tenant_id=?1 AND module_id=?2 AND conversation_id=?3`)
      .bind(event.tenant_id, event.payload.module_id, event.payload.conversation_id, reason, now),
  ])
}

export async function executeLunaMessageEvent(
  eventInput: unknown,
  env: LunaRuntimeBindings,
): Promise<{ accepted: boolean; status: string; trace_id?: string }> {
  const event = parseLunaMessageReceivedEventV1(eventInput)
  if (!enabled(env.LUNA_ENABLED)) return { accepted: false, status: 'disabled' }
  if (!env.DB) throw new Error('LUNA_DATABASE_NOT_CONFIGURED')
  if (env.LUNA_PROVIDER !== 'groq') throw new Error('LUNA_PROVIDER_NOT_CONFIGURED')

  const provider = new GroqProvider({ apiKey: env.GROQ_API_KEY, model: env.LUNA_MODEL })
  const traceId = event.correlation_id
  const mode = env.APP_ENV === 'production' ? 'production' : env.APP_ENV === 'staging' ? 'staging' : 'fixture'
  const result = await runLunaTurn({
    database: env.DB,
    provider,
    context: {
      tenantId: event.tenant_id,
      moduleId: 'petshop',
      conversationId: event.payload.conversation_id,
      customerAddress: event.payload.customer_address,
      phoneNumberId: event.payload.phone_number_id,
      sourceMessageId: event.payload.source_message_id,
      traceId,
      executionMode: mode,
    },
    maxModelCalls: positive(env.LUNA_MAX_MODEL_CALLS_PER_TURN, 6),
    maxToolCalls: positive(env.LUNA_MAX_TOOL_CALLS_PER_TURN, 10),
    maxTokens: positive(env.LUNA_MAX_TOKENS_PER_TURN, 12_000),
  })

  let reply = result.reply
  if (result.status === 'quota_paused') {
    await setHandoff(env.DB, event, 'LUNA_PROVIDER_QUOTA_PAUSED')
    reply = 'Nosso atendimento automático atingiu o limite de testes. Vou encaminhar sua conversa para a equipe.'
  } else if (result.status === 'failed') {
    await setHandoff(env.DB, event, 'LUNA_EXECUTION_FAILED')
    reply = 'Não consegui concluir esta etapa com segurança. Vou encaminhar sua conversa para a equipe.'
  }

  if (reply) {
    await sendWhatsAppOutboundText(env, {
      tenantId: event.tenant_id,
      moduleId: event.payload.module_id,
      conversationId: event.payload.conversation_id,
      to: event.payload.customer_address,
      body: reply,
      idempotencyKey: event.event_id,
      actorType: 'assistant',
      phoneNumberId: event.payload.phone_number_id,
      correlationId: event.correlation_id,
    })
  }

  return { accepted: true, status: result.status, trace_id: traceId }
}

export class LunaConversationDurableObject extends DurableObject<EdgeEnv> {
  private serial: Promise<void> = Promise.resolve()

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.serial.then(operation, operation)
    this.serial = result.then(() => undefined, () => undefined)
    return result
  }

  async fetch(request: Request): Promise<Response> {
    if (request.method !== 'POST') return Response.json({ code: 'METHOD_NOT_ALLOWED' }, { status: 405 })
    let body: unknown
    try { body = await request.json() } catch { return Response.json({ code: 'INVALID_JSON' }, { status: 400 }) }
    try {
      const result = await this.enqueue(() => executeLunaMessageEvent(body, this.env as LunaRuntimeBindings))
      return Response.json(result)
    } catch {
      return Response.json({ code: 'LUNA_EXECUTION_FAILED' }, { status: 503 })
    }
  }
}

export async function dispatchLunaMessageEvent(eventInput: unknown, env: LunaQueueBindings): Promise<void> {
  const event = parseLunaMessageReceivedEventV1(eventInput)
  if (!enabled(env.LUNA_ENABLED)) return
  if (!env.LUNA_AGENT) throw new Error('LUNA_AGENT_NOT_CONFIGURED')
  const objectName = `${event.tenant_id}:${event.payload.module_id}:${event.payload.conversation_id}`
  const stub = env.LUNA_AGENT.get(env.LUNA_AGENT.idFromName(objectName))
  const response = await stub.fetch('https://luna.internal/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(event),
  })
  if (!response.ok) throw new Error('LUNA_AGENT_REJECTED_EVENT')
}
