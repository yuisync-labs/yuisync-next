import { describe, expect, it, vi } from 'vitest'
import { GroqSdkProvider, sdkMessages } from '../src/luna/providers/groqSdkProvider'
import { createLunaToolRegistry } from '../src/luna/toolRegistry'

const query = createLunaToolRegistry({} as D1Database).definitions.find(t=>t.name==='search_products')!
const completion = (name=query.name,args:unknown={query:'Ração A'}) => ({
  choices:[{index:0,finish_reason:'tool_calls',message:{content:null,tool_calls:[{id:'tool-1',type:'function',function:{name,arguments:JSON.stringify(args)}}]}}],
  usage:{prompt_tokens:100,completion_tokens:20},
})

describe('Groq AI SDK single-step transport in Workers',()=>{
  it('parses the native call without executing tools or hiding retries',async()=>{
    const fetchFn=vi.fn(async (_url:Parameters<typeof fetch>[0],_init?:Parameters<typeof fetch>[1])=>Response.json(completion(),{headers:{'x-ratelimit-limit-tokens':'8000','x-ratelimit-remaining-tokens':'7700'}}))
    const provider=new GroqSdkProvider({apiKey:'fixture',model:'openai/gpt-oss-20b',fetchFn})
    const result=await provider.complete({messages:[{role:'user',content:'Uma Ração A'}],tools:[query],toolChoice:'required'})
    expect(result).toMatchObject({toolCalls:[{function:{name:'search_products',arguments:'{"query":"Ração A"}'}}],usage:{promptTokens:100,completionTokens:20},tokenLimit:8000,rateLimit:{remainingTokens:7700}})
    expect(fetchFn).toHaveBeenCalledTimes(1)
    const body=JSON.parse(String(fetchFn.mock.calls[0][1]?.body))
    expect(body).toMatchObject({include_reasoning:false,reasoning_effort:'low',parallel_tool_calls:false,max_completion_tokens:1200,tool_choice:'required'})
    expect(body).not.toHaveProperty('reasoning_format')
    expect(body.tools[0].function.strict).toBe(true)
    expect(provider.reservationTokens({messages:[{role:'user',content:'Uma Ração A'}],tools:[query],toolChoice:'required'})).toBeGreaterThan(new TextEncoder().encode(JSON.stringify(body)).length)
  })
  it.each([400,401,429,503])('preserves a sanitized HTTP %i and never retries',async status=>{
    const fetchFn=vi.fn(async()=>Response.json({error:{code:'tool_use_failed',type:'invalid_request_error',message:'private gsk_secret'}},{status}))
    const provider=new GroqSdkProvider({apiKey:'fixture',model:'openai/gpt-oss-20b',fetchFn})
    try {await provider.complete({messages:[{role:'user',content:'oi'}],tools:[query]});throw new Error('Expected failure')}
    catch(error){expect(error).toMatchObject({code:status===400?'GROQ_REQUEST_INVALID':status===401?'GROQ_UNAUTHORIZED':status===429?'GROQ_RATE_LIMITED':'GROQ_UNAVAILABLE'});expect(JSON.stringify(error)).not.toContain('gsk_secret')}
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })
  it('rejects unexposed tools with known billed usage intact',async()=>{
    const provider=new GroqSdkProvider({apiKey:'fixture',model:'openai/gpt-oss-20b',fetchFn:async()=>Response.json(completion('create_payment'))})
    await expect(provider.complete({messages:[{role:'user',content:'oi'}],tools:[query]})).rejects.toMatchObject({code:'GROQ_RESPONSE_INVALID',usage:{promptTokens:100,completionTokens:20}})
  })
  it('does not invent missing usage',async()=>{
    const body=completion();delete (body as {usage?:unknown}).usage
    const provider=new GroqSdkProvider({apiKey:'fixture',model:'openai/gpt-oss-20b',fetchFn:async()=>Response.json(body)})
    await expect(provider.complete({messages:[{role:'user',content:'oi'}],tools:[query]})).rejects.toMatchObject({code:'GROQ_USAGE_UNAVAILABLE',usage:null})
  })
  it('preserves tool-result linkage and rejects an orphan result',()=>{
    const converted=sdkMessages([{role:'assistant',content:null,tool_calls:[{id:'a',type:'function',function:{name:query.name,arguments:'{"query":"Ração A"}'}}]},{role:'tool',tool_call_id:'a',content:'{"ok":true}'}],[query])
    expect(converted[1]).toMatchObject({role:'tool',content:[{toolCallId:'a',toolName:'search_products',output:{type:'text',value:'{"ok":true}'}}]})
    expect(()=>sdkMessages([{role:'tool',tool_call_id:'missing',content:'{}'}],[])).toThrow('GROQ_RESPONSE_INVALID')
  })
})
