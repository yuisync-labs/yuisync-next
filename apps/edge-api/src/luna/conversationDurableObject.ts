import { DurableObject } from 'cloudflare:workers'

import {
  parseLunaMessageReceivedEventV1,
  type LunaMessageReceivedEventV1,
} from '../../../../shared/contracts/v1/index'
import { sendWhatsAppOutboundText } from '../whatsappOutboundService'
import { GroqSdkProvider } from './providers/groqSdkProvider'
import { runLunaTurn } from './runLunaTurn'
import { recordProposalPresentation } from './proposalPresentation'
import { createD1TurnJournal,LunaCheckpointError,type LunaTurnJournal } from './turnJournal'
import { durableTurnQueue,type DurableTurnJob } from './durableTurnQueue'
import { hashCanonicalJson } from './canonicalJson'
import { executeLunaPlaygroundJob,type LunaPlaygroundJob } from './playgroundTurn'

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
  RELEASE_SHA?: string
  LUNA_PLAYGROUND_ENABLED?:string
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

export async function executeLunaMessageEvent(
  eventInput: unknown,
  env: LunaRuntimeBindings,
  journal?: LunaTurnJournal,
): Promise<{ accepted: boolean; status: string; trace_id?: string }> {
  const event = parseLunaMessageReceivedEventV1(eventInput)
  if (!enabled(env.LUNA_ENABLED)) return { accepted: false, status: 'disabled' }
  if (!env.DB) throw new Error('LUNA_DATABASE_NOT_CONFIGURED')
  if (env.LUNA_PROVIDER !== 'groq') throw new Error('LUNA_PROVIDER_NOT_CONFIGURED')

  const provider = new GroqSdkProvider({ apiKey: env.GROQ_API_KEY, model: env.LUNA_MODEL })
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
    journal,
  })

  let reply = result.reply
  if (result.status === 'quota_paused') {
    // The persisted drafts/proposals remain resumable. A temporary quota is
    // not a user request for permanent handoff, and must not mutate state.
    reply = 'O atendimento automático está temporariamente indisponível. Podemos retomar esta conversa em seguida.'
  } else if (result.status === 'failed') {
    reply = 'Não consegui concluir esta etapa com segurança. Podemos retomar ou chamar uma pessoa da equipe.'
  }

  if (reply) {
    const send = () => sendWhatsAppOutboundText(env, {
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
    const sent = journal ? await journal.run('outbound',{reply,eventId:event.event_id},send) : await send()
    if (sent.provider_message_id && result.proposalIds.length && ['submitted', 'sent', 'delivered', 'read'].includes(sent.status)) {
      const message = await env.DB.prepare(`SELECT id FROM chat_messages WHERE tenant_id=?1 AND module_id=?2 AND thread_id=?3 AND external_message_id=?4 LIMIT 1`)
        .bind(event.tenant_id, event.payload.module_id, event.payload.conversation_id, sent.provider_message_id).first<{ id: string }>()
      if (!message) throw new Error('PRESENTATION_MESSAGE_MISSING')
      const present = async () => {await recordProposalPresentation(env.DB!, { tenantId: event.tenant_id, moduleId: 'petshop', conversationId: event.payload.conversation_id, customerAddress: event.payload.customer_address, phoneNumberId: event.payload.phone_number_id, sourceMessageId: event.payload.source_message_id, traceId, executionMode: mode }, result.proposalIds, message.id);return true}
      if(journal)await journal.run('outbound-presentation',{proposals:result.proposalIds,messageId:message.id},present)
      else await present()
    }
  }

  return { accepted: true, status: result.status, trace_id: traceId }
}

export class LunaConversationDurableObject extends DurableObject<EdgeEnv> {
  private serial: Promise<void> = Promise.resolve()

  protected enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.serial.then(operation, operation)
    this.serial = result.then(() => undefined, () => undefined)
    return result
  }

  protected async executeJob(job: DurableTurnJob): Promise<unknown> {
    if((job.payload as {kind?:string})?.kind==='playground'){
      const payload=job.payload as LunaPlaygroundJob,env=this.env as LunaRuntimeBindings
      if(!env.DB)throw new LunaCheckpointError('LUNA_DATABASE_NOT_CONFIGURED')
      const journal=createD1TurnJournal(env.DB,payload.context,`${env.RELEASE_SHA??'local'}:${env.LUNA_MODEL}:durable-v1`)
      return executeLunaPlaygroundJob(payload,env,journal)
    }
    const event=parseLunaMessageReceivedEventV1(job.payload),env=this.env as LunaRuntimeBindings
    if(!env.DB)throw new Error('LUNA_DATABASE_NOT_CONFIGURED')
    const context={tenantId:event.tenant_id,moduleId:'petshop' as const,conversationId:event.payload.conversation_id,sourceMessageId:event.payload.source_message_id,customerAddress:event.payload.customer_address,phoneNumberId:event.payload.phone_number_id,traceId:event.correlation_id,executionMode:env.APP_ENV==='production'?'production' as const:'staging' as const}
    const journal=createD1TurnJournal(env.DB,context,`${env.RELEASE_SHA??'local'}:${env.LUNA_MODEL}:durable-v1`)
    return executeLunaMessageEvent(event,env,journal)
  }

  protected jobs() {return durableTurnQueue(this.ctx.storage,job=>this.executeJob(job),Date.now,job=>console.info('luna.turn.lifecycle',{jobId:job.id,status:job.status,errorCode:job.errorCode??null,attempts:job.attempts,activeDurationMs:job.activeDurationMs,quotaWaitMs:job.quotaWaitMs??0}))}

  async alarm(): Promise<void> {await this.enqueue(()=>this.jobs().process())}

  async fetch(request: Request): Promise<Response> {
    const path=new URL(request.url).pathname
    if(request.method==='GET'&&/^\/turns\/(?:[a-f0-9]{64}|latest)$/.test(path)) {
      const id=path.endsWith('/latest')?await this.ctx.storage.get<string>('luna-job-latest'):path.split('/').at(-1)!
      const job=id?await this.jobs().load(id):undefined
      if(!job)return Response.json({code:'NOT_FOUND'},{status:404})
      const {payload:_,...publicJob}=job
      return Response.json(publicJob,{headers:{'cache-control':'no-store'}})
    }
    if (request.method !== 'POST') return Response.json({ code: 'METHOD_NOT_ALLOWED' }, { status: 405 })
    let body: unknown
    try { body = await request.json() } catch { return Response.json({ code: 'INVALID_JSON' }, { status: 400 }) }
    try {
      if(path==='/playground'){
        if(this.env.LUNA_PLAYGROUND_ENABLED!=='true')return Response.json({code:'LUNA_PLAYGROUND_DISABLED'},{status:404})
        const payload=body as LunaPlaygroundJob
        if(payload.kind!=='playground'||payload.context?.moduleId!=='petshop'||!payload.context.sourceMessageId||payload.releaseSha!==((this.env as LunaRuntimeBindings).RELEASE_SHA??'local'))throw new LunaCheckpointError('LUNA_JOB_PAYLOAD_INVALID')
        const id=await hashCanonicalJson({tenant:payload.context.tenantId,conversation:payload.context.conversationId,source:payload.context.sourceMessageId})
        const job=await this.enqueue(()=>this.jobs().submit(id,payload))
        return Response.json({accepted:true,turn_id:job.id,status:job.status},{status:202,headers:{'cache-control':'no-store'}})
      }
      const event=parseLunaMessageReceivedEventV1(body)
      if(!enabled(this.env.LUNA_ENABLED))return Response.json({accepted:false,status:'disabled'})
      const id=await hashCanonicalJson({tenant:event.tenant_id,module:event.payload.module_id,conversation:event.payload.conversation_id,source:event.payload.source_message_id})
      const job=await this.enqueue(()=>this.jobs().submit(id,event))
      return Response.json({accepted:true,turn_id:job.id,status:job.status},{status:202,headers:{'cache-control':'no-store'}})
    } catch(error) {
      if(error instanceof LunaCheckpointError)return Response.json({code:error.code},{status:error.code==='LUNA_CONVERSATION_QUEUE_FULL'?429:409})
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
  // Drain the response, including rejection: an unread DO response stream
  // keeps an active reference and prevents graceful eviction/recovery.
  await response.arrayBuffer()
  if (!response.ok) throw new Error('LUNA_AGENT_REJECTED_EVENT')
}
