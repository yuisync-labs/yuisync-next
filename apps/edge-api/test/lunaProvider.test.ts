import { describe, expect, it, vi } from 'vitest'

import { GroqProvider } from '../src/luna/providers/groqProvider'
import { createLunaBudget, LunaBudgetError } from '../src/luna/quotaBudget'

describe('Luna Groq provider and budget', () => {
  it('preserva uso conhecido de completion vazia e diagnostica somente a forma, sem raciocínio privado', async () => {
    const provider=new GroqProvider({apiKey:'fixture',model:'openai/gpt-oss-20b',fetchFn:async()=>new Response(JSON.stringify({choices:[{finish_reason:'length',message:{content:null,reasoning:'private reasoning'}}],usage:{prompt_tokens:400,completion_tokens:1200}}),{status:200})})
    await expect(provider.complete({messages:[{role:'user',content:'oi'}],tools:[]})).rejects.toMatchObject({code:'GROQ_RESPONSE_INVALID',usage:{promptTokens:400,completionTokens:1200},responseShape:{messagePresent:true,finishReason:'length',contentPresent:false,toolCount:0}})
    try { await provider.complete({messages:[],tools:[]}) } catch(error) { expect(JSON.stringify(error)).not.toContain('private reasoning') }
  })
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

  it.each([
    [401, 'GROQ_UNAUTHORIZED'],
    [400, 'GROQ_REQUEST_INVALID'],
    [503, 'GROQ_UNAVAILABLE'],
  ])('classifica resposta HTTP %s sem expor o corpo do provedor', async (status, code) => {
    const provider = new GroqProvider({
      apiKey: 'test-key', model: 'test-model',
      fetchFn: vi.fn(async () => new Response('{"sensitive":"provider detail"}', { status })),
    })
    await expect(provider.complete({ messages: [], tools: [] })).rejects.toMatchObject({ code })
  })

  it('classifica timeout por nome sem depender da classe DOMException do runtime', async () => {
    const timeout = new Error('provider detail must stay private')
    timeout.name = 'AbortError'
    const provider = new GroqProvider({
      apiKey: 'test-key', model: 'test-model',
      fetchFn: vi.fn(async () => { throw timeout }),
    })
    await expect(provider.complete({ messages: [], tools: [] })).rejects.toMatchObject({ code: 'GROQ_TIMEOUT' })
  })

  it('rejeita resposta vazia do modelo em vez de concluir o turno sem diagnóstico', async () => {
    const provider = new GroqProvider({
      apiKey: 'test-key', model: 'test-model',
      fetchFn: vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: null } }] }), { status: 200 })),
    })
    await expect(provider.complete({ messages: [], tools: [] })).rejects.toMatchObject({ code: 'GROQ_RESPONSE_INVALID' })
  })

  it('reserva 1.200 tokens por padrão para modelos com raciocínio', async () => {
    const fetchFn = vi.fn(async (_input: Parameters<typeof fetch>[0], _init?: Parameters<typeof fetch>[1]) => (
      new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }], usage: { prompt_tokens: 10, completion_tokens: 10 } }), { status: 200 })
    ))
    const provider = new GroqProvider({ apiKey: 'test-key', model: 'test-model', fetchFn })
    await provider.complete({ messages: [], tools: [] })
    const init = fetchFn.mock.calls[0]?.[1]
    expect(JSON.parse(String(init?.body))).toMatchObject({
      max_completion_tokens: 1_200,
      reasoning_format: 'hidden',
      reasoning_effort: 'low',
    })
  })

  it('preserva diagnóstico técnico limitado sem mensagem, geração ou credencial', async () => {
    const provider = new GroqProvider({apiKey:'test-key',model:'test-model',fetchFn:async()=>new Response(JSON.stringify({error:{type:'invalid_request_error',code:'tool_use_failed',param:'tools[0].function',message:'private prompt',failed_generation:'private generation'}}),{status:400})})
    await expect(provider.complete({messages:[],tools:[]})).rejects.toMatchObject({code:'GROQ_REQUEST_INVALID',diagnostic:{status:400,type:'invalid_request_error',code:'tool_use_failed',param:'tools[0].function'}})
    const unsafe = new GroqProvider({apiKey:'test-key',model:'test-model',fetchFn:async()=>new Response(JSON.stringify({error:{type:'user@example.com',code:'gsk_private',param:'customer information'}}),{status:400})})
    await expect(unsafe.complete({messages:[],tools:[]})).rejects.toMatchObject({diagnostic:{status:400,type:null,code:null,param:null}})
  })

  it('não trata headers ausentes como cota zero nem envia tools vazias na reformulação', async () => {
    const fetchFn = vi.fn(async (_input: Parameters<typeof fetch>[0], _init?: Parameters<typeof fetch>[1]) => new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }], usage: { prompt_tokens: 10, completion_tokens: 10 } }), { status: 200, headers: { 'x-ratelimit-limit-requests': '1000' } }))
    const provider = new GroqProvider({ apiKey: 'test-key', model: 'test-model', fetchFn })
    const response = await provider.complete({ messages: [], tools: [] })
    expect(response.rateLimit.remainingRequests).toBeNull()
    expect(response.tokenLimit).toBeNull()
    const body = JSON.parse(String(fetchFn.mock.calls[0][1]?.body))
    expect(body).not.toHaveProperty('tools')
    expect(body).not.toHaveProperty('tool_choice')
  })

  it.each(['openai/gpt-oss-20b','openai/gpt-oss-120b'])('usa configuração de raciocínio suportada por %s', async model => {
    const fetchFn=vi.fn(async (_url:Parameters<typeof fetch>[0],_init?:Parameters<typeof fetch>[1])=>new Response(JSON.stringify({choices:[{message:{content:'ok',reasoning:'private'}}],usage:{prompt_tokens:10,completion_tokens:10}}),{status:200}))
    const provider=new GroqProvider({apiKey:'test-key',model,fetchFn})
    const response=await provider.complete({messages:[],tools:[{name:'get_customer_context',description:'Identity',parameters:{type:'object',properties:{},required:[],additionalProperties:false}}]})
    const body=JSON.parse(String(fetchFn.mock.calls[0][1]?.body))
    expect(body).toMatchObject({model,include_reasoning:false,reasoning_effort:'low'})
    expect(body).not.toHaveProperty('reasoning_format')
    expect(body.tools[0].function.strict).toBe(true)
    expect(response).not.toHaveProperty('reasoning')
  })

  it.each([undefined, { prompt_tokens: -1, completion_tokens: 10 }, { prompt_tokens: 10, completion_tokens: 0.5 }])('não certifica consumo desconhecido ou inválido como zero', async usage => {
    const provider = new GroqProvider({ apiKey: 'test-key', model: 'test-model', fetchFn: async () => new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }], usage }), { status: 200 }) })
    await expect(provider.complete({ messages: [], tools: [] })).rejects.toMatchObject({ code: 'GROQ_USAGE_UNAVAILABLE' })
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
