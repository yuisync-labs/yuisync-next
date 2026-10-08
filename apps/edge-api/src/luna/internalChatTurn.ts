import { runLunaTurn } from './runLunaTurn'
import { GroqSdkProvider } from './providers/groqSdkProvider'
import { recordProposalPresentation } from './proposalPresentation'
import { LunaCheckpointError, type LunaTurnJournal } from './turnJournal'
import type { LunaExecutionContext } from './contracts'
import { membershipAllows, type OperationMembership } from '../operationAuthorization'

export type InternalChatJob = {
  kind: 'internal-chat'; context: LunaExecutionContext; principalId: string;
  message: string; releaseSha: string; model: string
}
export type NativeLunaBindings = EdgeEnv & {RELEASE_SHA?: string; GROQ_API_KEY?: string}

// No request, cookie, bearer token or API key is stored in the durable payload.
// The authenticated Worker constructs it; queued execution rechecks authority.
export async function executeInternalChatJob(job: InternalChatJob, env: NativeLunaBindings, journal: LunaTurnJournal) {
  const db = env.DB, ctx = job.context
  if (!db || env.APP_ENV !== 'staging' || env.LUNA_INTERNAL_CHAT_ENABLED !== 'true'
    || job.releaseSha !== (env.RELEASE_SHA ?? 'local') || job.model !== env.LUNA_MODEL) {
    throw new LunaCheckpointError('LUNA_INTERNAL_CONFIGURATION_CHANGED')
  }
  const principal = await db.prepare(`SELECT id FROM identity_principals WHERE id=?1 AND status='active' LIMIT 1`).bind(job.principalId).first()
  const tenant = await db.prepare(`SELECT status FROM tenants WHERE id=?1 LIMIT 1`).bind(ctx.tenantId).first<{status: string}>()
  const membership = await db.prepare(`SELECT role,status,module_permissions_json,'active' AS tenant_status FROM tenant_memberships WHERE tenant_id=?1 AND principal_id=?2 LIMIT 1`).bind(ctx.tenantId, job.principalId).first<OperationMembership>()
  const admin = await db.prepare(`SELECT principal_id FROM platform_administrators WHERE principal_id=?1 AND status='active' LIMIT 1`).bind(job.principalId).first()
  if (!principal || tenant?.status !== 'active' || (!admin && (!membership || !membershipAllows(membership, 'petshop', 'operational')))) throw new LunaCheckpointError('FORBIDDEN')
  const thread = await db.prepare(`SELECT status,channel,external_thread_id FROM chat_threads WHERE tenant_id=?1 AND module_id='petshop' AND id=?2 LIMIT 1`).bind(ctx.tenantId, ctx.conversationId).first<{status: string; channel: string; external_thread_id: string}>()
  if (!thread || thread.status !== 'open' || thread.channel !== 'internal' || thread.external_thread_id.replace(/\D/g, '') !== ctx.customerAddress) throw new LunaCheckpointError('LUNA_CHAT_BINDING_CHANGED')

  const readInbound = async () => {
    const row = await db.prepare(`SELECT thread_id,content_text,created_at_ms FROM chat_messages WHERE tenant_id=?1 AND module_id='petshop' AND id=?2 LIMIT 1`).bind(ctx.tenantId, ctx.sourceMessageId).first<{thread_id: string; content_text: string; created_at_ms: number}>()
    if (!row) return undefined
    if (row.thread_id !== ctx.conversationId || row.content_text !== job.message) throw new LunaCheckpointError('CHAT_MESSAGE_ID_REUSED')
    return {id: ctx.sourceMessageId, role: 'user', content: row.content_text, sent_at: new Date(row.created_at_ms).toISOString()}
  }
  const saved = await journal.run('internal-inbound', {message: job.message}, async () => {
    const prior = await readInbound()
    if (prior) return prior
    const now = Date.now()
    await db.batch([
      db.prepare(`INSERT INTO chat_messages(tenant_id,module_id,id,thread_id,external_message_id,direction,actor_type,content_text,created_at_ms) VALUES(?1,'petshop',?2,?3,?2,'inbound','customer',?4,?5)`).bind(ctx.tenantId, ctx.sourceMessageId, ctx.conversationId, job.message, now),
      db.prepare(`UPDATE chat_threads SET last_message_at_ms=?1,updated_at_ms=?1 WHERE tenant_id=?2 AND module_id='petshop' AND id=?3`).bind(now, ctx.tenantId, ctx.conversationId),
    ])
    return (await readInbound())!
  }, readInbound)
  const positive = (value: string | undefined, fallback: number) => Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Number(value) : fallback
  const result = await runLunaTurn({
    database: db, context: ctx, provider: new GroqSdkProvider({apiKey: env.GROQ_API_KEY, model: job.model}), journal,
    maxModelCalls: positive(env.LUNA_MAX_MODEL_CALLS_PER_TURN, 6), maxToolCalls: positive(env.LUNA_MAX_TOOL_CALLS_PER_TURN, 10), maxTokens: positive(env.LUNA_MAX_TOKENS_PER_TURN, 12000),
  })
  if (result.reply) {
    const externalId = `internal-response:${ctx.sourceMessageId}`
    const readOutbound = () => db.prepare(`SELECT id FROM chat_messages WHERE tenant_id=?1 AND module_id='petshop' AND thread_id=?2 AND external_message_id=?3 LIMIT 1`).bind(ctx.tenantId, ctx.conversationId, externalId).first<{id: string}>().then(row => row?.id)
    const out = await journal.run('internal-outbound', {reply: result.reply}, async () => {
      const id = crypto.randomUUID(), now = Date.now()
      await db.batch([
        db.prepare(`INSERT INTO chat_messages(tenant_id,module_id,id,thread_id,external_message_id,direction,actor_type,content_text,created_at_ms) VALUES(?1,'petshop',?2,?3,?4,'outbound','assistant',?5,?6)`).bind(ctx.tenantId, id, ctx.conversationId, externalId, result.reply, now),
        db.prepare(`UPDATE chat_threads SET last_message_at_ms=?1,updated_at_ms=?1 WHERE tenant_id=?2 AND module_id='petshop' AND id=?3`).bind(now, ctx.tenantId, ctx.conversationId),
      ])
      return id
    }, readOutbound)
    await journal.run('internal-presentation', {out, proposals: result.proposalIds}, async () => {await recordProposalPresentation(db, ctx, result.proposalIds, out); return true})
  }
  return {...result, savedUserMessages: [saved]}
}
