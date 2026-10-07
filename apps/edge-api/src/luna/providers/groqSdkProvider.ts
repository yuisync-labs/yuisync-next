import { createGroq } from '@ai-sdk/groq'
import type { ModelMessage, JSONSchema7 } from 'ai'
import type { LunaMessage, LunaToolDefinition, LunaProviderResponse } from '../contracts'
import { GroqProvider, GroqProviderError } from './groqProvider'
import { groqDiagnostic } from './groqDiagnostic'
import { compactToolSchema } from './compactSchema'
import { strictGroqToolSchema, groqWireToolSchema, groqWireToolDescription, groqWireToolArguments, normalizeGroqWireArguments } from './groqToolSchema'
import { matchesToolSchema } from '../toolSchema'

type Request = Parameters<GroqProvider['complete']>[0]
type GroqPrompt = Parameters<ReturnType<ReturnType<typeof createGroq>>['doGenerate']>[0]['prompt']

export function sdkMessages(messages: readonly LunaMessage[], definitions: readonly LunaToolDefinition[]): ModelMessage[] {
  const names = new Map(messages.flatMap(m => (m.tool_calls ?? []).map(c => [c.id, c.function.name] as const)))
  return messages.map(m => {
    if (m.role === 'tool') {
      const name = names.get(m.tool_call_id ?? '')
      if (!name) throw new GroqProviderError('GROQ_RESPONSE_INVALID')
      return { role: 'tool', content: [{ type: 'tool-result', toolCallId: m.tool_call_id!, toolName: name, output: { type: 'text', value: m.content ?? '' } }] }
    }
    if (m.role === 'assistant' && m.tool_calls?.length) return {
      role: 'assistant', content: [
        ...(m.content ? [{ type: 'text' as const, text: m.content }] : []),
        ...m.tool_calls.map(c => {
          const definition = definitions.find(d => d.name === c.function.name)
          const raw = definition ? groqWireToolArguments(c.function.arguments, definition.parameters) : c.function.arguments
          return { type: 'tool-call' as const, toolCallId: c.id, toolName: c.function.name, input: JSON.parse(raw) }
        }),
      ],
    }
    return { role: m.role, content: m.content ?? '' }
  })
}

// Single-call transport beneath ToolLoopAgent. The provider's doGenerate owns
// HTTP/protocol parsing; it does not start a second SDK loop or execute tools.
// Existing quota-ledger wrappers still meter exactly one complete = one request.
export class GroqSdkProvider extends GroqProvider {
  readonly operationalReplies = true
  private readonly options: { apiKey?: string; model?: string; timeoutMs?: number; fetchFn?: typeof fetch }
  constructor(options: { apiKey?: string; model?: string; timeoutMs?: number; fetchFn?: typeof fetch }) {
    super(options)
    this.options = options
  }

  override async complete(input: Request): Promise<LunaProviderResponse & { requestLimit: number | null; tokenLimit: number | null }> {
    let headers = new Headers(), knownUsage: GroqProviderError['usage'] = null
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), Math.max(1000, Math.min(60000, this.options.timeoutMs ?? 30000)))
    const isOss = /^openai\/gpt-oss-/.test(this.model)
    const sdk = createGroq({ apiKey: this.options.apiKey, fetch: async (url, init) => {
      const body = JSON.parse(String(init?.body))
      // The provider does not expose include_reasoning yet. Never request or
      // retain private reasoning; preserve the tested GPT-OSS wire options.
      if (isOss) { delete body.reasoning_format; body.include_reasoning = false }
      body.max_completion_tokens = body.max_tokens; delete body.max_tokens
      const response = await (this.options.fetchFn ?? ((u, i) => globalThis.fetch(u, i)))(url, { ...init, body: JSON.stringify(body) })
      headers = response.headers
      if (!response.ok) {
        let detail: Record<string, unknown> = {}
        try { detail = (await response.clone().json() as { error?: Record<string, unknown> }).error ?? {} } catch { /* no raw error exposure */ }
        const code = response.status === 429 ? 'GROQ_RATE_LIMITED' : [401,403].includes(response.status) ? 'GROQ_UNAUTHORIZED' : [400,404].includes(response.status) ? 'GROQ_REQUEST_INVALID' : response.status >= 500 ? 'GROQ_UNAVAILABLE' : 'GROQ_REQUEST_FAILED'
        throw new GroqProviderError(code, response.headers.get('retry-after'), groqDiagnostic(detail,response.status,input.tools.map(t=>t.name),input.tools.map(t=>groqWireToolSchema(t.parameters))))
      }
      try {
        const usage = (await response.clone().json() as { usage?: { prompt_tokens?: number; completion_tokens?: number } }).usage
        if (Number.isSafeInteger(usage?.prompt_tokens) && Number(usage?.prompt_tokens) >= 0 && Number.isSafeInteger(usage?.completion_tokens) && Number(usage?.completion_tokens) >= 0) knownUsage = { promptTokens: usage!.prompt_tokens!, completionTokens: usage!.completion_tokens! }
      } catch { /* SDK will reject malformed JSON */ }
      return response
    } })
    try {
      const tools = input.tools.map(d => ({
        type: 'function' as const, name: d.name,
        description: groqWireToolDescription(d.description),
        inputSchema: compactToolSchema(isOss ? strictGroqToolSchema(groqWireToolSchema(d.parameters)) : groqWireToolSchema(d.parameters)) as JSONSchema7,
        ...(isOss ? { strict: true } : {}),
      }))
      const prompt = sdkMessages(input.messages, input.tools).map(m => m.role === 'system' ? m : { ...m, content: typeof m.content === 'string' ? [{ type: 'text', text: m.content }] : m.content }) as GroqPrompt
      const result = await sdk(this.model).doGenerate({
        prompt, tools,
        toolChoice: { type: input.toolChoice ?? 'auto' }, abortSignal: controller.signal,
        maxOutputTokens: Math.max(128,Math.min(1200,input.maxCompletionTokens ?? 1200)), temperature: 0.2,
        providerOptions: { groq: { parallelToolCalls: false, reasoningEffort: 'low', ...(!isOss ? { reasoningFormat: 'hidden' } : {}) } },
      })
      if (!knownUsage) throw new GroqProviderError('GROQ_USAGE_UNAVAILABLE')
      const toolCalls = result.content.filter(c => c.type === 'tool-call').map(c => {
        const d = input.tools.find(t=>t.name===c.toolName)
        if (!d || c.providerExecuted) throw new GroqProviderError('GROQ_RESPONSE_INVALID')
        const args = normalizeGroqWireArguments(c.input,d.parameters)
        if (!matchesToolSchema(JSON.parse(args), d.parameters)) throw new GroqProviderError('GROQ_RESPONSE_INVALID')
        return { id:c.toolCallId,type:'function' as const,function:{name:c.toolName,arguments:args} }
      })
      const text = result.content.filter(c => c.type === 'text').map(c => c.text).join('\n').trim()
      if (new Set(toolCalls.map(c=>c.id)).size !== toolCalls.length || (!text && !toolCalls.length) || (input.toolChoice==='required'&&!toolCalls.length)) throw new GroqProviderError('GROQ_RESPONSE_INVALID')
      const integer = (key:string) => { const raw=headers.get(key); const value=Number(raw); return raw?.trim()&&Number.isSafeInteger(value)&&value>=0 ? value : null }
      return { content:text||null,toolCalls,usage:knownUsage,requestLimit:integer('x-ratelimit-limit-requests'),tokenLimit:integer('x-ratelimit-limit-tokens'),rateLimit:{remainingRequests:integer('x-ratelimit-remaining-requests'),remainingTokens:integer('x-ratelimit-remaining-tokens'),resetRequests:headers.get('x-ratelimit-reset-requests'),resetTokens:headers.get('x-ratelimit-reset-tokens')} }
    } catch (error) {
      if (error instanceof GroqProviderError && error.code !== 'GROQ_RESPONSE_INVALID') throw error
      const code = controller.signal.aborted ? 'GROQ_TIMEOUT' : knownUsage ? 'GROQ_RESPONSE_INVALID' : 'GROQ_REQUEST_FAILED'
      throw new GroqProviderError(code,null,null,{usage:knownUsage,responseShape:null})
    } finally { clearTimeout(timeout) }
  }
}
