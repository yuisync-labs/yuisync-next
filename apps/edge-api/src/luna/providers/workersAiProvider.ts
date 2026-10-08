import type { createWorkersAI } from 'workers-ai-provider'
import type { JSONSchema7 } from 'ai'
import type { LunaMessage, LunaToolDefinition, LunaProviderResponse, LunaProviderUsage } from '../contracts'
import { sdkMessages } from './groqSdkProvider'
import { matchesToolSchema } from '../toolSchema'
import { LunaProviderError } from './providerError'

export const GLM_FLASH_MODEL = '@cf/zai-org/glm-4.7-flash'
type Input = { messages: readonly LunaMessage[]; tools: readonly LunaToolDefinition[]; maxCompletionTokens?: number; toolChoice?: 'auto' | 'required' }
type Model = ReturnType<ReturnType<typeof createWorkersAI>>
type Prompt = Parameters<Model['doGenerate']>[0]['prompt']

export function glmNeurons(usage: LunaProviderUsage) {
  return (usage.promptTokens * 5500 + usage.completionTokens * 36400) / 1_000_000
}

// Exactly one native binding call per journal step. No SDK loop, retry,
// provider fallback, tool execution, or raw reasoning persistence here.
export class WorkersAiProvider {
  readonly model = GLM_FLASH_MODEL
  readonly operationalReplies = true
  constructor(private readonly binding: Ai, private readonly timeoutMs = 30000) {}
  reservationTokens(input: Input) {
    return new TextEncoder().encode(JSON.stringify(input)).length + 4096 + 1200
  }
  async complete(input: Input): Promise<LunaProviderResponse & { requestLimit: null; tokenLimit: null }> {
    let knownUsage: LunaProviderUsage | null = null
    let nativeCalls: {id: string; name: string; args: unknown}[] = []
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), Math.max(1000, Math.min(60000, this.timeoutMs)))
    // Intercept only this model's run boundary to reject missing usage before
    // the SDK's mapper can silently substitute zero. Other binding APIs stay bound.
    const binding = new Proxy(this.binding, {get: (target, key) => key === 'run'
      ? async (...args: Parameters<Ai['run']>) => {
        const output = await target.run(args[0], {...args[1], parallel_tool_calls: false}, args[2])
        const raw = output as {usage?: {prompt_tokens?: number; completion_tokens?: number}}
        const p = raw?.usage?.prompt_tokens, c = raw?.usage?.completion_tokens
        if (!Number.isSafeInteger(p) || Number(p) < 0 || !Number.isSafeInteger(c) || Number(c) < 0) throw new LunaProviderError('WORKERS_AI_USAGE_UNAVAILABLE')
        knownUsage = {promptTokens: p!, completionTokens: c!}
        // A completion containing tool-shaped text must not be salvaged by
        // a provider into an executable tool call. Structured calls only.
        const choices = (output as {choices?: {message?: {tool_calls?: {id?: unknown; type?: unknown; function?: {name?: unknown; arguments?: unknown}}[]}}[]}).choices
        const rawCalls = choices?.[0]?.message?.tool_calls ?? []
        if (!Array.isArray(rawCalls)) throw new LunaProviderError('WORKERS_AI_RESPONSE_INVALID', null, knownUsage)
        nativeCalls = rawCalls.map(call => {
          if (!call || typeof call.id !== 'string' || !call.id || call.type !== 'function' || typeof call.function?.name !== 'string' || typeof call.function.arguments !== 'string') throw new LunaProviderError('WORKERS_AI_RESPONSE_INVALID', null, knownUsage)
          let args: unknown
          try {args = JSON.parse(call.function.arguments)} catch {throw new LunaProviderError('WORKERS_AI_RESPONSE_INVALID', null, knownUsage)}
          const definition = input.tools.find(t => t.name === call.function!.name)
          if (!definition || !matchesToolSchema(args, definition.parameters)) throw new LunaProviderError('WORKERS_AI_RESPONSE_INVALID', null, knownUsage)
          return {id: call.id, name: call.function.name, args}
        })
        if (new Set(nativeCalls.map(c => c.id)).size !== nativeCalls.length || (input.toolChoice === 'required' && !nativeCalls.length)) throw new LunaProviderError('WORKERS_AI_RESPONSE_INVALID', null, knownUsage)
        return output
      }
      : typeof Reflect.get(target, key) === 'function' ? Reflect.get(target, key).bind(target) : Reflect.get(target, key)})
    try {
      const {createWorkersAI} = await import('workers-ai-provider')
      const sdk = createWorkersAI({binding})
      const prompt = sdkMessages(input.messages, input.tools, false).map(m => m.role === 'system' ? m : {...m, content: typeof m.content === 'string' ? [{type: 'text', text: m.content}] : m.content}) as Prompt
      const result = await sdk(this.model, {chat_template_kwargs: {enable_thinking: false, clear_thinking: true}}).doGenerate({
        prompt, tools: input.tools.map(t => ({type: 'function', name: t.name, description: t.description, inputSchema: t.parameters as JSONSchema7})),
        toolChoice: {type: input.toolChoice ?? 'auto'}, maxOutputTokens: Math.max(128, Math.min(1200, input.maxCompletionTokens ?? 1200)),
        temperature: 0.2, abortSignal: controller.signal,
      })
      if (!knownUsage) throw new LunaProviderError('WORKERS_AI_USAGE_UNAVAILABLE')
      const sdkCalls = result.content.filter(p => p.type === 'tool-call')
      if (sdkCalls.length !== nativeCalls.length) throw new LunaProviderError('WORKERS_AI_RESPONSE_INVALID', null, knownUsage)
      const calls = sdkCalls.map((p, index) => {
        const definition = input.tools.find(t => t.name === p.toolName)
        let args: unknown
        try {args = JSON.parse(p.input)} catch {throw new LunaProviderError('WORKERS_AI_RESPONSE_INVALID', null, knownUsage)}
        const native = nativeCalls[index]
        // The official adapter adds a private suffix to each tool ID. Match
        // the full structured batch instead and retain the provider's real ID.
        if (!definition || p.providerExecuted || native.name !== p.toolName || JSON.stringify(native.args) !== JSON.stringify(args) || !matchesToolSchema(args, definition.parameters)) throw new LunaProviderError('WORKERS_AI_RESPONSE_INVALID', null, knownUsage)
        return {id: native.id, type: 'function' as const, function: {name: p.toolName, arguments: JSON.stringify(args)}}
      })
      const text = result.content.filter(p => p.type === 'text').map(p => p.text).join('\n').trim()
      if ((!text && !calls.length) || new Set(calls.map(c => c.id)).size !== calls.length || (input.toolChoice === 'required' && !calls.length)) throw new LunaProviderError('WORKERS_AI_RESPONSE_INVALID', null, knownUsage)
      return {content: text || null, toolCalls: calls, usage: knownUsage, requestLimit: null, tokenLimit: null,
        rateLimit: {remainingRequests: null, remainingTokens: null, resetRequests: null, resetTokens: null}}
    } catch (error) {
      // The official SDK wraps binding failures; only bounded status metadata
      // is used, never its echoed requestBodyValues or raw message.
      if (error instanceof LunaProviderError) throw error
      const e = error as {statusCode?: number; cause?: unknown; responseHeaders?: Record<string, string>}
      if (e.cause instanceof LunaProviderError) throw e.cause
      const cause = e.cause as {statusCode?: number; status?: number} | undefined
      const status = e.statusCode ?? cause?.statusCode ?? cause?.status
      const code = controller.signal.aborted ? 'WORKERS_AI_TIMEOUT' : status === 429 ? 'WORKERS_AI_RATE_LIMITED'
        : status === 401 || status === 403 ? 'WORKERS_AI_UNAUTHORIZED' : status === 400 || status === 404 ? 'WORKERS_AI_REQUEST_INVALID'
        : Number(status) >= 500 ? 'WORKERS_AI_UNAVAILABLE' : 'WORKERS_AI_REQUEST_FAILED'
      throw new LunaProviderError(code, e.responseHeaders?.['retry-after'] ?? null, knownUsage)
    } finally {clearTimeout(timeout)}
  }
}
