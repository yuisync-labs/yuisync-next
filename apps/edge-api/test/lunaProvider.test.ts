import { describe, expect, it, vi } from 'vitest'

import { GroqProvider } from '../src/luna/providers/groqProvider'
import { createLunaBudget, LunaBudgetError } from '../src/luna/quotaBudget'

describe('Luna Groq provider and budget', () => {
  it('normaliza resposta, chamada de ferramenta, uso e limites', async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: null, tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'search_services', arguments: '{"query":"banho"}' } }] } }],
      usage: { prompt_tokens: 120, completion_tokens: 30 },
    }), {
      status: 200,
      headers: {
        'content-type': 'application/json',
        'x-ratelimit-limit-requests': '1000',
        'x-ratelimit-remaining-requests': '950',
        'x-ratelimit-limit-tokens': '8000',
        'x-ratelimit-remaining-tokens': '7900',
      },
    }))
    const provider = new GroqProvider({ apiKey: 'test-key', model: 'test-model', fetchFn })
    const response = await provider.complete({
      messages: [{ role: 'user', content: 'Quero banho' }],
      tools: [{ name: 'search_services', description: 'Busca serviços', parameters: { type: 'object' } }],
    })
    expect(response.toolCalls[0]?.function.name).toBe('search_services')
    expect(response.usage).toEqual({ promptTokens: 120, completionTokens: 30 })
    expect(response.rateLimit.remainingRequests).toBe(950)
    expect(response.tokenLimit).toBe(8000)
    expect(fetchFn).toHaveBeenCalledOnce()
  })

  it('interrompe imediatamente ao receber limite do provedor', async () => {
    const provider = new GroqProvider({
      apiKey: 'test-key', model: 'test-model',
      fetchFn: vi.fn(async () => new Response('{}', { status: 429, headers: { 'retry-after': '60' } })),
    })
    await expect(provider.complete({ messages: [], tools: [] })).rejects.toMatchObject({
      code: 'GROQ_RATE_LIMITED', retryAfter: '60',
    })
  })

  it('preserva margem de vinte por cento da cota de requests', () => {
    const budget = createLunaBudget({ minimumRemainingPercent: 20 })
    budget.beforeModel()
    expect(() => budget.afterModel({ promptTokens: 20, completionTokens: 10, remainingRequests: 19, requestLimit: 100 }))
      .toThrowError(LunaBudgetError)
  })

  it('preserva margem de vinte por cento da cota de tokens', () => {
    const budget = createLunaBudget({ minimumRemainingPercent: 20 })
    budget.beforeModel()
    expect(() => budget.afterModel({
      promptTokens: 20, completionTokens: 10, remainingRequests: 90, requestLimit: 100,
      remainingTokens: 199, tokenLimit: 1000,
    })).toThrowError(LunaBudgetError)
  })
})
