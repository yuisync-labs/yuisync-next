import type { LunaMessage, LunaProviderResponse, LunaTurnResult } from './contracts'
import { LunaConversationRepository } from './conversationRepository'
import { createLunaBudget, LunaBudgetError } from './quotaBudget'
import { GroqProviderError } from './providers/groqProvider'
import { LUNA_OPERATIONAL_SYSTEM_PROMPT } from './systemPrompt'
import { createLunaToolRegistry } from './toolRegistry'
import type { LunaExecutionContext, LunaToolDefinition } from './contracts'
import { loadPresentableProposals, renderProposalSummary } from './proposalPresentation'
import { canonicalJson } from './canonicalJson'
import { buildVerifiedFacts, responseContractInstruction, responseQuestion, safeFactualFallback, validateFactualResponse, type FactualEvidence } from './factualResponse'
import { loadConversationMemory,prepareResponseMemory } from './conversationalMemory'

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
  let operational
  try { operational = await repository.loadState(input.context) }
  catch { return { status: 'failed', reply: null, proposalIds: [], committedOperationIds: [], traceId: input.context.traceId, errorCode: 'OPERATION_STATE_UNKNOWN', usage: emptyUsage } }
  let acceptedMemory
  try { acceptedMemory = await loadConversationMemory(input.database,input.context) }
  catch { return { status: 'failed', reply: null, proposalIds: [], committedOperationIds: [], traceId: input.context.traceId, errorCode: 'CONVERSATION_MEMORY_UNKNOWN', usage: emptyUsage } }
  const messages: LunaMessage[] = [
    { role: 'system', content: LUNA_OPERATIONAL_SYSTEM_PROMPT },
    { role: 'system', content: `RELÓGIO VERIFICADO DO WORKER: ${new Date(Date.now()).toISOString()} (UTC). Resolva datas relativas usando este instante e o fuso da loja retornado por get_customer_context.store_context ou get_store_information; nunca use uma data ou fuso presumidos pelo modelo. Para múltiplas intenções, consulte identidade/catálogos e agrupe eventos em record_turn_decision. Ferramentas são sequenciais; preserve orçamento para a resposta final.` },
    { role: 'system', content: `MEMÓRIA OPERACIONAL D1: ${JSON.stringify(operational.state)}\nResumo conversacional (não autoriza operações): ${operational.summary ?? ''}` },
    { role:'system',content:`CONTEXTO APRESENTADO E ACEITO: ${JSON.stringify(acceptedMemory)}. Resolva referências pela ordem apresentada, não por uma ordem presumida. Havendo ambiguidade use resolve_context_reference e peça esclarecimento. Um novo assunto não apaga operações paralelas. Registre intenções múltiplas com record_turn_decision.` },
    ...(pendingProposal ? [pendingProposal] : []),
    ...await repository.loadHistory(input.context),
  ]
  const proposals: string[] = []
  const presented: string[] = []
  const committed: string[] = []
  const callSignatures = new Set<string>()
  const evidence: FactualEvidence[] = []
  let responseMode = 'none'
  let queryRecoveryUsed = false
  const retryableQueries = new Set(['get_customer_context', 'search_services', 'search_products', 'get_customer_appointments', 'get_package_eligibility', 'get_store_information', 'get_transport_quote', 'get_delivery_quote', 'get_available_slots'])
  let finalStatus: LunaTurnResult['status'] = 'failed'
  let reply: string | null = null
  let errorCode: string | null = null

  try {
    for (;;) {
      budget.beforeModel()
      const facts = buildVerifiedFacts(evidence)
      const response = await input.provider.complete({ messages: [...messages, { role: 'system', content: responseContractInstruction(facts) }], tools: registry.definitions })
      budget.afterModel({
        promptTokens: response.usage.promptTokens,
        completionTokens: response.usage.completionTokens,
        remainingRequests: response.rateLimit.remainingRequests,
        requestLimit: response.requestLimit,
        remainingTokens: response.rateLimit.remainingTokens,
        tokenLimit: response.tokenLimit,
      })

      if (response.toolCalls.length === 0) {
        reply = validateFactualResponse(response.content, facts)
        responseMode = 'verified'
        if (!reply) {
          // One rewrite only, no tools, and inside the same turn budget. If
          // quota/provider fails here, existing verified results still win.
          responseMode = 'rewritten'
          try {
            budget.beforeModel()
            const rewritten = await input.provider.complete({
              messages: [...messages, { role: 'system', content: `${responseContractInstruction(facts)} A resposta anterior não seguiu o contrato. Reformule uma única vez sem chamar ferramentas.` }],
              tools: [],
            })
            budget.afterModel({ promptTokens: rewritten.usage.promptTokens, completionTokens: rewritten.usage.completionTokens, remainingRequests: rewritten.rateLimit.remainingRequests, requestLimit: rewritten.requestLimit, remainingTokens: rewritten.rateLimit.remainingTokens, tokenLimit: rewritten.tokenLimit })
            reply = rewritten.toolCalls.length ? null : validateFactualResponse(rewritten.content, facts)
          } catch { reply = null }
          if (!reply) { responseMode = 'factual_fallback'; reply = safeFactualFallback(facts) }
        }
        const summaries = await loadPresentableProposals(input.database, input.context, proposals)
        presented.push(...summaries.map(summary=>summary.id))
        if (summaries.length) reply = [reply, ...summaries.map(renderProposalSummary)].filter(Boolean).join('\n\n')
        finalStatus = summaries.length > 0 ? 'awaiting_confirmation' : reply ? 'replied' : 'failed'
        break
      }

      messages.push({ role: 'assistant', content: response.content, tool_calls: response.toolCalls })
      for (const call of response.toolCalls) {
        budget.beforeTool()
        const args = parseArguments(call.function.arguments)
        let result
        const signature = `${call.function.name}:${canonicalJson(args)}`
        const started = Date.now()
        if (!args) result = { ok: false as const, code: 'TOOL_ARGUMENTS_INVALID', retryable: false }
        else if (callSignatures.has(signature)) result = { ok: false as const, code: 'TOOL_CALL_REPEATED', retryable: false }
        else {
          callSignatures.add(signature)
          try { result = await registry.execute(call.function.name, args, { ...input.context, actionIndex: budget.snapshot().toolCalls - 1 }) }
          catch { result = { ok: false as const, code: 'TOOL_EXECUTION_FAILED', retryable: true } }
          if (!result.ok && result.retryable && retryableQueries.has(call.function.name) && !queryRecoveryUsed) {
            queryRecoveryUsed = true
            await repository.recordToolRun({ context: input.context, name: call.function.name, args, result, durationMs: Date.now() - started })
            budget.beforeTool()
            try { result = await registry.execute(call.function.name, args, { ...input.context, actionIndex: budget.snapshot().toolCalls - 1 }) }
            catch { result = { ok: false as const, code: 'TOOL_EXECUTION_FAILED', retryable: true } }
          }
        }
        await repository.recordToolRun({ context: input.context, name: call.function.name, args: args || {}, result, durationMs: Date.now() - started })
        evidence.push({ callId: call.id, tool: call.function.name, result })
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
  if(reply&&!errorCode)await prepareResponseMemory(input.database,input.context,reply,buildVerifiedFacts(evidence),responseQuestion(reply))
  const outcome = errorCode ? `${finalStatus}:${errorCode}` : `${finalStatus}:${responseMode}`
  try { await repository.recordUsage({ context: input.context, model: input.provider.model, usage, outcome }) } catch { /* operational result wins over telemetry */ }
  return { status: finalStatus, reply, proposalIds: [...new Set(presented)], committedOperationIds: [...new Set(committed)], traceId: input.context.traceId, errorCode, usage }
}
