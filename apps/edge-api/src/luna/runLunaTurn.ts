import type { LunaMessage, LunaProviderResponse, LunaTurnResult } from './contracts'
import { LunaConversationRepository } from './conversationRepository'
import { createLunaBudget, LunaBudgetError } from './quotaBudget'
import { GroqProviderError } from './providers/groqProvider'
import { LUNA_OPERATIONAL_SYSTEM_PROMPT } from './systemPrompt'
import { createLunaToolRegistry } from './toolRegistry'
import type { LunaExecutionContext, LunaToolDefinition } from './contracts'

type Provider = Readonly<{
  model: string
  complete(input: { messages: readonly LunaMessage[]; tools: readonly LunaToolDefinition[]; maxCompletionTokens?: number }): Promise<LunaProviderResponse & { requestLimit: number | null; tokenLimit?: number | null }>
}>

function parseArguments(raw: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(raw)
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
  } catch { return null }
}

export async function runLunaTurn(input: {
  database: D1Database
  provider: Provider
  context: LunaExecutionContext
  maxModelCalls?: number
  maxToolCalls?: number
  maxTokens?: number
}): Promise<LunaTurnResult> {
  const repository = new LunaConversationRepository(input.database)
  const conversationStatus = await repository.ensureConversation(input.context)
  const emptyUsage = { modelCalls: 0, toolCalls: 0, promptTokens: 0, completionTokens: 0 }
  if (conversationStatus === 'handoff' || conversationStatus === 'closed') {
    return { status: 'handoff', reply: null, proposalIds: [], committedOperationIds: [], traceId: input.context.traceId, errorCode: null, usage: emptyUsage }
  }

  const budget = createLunaBudget({
    maxModelCalls: input.maxModelCalls,
    maxToolCalls: input.maxToolCalls,
    maxTokens: input.maxTokens,
  })
  const registry = createLunaToolRegistry(input.database)
  const pendingProposal = await repository.loadPendingProposalState(input.context)
  const messages: LunaMessage[] = [
    { role: 'system', content: LUNA_OPERATIONAL_SYSTEM_PROMPT },
    ...(pendingProposal ? [pendingProposal] : []),
    ...await repository.loadHistory(input.context),
  ]
  const proposals: string[] = []
  const committed: string[] = []
  const callSignatures = new Set<string>()
  let finalStatus: LunaTurnResult['status'] = 'failed'
  let reply: string | null = null
  let errorCode: string | null = null

  try {
    for (;;) {
      budget.beforeModel()
      const response = await input.provider.complete({ messages, tools: registry.definitions })
      budget.afterModel({
        promptTokens: response.usage.promptTokens,
        completionTokens: response.usage.completionTokens,
        remainingRequests: response.rateLimit.remainingRequests,
        requestLimit: response.requestLimit,
        remainingTokens: response.rateLimit.remainingTokens,
        tokenLimit: response.tokenLimit,
      })

      if (response.toolCalls.length === 0) {
        reply = response.content
        finalStatus = proposals.length > 0 ? 'awaiting_confirmation' : reply ? 'replied' : 'failed'
        break
      }

      messages.push({ role: 'assistant', content: response.content, tool_calls: response.toolCalls })
      for (const call of response.toolCalls) {
        budget.beforeTool()
        const args = parseArguments(call.function.arguments)
        let result
        const signature = `${call.function.name}:${call.function.arguments}`
        const started = Date.now()
        if (!args) result = { ok: false as const, code: 'TOOL_ARGUMENTS_INVALID', retryable: false }
        else if (callSignatures.has(signature)) result = { ok: false as const, code: 'TOOL_CALL_REPEATED', retryable: false }
        else {
          callSignatures.add(signature)
          try { result = await registry.execute(call.function.name, args, input.context) }
          catch { result = { ok: false as const, code: 'TOOL_EXECUTION_FAILED', retryable: true } }
        }
        await repository.recordToolRun({ context: input.context, name: call.function.name, args: args || {}, result, durationMs: Date.now() - started })
        if (result.ok && result.data && typeof result.data === 'object') {
          const data = result.data as Record<string, unknown>
          if (typeof data.proposal_id === 'string') proposals.push(data.proposal_id)
          if (typeof data.operation_id === 'string') committed.push(data.operation_id)
          if (data.status === 'handoff') finalStatus = 'handoff'
        }
        messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) })
      }
      if (finalStatus === 'handoff') {
        reply = 'Vou encaminhar esta conversa para uma pessoa da equipe continuar o atendimento.'
        break
      }
    }
  } catch (error) {
    if (error instanceof LunaBudgetError || (error instanceof GroqProviderError && error.code === 'GROQ_RATE_LIMITED')) {
      finalStatus = 'quota_paused'
      reply = null
      errorCode = error instanceof GroqProviderError ? error.code : error.code
    } else {
      finalStatus = 'failed'
      reply = null
      errorCode = error instanceof GroqProviderError ? error.code : 'LUNA_EXECUTION_FAILED'
    }
  }

  const usage = budget.snapshot()
  const outcome = errorCode ? `${finalStatus}:${errorCode}` : finalStatus
  try { await repository.recordUsage({ context: input.context, model: input.provider.model, usage, outcome }) } catch { /* operational result wins over telemetry */ }
  return { status: finalStatus, reply, proposalIds: proposals, committedOperationIds: committed, traceId: input.context.traceId, errorCode, usage }
}
