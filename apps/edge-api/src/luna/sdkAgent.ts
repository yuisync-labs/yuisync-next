import { ToolLoopAgent, isStepCount, jsonSchema, tool, type ModelMessage, type JSONSchema7, type LanguageModel } from 'ai'
import type { LunaExecutionContext, LunaMessage, LunaProviderResponse, LunaToolDefinition, LunaToolResult } from './contracts'
import { GroqProviderError } from './providers/groqProvider'
import { sdkMessages } from './providers/groqSdkProvider'
import { agentToolMessage } from './agentContext'
import { matchesToolSchema } from './toolSchema'

type LanguageModelV3 = Extract<LanguageModel, { specificationVersion: 'v3' }>
type LanguageModelV3Prompt = Parameters<LanguageModelV3['doGenerate']>[0]['prompt']

export function lunaMessages(prompt: LanguageModelV3Prompt | readonly ModelMessage[]): LunaMessage[] {
  return prompt.flatMap((message): LunaMessage[] => {
    if (typeof message.content === 'string') return [{ role: message.role, content: message.content }]
    if (message.role === 'tool') return message.content.map(part => {
      if (part.type !== 'tool-result') throw new GroqProviderError('GROQ_RESPONSE_INVALID')
      return { role: 'tool', tool_call_id: part.toolCallId, content: 'value' in part.output ? typeof part.output.value === 'string' ? part.output.value : JSON.stringify(part.output.value) : JSON.stringify(part.output) }
    })
    const texts = message.content.filter(part => part.type === 'text').map(part => part.text)
    const calls = message.content.filter(part => part.type === 'tool-call').map(part => ({ id: part.toolCallId, type: 'function' as const, function: { name: part.toolName, arguments: JSON.stringify(part.input) } }))
    // No reasoning, attachments or tool-approval payload is forwarded to this
    // text-only operational agent. WhatsApp approval belongs to the domain.
    if (message.content.some(part => !['text', 'tool-call'].includes(part.type))) throw new GroqProviderError('GROQ_RESPONSE_INVALID')
    return [{ role: message.role, content: texts.join('\n') || null, ...(calls.length ? { tool_calls: calls } : {}) }]
  })
}

export async function runSdkAgent(options: {
  model: string
  definitions: readonly LunaToolDefinition[]
  messages: readonly LunaMessage[]
  traceId: string
  context: LunaExecutionContext
  allowEmptyFixtureHistory?: boolean
  prepare(messages: readonly LunaMessage[]): Promise<{ messages: readonly LunaMessage[]; tools: readonly LunaToolDefinition[] }>
  infer(request: { messages: readonly LunaMessage[]; tools: readonly LunaToolDefinition[]; toolChoice: 'required' }): Promise<LunaProviderResponse>
  execute(name: string, args: Record<string, unknown>, id: string, context: LunaExecutionContext): Promise<LunaToolResult>
  finished(): boolean
}): Promise<void> {
  let current: readonly LunaToolDefinition[] = options.definitions
  let fatal: unknown = null
  let serial: Promise<unknown> = Promise.resolve()
  const model: LanguageModelV3 = {
    specificationVersion: 'v3', provider: 'luna-metered', modelId: options.model, supportedUrls: {},
    async doGenerate(call) {
      if (fatal) throw fatal
      const response = await options.infer({ messages: lunaMessages(call.prompt), tools: current, toolChoice: 'required' })
      // Validate the WHOLE batch before the SDK can dispatch any command.
      if (new Set(response.toolCalls.map(c => c.id)).size !== response.toolCalls.length || response.toolCalls.some(c => !current.some(d => d.name === c.function.name))
        || (response.toolCalls.some(c => c.function.name === 'finish_turn') && response.toolCalls.length !== 1)) throw new GroqProviderError('GROQ_RESPONSE_INVALID')
      for (const call of response.toolCalls) {
        let args: unknown
        try { args = JSON.parse(call.function.arguments) } catch { throw new GroqProviderError('GROQ_RESPONSE_INVALID') }
        if (!matchesToolSchema(args, current.find(d => d.name === call.function.name)!.parameters)) throw new GroqProviderError('GROQ_RESPONSE_INVALID')
      }
      return {
        content: [...(response.content ? [{ type: 'text' as const, text: response.content }] : []), ...response.toolCalls.map(c => ({ type: 'tool-call' as const, toolCallId: c.id, toolName: c.function.name, input: c.function.arguments }))],
        finishReason: { unified: response.toolCalls.length ? 'tool-calls' as const : 'stop' as const, raw: undefined },
        usage: { inputTokens: { total: response.usage.promptTokens, noCache: response.usage.promptTokens, cacheRead: undefined, cacheWrite: undefined }, outputTokens: { total: response.usage.completionTokens, text: response.usage.completionTokens, reasoning: undefined } }, warnings: [],
      }
    },
    doStream() { throw new Error('LUNA_UNVERIFIED_STREAM_DISABLED') },
  }
  const tools = Object.fromEntries(options.definitions.map(d => [d.name, tool({
    description: d.description,
    inputSchema: jsonSchema<Record<string, unknown>>(d.parameters as JSONSchema7),
    // Context is not part of inputSchema and is never supplied by the model.
    // Validate the trusted binding again before executing even a read-only tool.
    contextSchema: jsonSchema<LunaExecutionContext>({ type: 'object' }, { validate: value => value === options.context ? { success: true, value: options.context } : { success: false, error: new Error('LUNA_TOOL_CONTEXT_INVALID') } }),
    execute: (args, { toolCallId, context }) => {
      // SDK supports parallel tools. Domain mutations intentionally run serially
      // even if a provider ignores parallelToolCalls:false. A fatal error stops
      // queued commands rather than being swallowed as a retryable tool result.
      const execution = serial.then(async () => {
        if (fatal) throw fatal
        try { return await options.execute(d.name, args, toolCallId, context) }
        catch (error) { fatal = error; throw error }
      })
      serial = execution.catch(() => undefined)
      return execution
    },
    toModelOutput: ({ output }) => ({ type: 'text', value: agentToolMessage(d.name, output as LunaToolResult) }),
  })]))
  const agent = new ToolLoopAgent({
    // The metered provider requests tools, but a legacy/plain completion may
    // still need the domain's factual fallback. SDK must not discard a reply
    // already verified/rendered by that boundary for missing a terminal tool.
    model, tools, maxRetries: 0, toolChoice: 'auto',
    // SDK's default is 20. The existing metered inference boundary also enforces
    // six total calls INCLUDING factual repair; stop conditions are not budgets.
    stopWhen: [isStepCount(6), () => options.finished() || fatal !== null],
    runtimeContext: { traceId: options.traceId },
    toolsContext: Object.fromEntries(options.definitions.map(d => [d.name, options.context])),
    telemetry: { isEnabled: false, recordInputs: false, recordOutputs: false },
    prepareStep: async ({ messages }) => {
      const prepared = await options.prepare(lunaMessages(messages))
      current = prepared.tools
      return { instructions: prepared.messages.filter(m => m.role === 'system').map(m => m.content ?? '').join('\n\n'), messages: sdkMessages(prepared.messages.filter(m => m.role !== 'system'), options.definitions, false), activeTools: current.map(d => d.name) }
    },
    onStepEnd: ({ toolCalls }) => {
      if (toolCalls.some(c => c.invalid)) fatal = new GroqProviderError('GROQ_RESPONSE_INVALID')
    },
  })
  const history = sdkMessages(options.messages.filter(m => m.role !== 'system'), options.definitions, false)
  // Old unit fixtures predate persisted inbound messages. This scaffold is
  // test-only; production never fabricates a customer message or confirmation.
  if (!history.length && options.allowEmptyFixtureHistory) history.push({ role: 'user', content: '[Fixture sem histórico; usar somente o provedor simulado.]' })
  await agent.generate({ messages: history })
  if (fatal) throw fatal
}
