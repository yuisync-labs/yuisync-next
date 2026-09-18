import type {
  LunaMessage,
  LunaProviderResponse,
  LunaToolDefinition,
} from '../contracts'

export class GroqProviderError extends Error {
  readonly code:
    | 'GROQ_NOT_CONFIGURED'
    | 'GROQ_RATE_LIMITED'
    | 'GROQ_UNAUTHORIZED'
    | 'GROQ_REQUEST_INVALID'
    | 'GROQ_TIMEOUT'
    | 'GROQ_UNAVAILABLE'
    | 'GROQ_REQUEST_FAILED'
    | 'GROQ_RESPONSE_INVALID'
  readonly retryAfter: string | null

  constructor(code: GroqProviderError['code'], retryAfter: string | null = null) {
    super(code)
    this.name = 'GroqProviderError'
    this.code = code
    this.retryAfter = retryAfter
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
  const value = Number(headers.get(name))
  return Number.isFinite(value) && value >= 0 ? value : null
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

  async complete(input: {
    messages: readonly LunaMessage[]
    tools: readonly LunaToolDefinition[]
    maxCompletionTokens?: number
  }): Promise<LunaProviderResponse & { requestLimit: number | null; tokenLimit: number | null }> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs)
    let response: Response
    try {
      response = await this.fetchFn('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: this.model,
          temperature: 0.2,
          max_completion_tokens: Math.max(128, Math.min(1_200, input.maxCompletionTokens ?? 600)),
          parallel_tool_calls: false,
          messages: input.messages,
          tools: input.tools.map((tool) => ({
            type: 'function',
            function: {
              name: tool.name,
              description: tool.description,
              parameters: tool.parameters,
            },
          })),
          tool_choice: 'auto',
        }),
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

    if (response.status === 429) {
      throw new GroqProviderError('GROQ_RATE_LIMITED', response.headers.get('retry-after'))
    }
    if (response.status === 401 || response.status === 403) throw new GroqProviderError('GROQ_UNAUTHORIZED')
    if (response.status === 400 || response.status === 404) throw new GroqProviderError('GROQ_REQUEST_INVALID')
    if (response.status >= 500) throw new GroqProviderError('GROQ_UNAVAILABLE')
    if (!response.ok) throw new GroqProviderError('GROQ_REQUEST_FAILED')

    let body: GroqResponseBody
    try { body = await response.json() as GroqResponseBody } catch { throw new GroqProviderError('GROQ_RESPONSE_INVALID') }
    const message = body.choices?.[0]?.message
    if (!message) throw new GroqProviderError('GROQ_RESPONSE_INVALID')
    const toolCalls = (message.tool_calls || []).map((call) => ({
      id: String(call.id || ''),
      type: 'function' as const,
      function: {
        name: String(call.function?.name || ''),
        arguments: String(call.function?.arguments || '{}'),
      },
    })).filter((call) => call.id && call.function.name)

    return {
      content: typeof message.content === 'string' ? message.content.trim() || null : null,
      toolCalls,
      usage: {
        promptTokens: Math.max(0, Number(body.usage?.prompt_tokens || 0)),
        completionTokens: Math.max(0, Number(body.usage?.completion_tokens || 0)),
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
