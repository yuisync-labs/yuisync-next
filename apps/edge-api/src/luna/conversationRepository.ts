import type { LunaExecutionContext, LunaMessage, LunaToolResult } from './contracts'
import { sanitizeLunaTelemetry } from './telemetrySanitizer'
import { loadOperationalState, reduceDraft, type DraftEvent, type OperationalState } from './operationalState'
import { hashCanonicalJson } from './canonicalJson'

export class LunaConversationRepository {
  constructor(private readonly database: D1Database) {}

  async loadState(context: LunaExecutionContext): Promise<{ state: OperationalState; summary: string | null; databaseVersion: number }> {
    const row = await this.database.prepare(`SELECT state_json,summary_text,version FROM luna_conversations WHERE tenant_id=?1 AND module_id=?2 AND conversation_id=?3`)
      .bind(context.tenantId, context.moduleId, context.conversationId).first<{ state_json: string; summary_text: string | null; version: number }>()
    if (!row) throw new Error('OPERATION_STATE_MISSING')
    return { state: loadOperationalState(row.state_json), summary: row.summary_text, databaseVersion: row.version }
  }

  async applyDraftEvent(context: LunaExecutionContext, event: DraftEvent, actionIndex: number): Promise<OperationalState> {
    if (!context.sourceMessageId || !Number.isSafeInteger(actionIndex) || actionIndex < 0 || actionIndex >= 10) throw new Error('OPERATION_EVENT_INVALID')
    const eventId = `${context.sourceMessageId}:${actionIndex}`
    const fingerprint = await hashCanonicalJson(event)
    const prior = await this.database.prepare(`SELECT event_fingerprint FROM luna_operation_events WHERE tenant_id=?1 AND module_id=?2 AND conversation_id=?3 AND event_id=?4`)
      .bind(context.tenantId, context.moduleId, context.conversationId, eventId).first<{ event_fingerprint: string }>()
    const loaded = await this.loadState(context)
    if (prior) {
      if (prior.event_fingerprint !== fingerprint) throw new Error('OPERATION_EVENT_CONFLICT')
      return loaded.state
    }
    const next = reduceDraft(loaded.state, event)
    const results = await this.database.batch([
      this.database.prepare(`UPDATE luna_conversations SET state_json=?4,version=version+1,updated_at_ms=?5 WHERE tenant_id=?1 AND module_id=?2 AND conversation_id=?3 AND version=?6`)
        .bind(context.tenantId, context.moduleId, context.conversationId, JSON.stringify(next), Date.now(), loaded.databaseVersion),
      this.database.prepare(`INSERT INTO luna_operation_events(tenant_id,module_id,conversation_id,event_id,operation_id,event_type,previous_version,next_version,created_at_ms,event_fingerprint)
        SELECT ?1,?2,?3,?4,?5,?6,?7,?8,?9,?12 WHERE changes()=1 AND EXISTS(SELECT 1 FROM luna_conversations WHERE tenant_id=?1 AND module_id=?2 AND conversation_id=?3 AND version=?10 AND state_json=?11)`)
        .bind(context.tenantId, context.moduleId, context.conversationId, eventId, event.operationId, event.action, event.expectedVersion, next.operations[event.operationId].version, Date.now(), loaded.databaseVersion + 1, JSON.stringify(next), fingerprint),
      this.database.prepare(`UPDATE luna_proposals SET status='invalidated',updated_at_ms=?4 WHERE tenant_id=?1 AND module_id=?2 AND conversation_id=?3
        AND status='awaiting_confirmation' AND ?5=1 AND (operation_id=?10 OR ((operation_id IS NULL OR operation_id=operation_kind) AND operation_kind IN (?6,?7,?8)))
        AND EXISTS(SELECT 1 FROM luna_operation_events WHERE tenant_id=?1 AND module_id=?2 AND conversation_id=?3 AND event_id=?9)`)
        .bind(context.tenantId, context.moduleId, context.conversationId, Date.now(), next.version === loaded.state.version || ['pause', 'resume'].includes(event.action) ? 0 : 1,
          event.kind === 'cart' ? 'product_order_create' : event.kind === 'booking' ? 'appointment_create' : 'customer_registration',
          event.kind === 'booking' ? 'appointment_reschedule' : '', event.kind === 'booking' ? 'appointment_cancel' : 'pet_registration', eventId, event.operationId),
    ])
    if (results[0].meta.changes !== 1 || results[1].meta.changes !== 1) throw new Error('OPERATION_VERSION_STALE')
    return next
  }

  async ensureConversation(context: LunaExecutionContext): Promise<'active' | 'handoff' | 'paused' | 'closed'> {
    const now = Date.now()
    await this.database.prepare(`
      INSERT INTO luna_conversations(
        tenant_id,module_id,conversation_id,status,state_json,last_source_message_id,created_at_ms,updated_at_ms
      ) VALUES(?1,?2,?3,'active','{}',?4,?5,?5)
      ON CONFLICT(tenant_id,module_id,conversation_id) DO UPDATE SET
        last_source_message_id=excluded.last_source_message_id,
        updated_at_ms=excluded.updated_at_ms
    `).bind(context.tenantId, context.moduleId, context.conversationId, context.sourceMessageId, now).run()
    const row = await this.database.prepare(`
      SELECT status FROM luna_conversations
      WHERE tenant_id=?1 AND module_id=?2 AND conversation_id=?3 LIMIT 1
    `).bind(context.tenantId, context.moduleId, context.conversationId).first<{ status: 'active' | 'handoff' | 'paused' | 'closed' }>()
    return row?.status || 'paused'
  }

  async loadHistory(context: LunaExecutionContext, limit = 12): Promise<LunaMessage[]> {
    const result = await this.database.prepare(`
      SELECT direction,actor_type,content_text FROM (
        SELECT direction,actor_type,content_text,created_at_ms,id
        FROM chat_messages
        WHERE tenant_id=?1 AND module_id=?2 AND thread_id=?3 AND trim(content_text)<>''
        ORDER BY created_at_ms DESC,id DESC LIMIT ?4
      ) ORDER BY created_at_ms,id
    `).bind(context.tenantId, context.moduleId, context.conversationId, Math.max(1, Math.min(30, limit))).all<{
      direction: string
      actor_type: string
      content_text: string
    }>()
    return result.results.map((row) => ({
      role: row.direction === 'inbound' || row.actor_type === 'human' ? 'user' as const : 'assistant' as const,
      content: row.actor_type === 'human' ? `Atendente humano: ${row.content_text}` : row.content_text,
    }))
  }

  async loadPendingProposalState(context: LunaExecutionContext): Promise<LunaMessage | null> {
    const result = await this.database.prepare(`
      SELECT id,operation_kind,status,version,payload_json,expires_at_ms
      FROM luna_proposals
      WHERE tenant_id=?1 AND module_id=?2 AND conversation_id=?3
        AND status IN ('awaiting_confirmation','executing') AND expires_at_ms>=?4
      ORDER BY updated_at_ms DESC,id DESC LIMIT 12
    `).bind(context.tenantId, context.moduleId, context.conversationId, Date.now()).all<{
      id: string
      operation_kind: string
      status: string
      version: number
      payload_json: string
      expires_at_ms: number
    }>()
    if (!result.results.length) return null
    return {
      role: 'system',
      content: `PROPOSTAS INDEPENDENTES PERSISTIDAS (fonte D1): ${JSON.stringify(result.results.map((row) => ({
        proposal_id: row.id, proposal_version: row.version, operation_kind: row.operation_kind,
        status: row.status, expires_at_ms: row.expires_at_ms, summary: JSON.parse(row.payload_json),
      })))}`,
    }
  }

  async recordToolRun(input: {
    context: LunaExecutionContext
    name: string
    args: unknown
    result: LunaToolResult
    durationMs: number
  }): Promise<void> {
    const status = input.result.ok ? 'succeeded' : input.result.retryable ? 'failed' : 'rejected'
    await this.database.prepare(`
      INSERT INTO luna_tool_runs(
        tenant_id,module_id,id,conversation_id,trace_id,tool_name,arguments_json,result_json,status,duration_ms,created_at_ms
      ) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)
    `).bind(
      input.context.tenantId, input.context.moduleId, crypto.randomUUID(), input.context.conversationId,
      input.context.traceId, input.name, JSON.stringify(sanitizeLunaTelemetry(input.args)), JSON.stringify(sanitizeLunaTelemetry(input.result)), status,
      Math.max(0, input.durationMs), Date.now(),
    ).run()
  }

  async recordUsage(input: {
    context: LunaExecutionContext
    model: string
    usage: { modelCalls: number; toolCalls: number; promptTokens: number; completionTokens: number }
    outcome: string
  }): Promise<void> {
    await this.database.prepare(`
      INSERT INTO luna_usage_ledger(
        tenant_id,module_id,id,conversation_id,trace_id,provider,model,prompt_tokens,completion_tokens,
        model_calls,tool_calls,outcome,created_at_ms
      ) VALUES(?1,?2,?3,?4,?5,'groq',?6,?7,?8,?9,?10,?11,?12)
    `).bind(
      input.context.tenantId, input.context.moduleId, crypto.randomUUID(), input.context.conversationId,
      input.context.traceId, input.model, input.usage.promptTokens, input.usage.completionTokens,
      input.usage.modelCalls, input.usage.toolCalls, input.outcome.slice(0, 80), Date.now(),
    ).run()
  }
}
