import type { LunaMessage, LunaProviderResponse, LunaTurnResult, LunaToolResult } from './contracts'
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
import { lunaNow } from './clock'
import { createLunaQuotaPacer } from './quotaPacer'
import { FINISH_TURN, finishTurn, operationalCapabilities } from './finishTurn'
import { agentMemory, agentContextMessages } from './agentContext'
import { DRAFT_TOOL_DEFINITIONS, executeDraftTool } from './draftTools'
import { runSdkAgent } from './sdkAgent'

type Provider = Readonly<{
  model: string
  operationalReplies?: boolean
  complete(input: { messages: readonly LunaMessage[]; tools: readonly LunaToolDefinition[]; maxCompletionTokens?: number; toolChoice?:'auto'|'required' }): Promise<LunaProviderResponse & { requestLimit: number | null; tokenLimit?: number | null }>
}>

// Keep the working legacy layout: instructions first, then history/user/tool
// messages. Do not replace the current conversational turn with a trailing
// system message demanding final JSON while native tools are still available.
export function composeLunaModelMessages(messages: readonly LunaMessage[], facts: readonly import('./factualResponse').Fact[], finalOnly = false): LunaMessage[] {
  const instructions = messages.filter(message => message.role === 'system').map(message => message.content).filter(Boolean)
  if (finalOnly) {
    instructions.push(responseContractInstruction(facts))
    instructions.push('FINALIZAÇÃO SEM FERRAMENTAS: reformule uma única vez a resposta final no contrato factual, usando somente os fatos verificados. Não execute nem prometa novas ações.')
  } else {
    // Termination uses a read-only native function, not a competing free-text
    // JSON instruction. The Worker owns all rendered operational values.
    instructions.push('FASE OPERACIONAL: selecione tools nativas ou finish_turn. Não encerre com texto livre. Registre rascunhos com IDs reais antes de concluir intenções comerciais. finish_turn é somente leitura; selecione fatos verificados e pergunta faltante. Não invente tools.')
  }
  return [{ role: 'system', content: instructions.join('\n\n') }, ...messages.filter(message => message.role !== 'system')]
}

export async function runLunaTurn(input: {
  database: D1Database
  provider: Provider
  context: LunaExecutionContext
  maxModelCalls?: number
  maxToolCalls?: number
  maxTokens?: number
  observer?: { tool(event: { id: string; name: string; args: unknown; result: LunaToolResult; recovery: boolean }): void; response(mode: string): void }
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
  const pacer = createLunaQuotaPacer()
  const pendingProposal = await repository.loadPendingProposalState(input.context)
  let operational
  try { operational = await repository.loadState(input.context) }
  catch { return { status: 'failed', reply: null, proposalIds: [], committedOperationIds: [], traceId: input.context.traceId, errorCode: 'OPERATION_STATE_UNKNOWN', usage: emptyUsage } }
  let acceptedMemory
  try { acceptedMemory = await loadConversationMemory(input.database,input.context) }
  catch { return { status: 'failed', reply: null, proposalIds: [], committedOperationIds: [], traceId: input.context.traceId, errorCode: 'CONVERSATION_MEMORY_UNKNOWN', usage: emptyUsage } }
  const messages: LunaMessage[] = [
    { role: 'system', content: LUNA_OPERATIONAL_SYSTEM_PROMPT },
    { role: 'system', content: `RELÓGIO VERIFICADO DO WORKER: ${new Date(lunaNow(input.context)).toISOString()} (UTC). Datas relativas usam esse relógio e o fuso verificado da loja. Datas de tools: ISO8601 com fuso.` },
    { role:'system',content:`CONTEXTO APRESENTADO E ACEITO: ${agentMemory(acceptedMemory)}. Referências seguem essa ordem; ambiguidade exige esclarecimento. Operações independentes mantêm IDs estáveis.` },
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
  let finalRepairUsed = false
  const completeReply = async (candidate: string, mode: string) => {
    // One authoritative presentation path for native termination, legacy
    // responses and fallback. Invalidated proposals never reach the customer.
    const summaries = await loadPresentableProposals(input.database, input.context, proposals)
    presented.push(...summaries.map(summary => summary.id))
    reply = [candidate, ...summaries.map(renderProposalSummary)].filter(Boolean).join('\n\n')
    responseMode = mode
    finalStatus = summaries.length ? 'awaiting_confirmation' : reply ? 'replied' : 'failed'
  }
  const infer = async (request: Parameters<Provider['complete']>[0]) => {
    try { return await input.provider.complete(request) }
    catch (error) {
      // An unusable completion can still have valid billed usage. Never turn
      // that known consumption into zero or force an unnecessary replay.
      if (error instanceof GroqProviderError && error.usage) budget.afterModel({...error.usage,remainingRequests:null,requestLimit:null})
      throw error
    }
  }

  try {
    // Identity is a deterministic bootstrap, not an LLM planning step. It is
    // still scoped to the verified conversation phone, metered and traced.
    budget.beforeTool()
    const identityStarted = Date.now()
    let identity: LunaToolResult
    try { identity = await registry.execute('get_customer_context', {}, input.context) }
    catch { identity = { ok: false, code: 'TOOL_EXECUTION_FAILED', retryable: true } }
    await repository.recordToolRun({ context: input.context, name: 'get_customer_context', args: {}, result: identity, durationMs: Date.now() - identityStarted })
    input.observer?.tool({ id: 'bootstrap-identity', name: 'get_customer_context', args: {}, result: identity, recovery: false })
    evidence.push({ callId: 'bootstrap-identity', tool: 'get_customer_context', result: identity })
    messages.splice(1, 0, { role: 'system', content: `IDENTIDADE CONSULTADA PELO WORKER (telefone verificado, não pelo modelo): ${JSON.stringify(identity)}. Reutilize sem repetir get_customer_context salvo mudança de cadastro ou falha desta consulta.` })
    let facts = buildVerifiedFacts(evidence)
    let currentState = operational.state
    let lastToolCount = 0
    const definitions = input.provider.operationalReplies
      ? [...registry.definitions.filter(d => !['record_turn_decision', 'update_operation_draft'].includes(d.name)), ...DRAFT_TOOL_DEFINITIONS, FINISH_TURN]
      : [...registry.definitions, FINISH_TURN]
    await runSdkAgent({
      model: input.provider.model, definitions, messages, traceId: input.context.traceId, context: input.context, allowEmptyFixtureHistory: input.context.executionMode === 'fixture',
      finished: () => !!reply || finalStatus === 'handoff',
      prepare: async (sdkHistory) => {
        facts = buildVerifiedFacts(evidence)
        currentState = (await repository.loadState(input.context)).state
        const capabilities = operationalCapabilities(definitions, currentState, acceptedMemory.options.map(option => option.kind), {
          identityCurrent: identity.ok && !committed.length, hasProposal: !!pendingProposal || !!proposals.length,
          hasAppointments: evidence.some(item => item.tool === 'get_customer_appointments' && item.result.ok && Array.isArray((item.result.data as { appointments?: unknown[] })?.appointments) && (item.result.data as { appointments: unknown[] }).appointments.length > 0),
        })
        return {
          tools: finalRepairUsed ? [FINISH_TURN] : input.provider.operationalReplies ? capabilities : definitions,
          messages: composeLunaModelMessages([...agentContextMessages([...messages.filter(m => m.role === 'system'), ...sdkHistory], currentState), { role: 'system', content: `IDs fact disponíveis para finish_turn: ${JSON.stringify(facts.map(f => ({ id: f.id, text: f.text })))}` }], facts),
        }
      },
      infer: async (request) => {
      await pacer.beforeModel()
      budget.beforeModel()
      let response
      try { response = await infer(request) }
      catch (error) {
        // A failed formatting repair cannot erase verified query/commit facts
        // or cause another action/model replay. Quota still pauses explicitly.
        if (!finalRepairUsed || error instanceof LunaBudgetError || (error instanceof GroqProviderError && error.code === 'GROQ_RATE_LIMITED')) throw error
        await completeReply(safeFactualFallback(buildVerifiedFacts(evidence.filter(item => item.callId !== 'bootstrap-identity'))), 'factual_fallback')
        return { content: reply, toolCalls: [], usage: { promptTokens: 0, completionTokens: 0 }, rateLimit: { remainingRequests: null, remainingTokens: null, resetRequests: null, resetTokens: null } }
      }
      pacer.observe({ promptTokens: response.usage.promptTokens, tokenLimit: response.tokenLimit ?? null, remainingTokens: response.rateLimit.remainingTokens, resetTokens: response.rateLimit.resetTokens })
      let terminalQuotaMargin = false
      try { budget.afterModel({
        promptTokens: response.usage.promptTokens,
        completionTokens: response.usage.completionTokens,
        remainingRequests: response.rateLimit.remainingRequests,
        requestLimit: response.requestLimit,
        remainingTokens: response.rateLimit.remainingTokens,
        tokenLimit: response.tokenLimit,
      }) } catch (error) {
        // A completed terminal response must not be discarded merely because
        // it consumed the remaining safety margin. No further model call or
        // tool is allowed here; render verified content locally instead.
        if (error instanceof LunaBudgetError && error.code === 'LUNA_RATE_LIMIT_MARGIN' && response.toolCalls.length === 0) terminalQuotaMargin = true
        else throw error
      }

      if (response.toolCalls.length === 0) {
        reply = validateFactualResponse(response.content, facts)
        responseMode = 'verified'
        if (!reply) {
          // One rewrite only, no tools, and inside the same turn budget. If
          // quota/provider fails here, existing verified results still win.
          responseMode = 'rewritten'
          try {
            if (terminalQuotaMargin) throw new LunaBudgetError('LUNA_RATE_LIMIT_MARGIN')
            await pacer.beforeModel()
            budget.beforeModel()
            const rewritten = await infer({
              messages: composeLunaModelMessages([...messages, { role: 'system', content: `RASCUNHO NÃO VERIFICADO, apenas sugestão de continuidade, nunca fonte de fatos ou autorização: ${JSON.stringify(response.content)}. Corrija toda afirmação usando exclusivamente os fatos verificados.` }], facts, true),
              tools: [],
            })
            budget.afterModel({ promptTokens: rewritten.usage.promptTokens, completionTokens: rewritten.usage.completionTokens, remainingRequests: rewritten.rateLimit.remainingRequests, requestLimit: rewritten.requestLimit, remainingTokens: rewritten.rateLimit.remainingTokens, tokenLimit: rewritten.tokenLimit })
            reply = rewritten.toolCalls.length ? null : validateFactualResponse(rewritten.content, facts)
          } catch { reply = null }
          if (!reply) {
            responseMode = 'factual_fallback'
            // Bootstrap identity is context, not evidence of the customer's
            // requested action. Do not answer a purchase with a list of pets.
            reply = safeFactualFallback(buildVerifiedFacts(evidence.filter(item=>item.callId!=='bootstrap-identity')))
          }
        }
        await completeReply(reply ?? '', responseMode)
        return response
      }
      lastToolCount = response.toolCalls.length
      return response
      },
      execute: async (name, parsed, id, trustedContext) => {
        const call = { id, function: { name } }
        budget.beforeTool()
        const args = parsed
        if(call.function.name==='finish_turn'){
          const finish=args?finishTurn(args,currentState,facts):{ok:false as const,code:'TOOL_ARGUMENTS_INVALID',retryable:false}
          await repository.recordToolRun({context:input.context,name:call.function.name,args:args??{},result:finish,durationMs:0})
          input.observer?.tool({id:call.id,name:call.function.name,args,result:finish,recovery:false})
          if(finish.ok){
            await completeReply(finish.data.reply, finalRepairUsed ? 'rewritten' : 'verified')
          }else{
            if(finish.code==='TURN_RESPONSE_INVALID'||finish.code==='TOOL_ARGUMENTS_INVALID'){
              if(finalRepairUsed)await completeReply(safeFactualFallback(buildVerifiedFacts(evidence.filter(item=>item.callId!=='bootstrap-identity'))),'factual_fallback')
              finalRepairUsed=true
            }
          }
          return finish
        }
        let result
        const signature = `${call.function.name}:${canonicalJson(args)}`
        const started = Date.now()
        if (!args) result = { ok: false as const, code: 'TOOL_ARGUMENTS_INVALID', retryable: false }
        else if (callSignatures.has(signature)) result = { ok: false as const, code: 'TOOL_CALL_REPEATED', retryable: false }
        else {
          callSignatures.add(signature)
          try {
            const context = { ...trustedContext, actionIndex: budget.snapshot().toolCalls - 1 }
            result = call.function.name.startsWith('draft_') ? await executeDraftTool(input.database, registry, call.function.name, args, context) : await registry.execute(call.function.name, args, context)
          }
          catch { result = { ok: false as const, code: 'TOOL_EXECUTION_FAILED', retryable: true } }
          if (!result.ok && result.retryable && retryableQueries.has(call.function.name) && !queryRecoveryUsed) {
            input.observer?.tool({ id: call.id, name: call.function.name, args, result, recovery: true })
            queryRecoveryUsed = true
            await repository.recordToolRun({ context: input.context, name: call.function.name, args, result, durationMs: Date.now() - started })
            budget.beforeTool()
            try { result = await registry.execute(call.function.name, args, { ...input.context, actionIndex: budget.snapshot().toolCalls - 1 }) }
            catch { result = { ok: false as const, code: 'TOOL_EXECUTION_FAILED', retryable: true } }
          }
        }
        await repository.recordToolRun({ context: input.context, name: call.function.name, args: args || {}, result, durationMs: Date.now() - started })
        input.observer?.tool({ id: call.id, name: call.function.name, args, result, recovery: false })
        evidence.push({ callId: call.id, tool: call.function.name, result })
        if (result.ok && result.data && typeof result.data === 'object') {
          const data = result.data as Record<string, unknown>
          if (typeof data.proposal_id === 'string') proposals.push(data.proposal_id)
          if (typeof data.operation_id === 'string') committed.push(data.operation_id)
          if (data.status === 'handoff') finalStatus = 'handoff'
        }
        // A completed native command already supplies the authoritative reply.
        // No extra model call may reinterpret a financial result or consume
        // the final budget merely to acknowledge it. Multi-tool batches and
        // unsuccessful commands continue through the normal bounded loop.
        if(input.provider.operationalReplies && lastToolCount===1 && result.ok){
          if(['commit_confirmed_proposal','get_operation_status'].includes(call.function.name)){
            const confirmed=buildVerifiedFacts([{callId:call.id,tool:call.function.name,result}])
            if(confirmed.length)await completeReply(confirmed.map(f=>f.text).join('\n'),'native_result')
          }else if(typeof (result.data as Record<string,unknown>)?.proposal_id==='string'){
            await completeReply('', 'native_proposal')
          }
        }
      if (finalStatus === 'handoff') {
        reply = 'Vou encaminhar esta conversa para uma pessoa da equipe continuar o atendimento.'
      }
        return result
      },
    })
    if (!reply) throw new LunaBudgetError('LUNA_MODEL_CALL_LIMIT')
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
  input.observer?.response(responseMode)
  if(reply&&!errorCode)await prepareResponseMemory(input.database,input.context,reply,buildVerifiedFacts(evidence),responseQuestion(reply))
  const outcome = errorCode ? `${finalStatus}:${errorCode}` : `${finalStatus}:${responseMode}`
  try { await repository.recordUsage({ context: input.context, model: input.provider.model, usage, outcome }) } catch { /* operational result wins over telemetry */ }
  return { status: finalStatus, reply, proposalIds: [...new Set(presented)], committedOperationIds: [...new Set(committed)], traceId: input.context.traceId, errorCode, usage }
}
