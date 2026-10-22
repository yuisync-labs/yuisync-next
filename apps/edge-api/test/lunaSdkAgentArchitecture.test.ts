import { describe, expect, it } from 'vitest'
import { runSdkAgent } from '../src/luna/sdkAgent'
import { LunaBudgetError } from '../src/luna/quotaBudget'
import type { LunaExecutionContext, LunaProviderResponse, LunaToolDefinition } from '../src/luna/contracts'

const context: LunaExecutionContext = { tenantId: 'private-tenant', moduleId: 'petshop', conversationId: 'private-conversation', customerAddress: 'private-phone', phoneNumberId: 'fixture', sourceMessageId: 'source', traceId: 'trace', executionMode: 'fixture' }
const definitions: LunaToolDefinition[] = ['query', 'commit', 'finish_turn'].map(name => ({ name, description: name, parameters: { type: 'object', properties: {}, additionalProperties: false, required: [] } }))
const completion = (names: string[]): LunaProviderResponse => ({ content: null, toolCalls: names.map((name, i) => ({ id: `call-${i}`, type: 'function', function: { name, arguments: '{}' } })), usage: { promptTokens: 1, completionTokens: 1 }, rateLimit: { remainingRequests: null, remainingTokens: null, resetRequests: null, resetTokens: null } })
const base = { model: 'fixture', definitions, messages: [{ role: 'user' as const, content: 'Teste' }], traceId: 'trace', context, prepare: async (messages: Parameters<Parameters<typeof runSdkAgent>[0]['prepare']>[0]) => ({ messages, tools: definitions }) }

describe('AI SDK operational architecture boundaries', () => {
  it('executes provider batches serially, binds server context outside the prompt and stops without another model call', async () => {
    let finished = false, calls = 0, concurrent = 0, maximum = 0
    const order: string[] = []
    await runSdkAgent({ ...base, infer: async request => {
      calls++
      expect(JSON.stringify(request)).not.toContain('private-tenant')
      expect(JSON.stringify(request)).not.toContain('private-phone')
      return completion(['query', 'commit'])
    }, execute: async (name, _args, _id, trusted) => {
      expect(trusted).toBe(context)
      maximum = Math.max(maximum, ++concurrent)
      await Promise.resolve()
      order.push(name); concurrent--
      if (name === 'commit') finished = true
      return { ok: true, data: {} }
    }, finished: () => finished })
    expect(order).toEqual(['query', 'commit']); expect(maximum).toBe(1); expect(calls).toBe(1)
  })
  it.each([['finish_turn', 'commit'], ['query', 'invented']])('rejects an unsafe batch before any tool executes: %j', async (...names) => {
    let effects = 0
    await expect(runSdkAgent({ ...base, infer: async () => completion(names), execute: async () => { effects++; return { ok: true, data: {} } }, finished: () => false })).rejects.toMatchObject({ code: 'GROQ_RESPONSE_INVALID' })
    expect(effects).toBe(0)
  })
  it('does not swallow a quota error or execute a queued commit after it', async () => {
    const executed: string[] = []
    await expect(runSdkAgent({ ...base, infer: async () => completion(['query', 'commit']), execute: async name => { executed.push(name); throw new LunaBudgetError('LUNA_TOOL_CALL_LIMIT') }, finished: () => false })).rejects.toMatchObject({ code: 'LUNA_TOOL_CALL_LIMIT' })
    expect(executed).toEqual(['query'])
  })
  it('validates every input before dispatching even an earlier valid command', async () => {
    let effects = 0
    const response = completion(['commit', 'query'])
    const altered = { ...response, toolCalls: response.toolCalls.map((call, index) => index ? { ...call, function: { ...call.function, arguments: '{"tenant_id":"foreign"}' } } : call) }
    await expect(runSdkAgent({ ...base, infer: async () => altered, execute: async () => { effects++; return { ok: true, data: {} } }, finished: () => false })).rejects.toMatchObject({ code: 'GROQ_RESPONSE_INVALID' })
    expect(effects).toBe(0)
  })
  it('caps the SDK loop at six steps, not the SDK default of twenty', async () => {
    let calls = 0
    await runSdkAgent({ ...base, infer: async () => { calls++; return completion(['query']) }, execute: async () => ({ ok: true, data: {} }), finished: () => false })
    expect(calls).toBe(6)
  })
  it('does not fabricate an inbound message outside the old fixture adapter', async () => {
    let calls = 0
    await expect(runSdkAgent({ ...base, messages: [], infer: async () => { calls++; return completion(['query']) }, execute: async () => ({ ok: true, data: {} }), finished: () => false })).rejects.toThrow('messages must not be empty')
    expect(calls).toBe(0)
  })
})
