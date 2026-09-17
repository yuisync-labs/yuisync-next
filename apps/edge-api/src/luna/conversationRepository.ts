import type { LunaExecutionContext, LunaMessage, LunaToolResult } from './contracts'

export class LunaConversationRepository {
  constructor(private readonly database: D1Database) {}

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
      role: row.direction === 'inbound' ? 'user' as const : 'assistant' as const,
      content: row.content_text,
    }))
  }

  async loadPendingProposalState(context: LunaExecutionContext): Promise<LunaMessage | null> {
    const result = await this.database.prepare(`
      SELECT id,operation_kind,status,version,payload_json,expires_at_ms
      FROM luna_proposals
      WHERE tenant_id=?1 AND module_id=?2 AND conversation_id=?3
        AND status IN ('awaiting_confirmation','executing') AND expires_at_ms>=?4
      ORDER BY updated_at_ms DESC,id DESC LIMIT 1
    `).bind(context.tenantId, context.moduleId, context.conversationId, Date.now()).first<{
      id: string
      operation_kind: string
      status: string
      version: number
      payload_json: string
      expires_at_ms: number
    }>()
    if (!result) return null
    let payload: unknown = {}
    try { payload = JSON.parse(result.payload_json) } catch { payload = {} }
    return {
      role: 'system',
      content: `ESTADO OPERACIONAL PERSISTIDO (fonte D1): ${JSON.stringify({
        proposal_id: result.id,
        proposal_version: result.version,
        operation_kind: result.operation_kind,
        status: result.status,
        expires_at_ms: result.expires_at_ms,
        summary: payload,
      })}`,
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
      input.context.traceId, input.name, JSON.stringify(input.args), JSON.stringify(input.result), status,
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
