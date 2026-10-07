import type {
  LunaMessage,
  LunaProviderResponse,
  LunaToolDefinition,
} from '../contracts'
import { strictGroqToolSchema, normalizeGroqToolArguments } from './groqToolSchema'
import { groqDiagnostic } from './groqDiagnostic'
import { compactToolSchema } from './compactSchema'

export class GroqProviderError extends Error {
  readonly diagnostic: ReturnType<typeof groqDiagnostic> | null
  readonly code:
    | 'GROQ_NOT_CONFIGURED'
    | 'GROQ_RATE_LIMITED'
    | 'GROQ_UNAUTHORIZED'
    | 'GROQ_REQUEST_INVALID'
    | 'GROQ_TIMEOUT'
    | 'GROQ_UNAVAILABLE'
    | 'GROQ_REQUEST_FAILED'
    | 'GROQ_RESPONSE_INVALID'
    | 'GROQ_USAGE_UNAVAILABLE'
  readonly retryAfter: string | null
  readonly usage: { promptTokens: number; completionTokens: number } | null
  readonly responseShape: { messagePresent: boolean; finishReason: string | null; contentPresent: boolean; toolCount: number } | null

  constructor(code: GroqProviderError['code'], retryAfter: string | null = null, diagnostic: GroqProviderError['diagnostic'] = null, metadata?: {usage: GroqProviderError['usage']; responseShape: GroqProviderError['responseShape']}) {
    super(code)
    this.name = 'GroqProviderError'
    this.code = code
    this.retryAfter = retryAfter
    this.diagnostic = diagnostic
    this.usage = metadata?.usage ?? null
    this.responseShape = metadata?.responseShape ?? null
  }
}

type GroqProviderOptions = Readonly<{
  apiKey?: string
  model?: string
  timeoutMs?: number
  fetchFn?: typeof fetch
}>

type GroqResponseBody = {
  choices?: Array<{
    finish_reason?: string
    message?: {
      content?: string | null
      tool_calls?: Array<{
        id?: string
        type?: string
        function?: { name?: string; arguments?: string }
      }>
    }
  }>
  usage?: { prompt_tokens?: number; completion_tokens?: number }
}

function integerHeader(headers: Headers, name: string): number | null {
  const raw = headers.get(name)
  if (raw == null || !raw.trim()) return null
  const value = Number(raw)
  return Number.isSafeInteger(value) && value >= 0 ? value : null
}

export class GroqProvider {
  readonly model: string
  private readonly apiKey: string
  private readonly timeoutMs: number
  private readonly fetchFn: typeof fetch

  constructor(options: GroqProviderOptions) {
    this.apiKey = String(options.apiKey || '').trim()
    this.model = String(options.model || '').trim()
    this.timeoutMs = Math.max(1_000, Math.min(60_000, options.timeoutMs ?? 30_000))
    // Keep the Workers global fetch receiver intact. Storing `fetch` directly
    // and later invoking it as `this.fetchFn(...)` binds the provider instance
    // as its receiver and can fail before an HTTP response is produced.
    this.fetchFn = options.fetchFn ?? ((input, init) => globalThis.fetch(input, init))
    if (!this.apiKey || !this.model) throw new GroqProviderError('GROQ_NOT_CONFIGURED')
  }

  serializeRequest(input: {
    messages: readonly LunaMessage[]
    tools: readonly LunaToolDefinition[]
    maxCompletionTokens?: number
  }): string {
    return JSON.stringify({
          model: this.model,
          temperature: 0.2,
          // GPT-OSS uses include_reasoning, not reasoning_format. The latter
          // is unsupported for these models and can reject the request with
          // HTTP 400. Keep private reasoning out of all response transcripts.
          ...(/^openai\/gpt-oss-(?:20b|120b|safeguard-20b)$/.test(this.model)
            ? { include_reasoning: false }
            : { reasoning_format: 'hidden' }),
          reasoning_effort: 'low',
          // GPT-OSS can spend a material portion of this budget on reasoning.
          // A 600-token default occasionally ended after a tool result without
          // producing either final content or another tool call.
          max_completion_tokens: Math.max(128, Math.min(1_200, input.maxCompletionTokens ?? 1_200)),
          parallel_tool_calls: false,
          messages: input.messages,
          ...(input.tools.length ? { tools: input.tools.map((tool) => ({
            type: 'function',
            function: {
              name: tool.name,
              description: tool.description,
              parameters: compactToolSchema(/^openai\/gpt-oss-/.test(this.model) ? strictGroqToolSchema(tool.parameters) : tool.parameters),
              ...(/^openai\/gpt-oss-/.test(this.model) ? { strict: true } : {}),
            },
          })), tool_choice: 'auto' } : {}),
        })
  }

  reservationTokens(input: Parameters<GroqProvider['serializeRequest']>[0]): number {
    // Reserve the ACTUAL transformed wire body, not the smaller domain input.
    return new TextEncoder().encode(this.serializeRequest(input)).length + 4096 + 1200
  }

  async complete(input: Parameters<GroqProvider['serializeRequest']>[0]): Promise<LunaProviderResponse & { requestLimit: number | null; tokenLimit: number | null }> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs)
    let response: Response
    try {
      response = await this.fetchFn('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { authorization: `Bearer ${this.apiKey}`, 'content-type': 'application/json' },
        body: this.serializeRequest(input),
        signal: controller.signal,
      })
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new GroqProviderError('GROQ_TIMEOUT')
      }
      throw new GroqProviderError('GROQ_REQUEST_FAILED')
    } finally {
      clearTimeout(timeout)
    }

    if (!response.ok) {
      // Never expose provider message/failed_generation: these can echo private
      // prompts, customer information or credentials. Preserve only bounded
      // machine-readable diagnostic fields for an actionable certification.
      let detail: Record<string, unknown> = {}
      try { detail = (await response.json() as { error?: Record<string, unknown> }).error ?? {} } catch { /* no trustworthy detail */ }
      const diagnostic = groqDiagnostic(detail, response.status, input.tools.map(tool => tool.name))
      const code = response.status === 429 ? 'GROQ_RATE_LIMITED' : [401,403].includes(response.status) ? 'GROQ_UNAUTHORIZED' : [400,404].includes(response.status) ? 'GROQ_REQUEST_INVALID' : response.status >= 500 ? 'GROQ_UNAVAILABLE' : 'GROQ_REQUEST_FAILED'
      throw new GroqProviderError(code, response.status === 429 ? response.headers.get('retry-after') : null, diagnostic)
    }

    let body: GroqResponseBody
    try { body = await response.json() as GroqResponseBody } catch { throw new GroqProviderError('GROQ_RESPONSE_INVALID') }
    const message = body.choices?.[0]?.message
    const promptTokens = body.usage?.prompt_tokens, completionTokens = body.usage?.completion_tokens
    const knownUsage = Number.isSafeInteger(promptTokens) && Number(promptTokens) >= 0 && Number.isSafeInteger(completionTokens) && Number(completionTokens) >= 0 ? {promptTokens:promptTokens!,completionTokens:completionTokens!} : null
    const rawFinish = body.choices?.[0]?.finish_reason
    const invalidResponse = () => new GroqProviderError('GROQ_RESPONSE_INVALID',null,null,{usage:knownUsage,responseShape:{messagePresent:!!message,finishReason:['stop','length','tool_calls','content_filter'].includes(rawFinish ?? '') ? rawFinish! : null,contentPresent:typeof message?.content==='string' && !!message.content.trim(),toolCount:Array.isArray(message?.tool_calls) ? Math.min(100,message.tool_calls.length) : 0}})
    if (!message) throw invalidResponse()
    const toolCalls = (message.tool_calls || []).map((call) => ({
      id: String(call.id || ''),
      type: 'function' as const,
      function: {
        name: String(call.function?.name || ''),
          arguments: (() => {
            const raw = String(call.function?.arguments || '{}')
            const definition = input.tools.find(tool => tool.name === call.function?.name)
            return /^openai\/gpt-oss-/.test(this.model) && definition ? normalizeGroqToolArguments(raw, definition.parameters) : raw
          })(),
      },
    })).filter((call) => call.id && call.function.name)
    const content = typeof message.content === 'string' ? message.content.trim() || null : null
    if (!content && toolCalls.length === 0) throw invalidResponse()
    if (new Set(toolCalls.map(call => call.id)).size !== toolCalls.length) throw invalidResponse()
    if (!Number.isSafeInteger(promptTokens) || Number(promptTokens) < 0 || !Number.isSafeInteger(completionTokens) || Number(completionTokens) < 0) throw new GroqProviderError('GROQ_USAGE_UNAVAILABLE')

    return {
      content,
      toolCalls,
      usage: {
        promptTokens: promptTokens!,
        completionTokens: completionTokens!,
      },
      rateLimit: {
        remainingRequests: integerHeader(response.headers, 'x-ratelimit-remaining-requests'),
        remainingTokens: integerHeader(response.headers, 'x-ratelimit-remaining-tokens'),
        resetRequests: response.headers.get('x-ratelimit-reset-requests'),
        resetTokens: response.headers.get('x-ratelimit-reset-tokens'),
      },
      requestLimit: integerHeader(response.headers, 'x-ratelimit-limit-requests'),
      tokenLimit: integerHeader(response.headers, 'x-ratelimit-limit-tokens'),
    }
  }
}
