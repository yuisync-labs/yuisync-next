import { describe, expect, it, vi } from 'vitest'
import { WorkersAiProvider, GLM_FLASH_MODEL, glmNeurons } from '../src/luna/providers/workersAiProvider'
import { createLunaProvider, lunaJournalConfiguration, lunaProviderConfigured } from '../src/luna/providers/providerFactory'
import { createLunaToolRegistry } from '../src/luna/toolRegistry'
import { GroqSdkProvider } from '../src/luna/providers/groqSdkProvider'

const query=createLunaToolRegistry({} as D1Database).definitions.find(t=>t.name==='search_products')!
const input={messages:[{role:'user' as const,content:'Uma Ração A'}],tools:[query],toolChoice:'required' as const}
function output(name=query.name,args:unknown={query:'Ração A'}){
 return {choices:[{index:0,finish_reason:'tool_calls',message:{content:null,tool_calls:[{id:'cf-tool-1',type:'function',function:{name,arguments:JSON.stringify(args)}}]}}],usage:{prompt_tokens:100,completion_tokens:20}}
}
function fixture(response:unknown=output()){
 const run=vi.fn(async(_model:string,_input:unknown,_options?:unknown)=>response),binding={run} as unknown as Ai
 return {run,binding,provider:new WorkersAiProvider(binding)}
}
describe('Workers AI GLM single-step transport',()=>{
 it('uses the binding once, disables thinking, and returns native tools plus real usage',async()=>{
  const f=fixture(),result=await f.provider.complete(input)
  expect(f.run).toHaveBeenCalledTimes(1)
  expect(f.run.mock.calls[0][0]).toBe(GLM_FLASH_MODEL)
  expect(f.run.mock.calls[0][1]).toMatchObject({chat_template_kwargs:{enable_thinking:false,clear_thinking:true},tool_choice:'required',parallel_tool_calls:false})
  expect(f.run.mock.calls[0][2]).toMatchObject({signal:expect.any(AbortSignal)})
  expect(result).toMatchObject({toolCalls:[{id:'cf-tool-1',function:{name:'search_products',arguments:'{"query":"Ração A"}'}}],usage:{promptTokens:100,completionTokens:20},requestLimit:null,tokenLimit:null})
  expect(result.rateLimit).toEqual({remainingRequests:null,remainingTokens:null,resetRequests:null,resetTokens:null})
 })
 it('never invents zero usage when the provider omits it',async()=>{
  const raw=output();delete (raw as {usage?:unknown}).usage
  const f=fixture(raw)
  await expect(f.provider.complete(input)).rejects.toMatchObject({code:'WORKERS_AI_USAGE_UNAVAILABLE',usage:null})
  expect(f.run).toHaveBeenCalledTimes(1)
 })
 it('removes schema annotations on the wire without relaxing required fields or constraints',async()=>{
  const annotated={...query,parameters:{...query.parameters,description:'Redundant prose',properties:{query:{type:'string',minLength:1,maxLength:200,description:'The query already described by the tool'}}}}
  const f=fixture()
  await f.provider.complete({...input,tools:[annotated]})
  const wire=f.run.mock.calls[0][1] as {tools:{function:{parameters:Record<string,unknown>}}[]}
  expect(wire.tools[0].function.parameters).toEqual({...annotated.parameters,description:undefined,properties:{query:{type:'string',minLength:1,maxLength:200}}})
  await expect(fixture(output(query.name,{})).provider.complete({...input,tools:[annotated]})).rejects.toMatchObject({code:'WORKERS_AI_RESPONSE_INVALID'})
 })
 it.each([['create_payment',{}],['search_products',{query:5}],['search_products',{query:'A',extra:'invented'}]])('rejects an unsafe tool batch before effects: %s',async(name,args)=>{
  const f=fixture(output(name,args))
  await expect(f.provider.complete(input)).rejects.toMatchObject({code:'WORKERS_AI_RESPONSE_INVALID',usage:{promptTokens:100,completionTokens:20}})
  expect(f.run).toHaveBeenCalledTimes(1)
 })
 it('does not salvage tool-shaped prose into a commercial action',async()=>{
  const f=fixture({choices:[{message:{content:'{"name":"search_products","arguments":{"query":"A"}}'}}],usage:{prompt_tokens:100,completion_tokens:20}})
  await expect(f.provider.complete(input)).rejects.toMatchObject({code:'WORKERS_AI_RESPONSE_INVALID'})
 })
 it('rejects duplicate or absent native tool IDs before the SDK can fabricate replacements',async()=>{
  const duplicate=output();duplicate.choices[0].message.tool_calls.push(duplicate.choices[0].message.tool_calls[0])
  await expect(fixture(duplicate).provider.complete(input)).rejects.toMatchObject({code:'WORKERS_AI_RESPONSE_INVALID'})
  const absent=output();absent.choices[0].message.tool_calls[0].id=''
  await expect(fixture(absent).provider.complete(input)).rejects.toMatchObject({code:'WORKERS_AI_RESPONSE_INVALID'})
 })
 it('retains known usage when a completion is empty and sanitizes quota failure without retries',async()=>{
  const f=fixture({choices:[{message:{content:''}}],usage:{prompt_tokens:100,completion_tokens:20}})
  await expect(f.provider.complete({...input,toolChoice:'auto'})).rejects.toMatchObject({code:'WORKERS_AI_RESPONSE_INVALID',usage:{promptTokens:100,completionTokens:20}})
  f.run.mockRejectedValueOnce(Object.assign(new Error('private token / prompt'),{status:429}))
  try{await f.provider.complete(input);throw Error('expected failure')}catch(e){expect(JSON.stringify(e)).not.toContain('private token');expect(e).toMatchObject({code:'WORKERS_AI_RATE_LIMITED'})}
  expect(f.run).toHaveBeenCalledTimes(2)
 })
 it('restricts GLM to disabled automation in staging and preserves Groq defaults',()=>{
  const f=fixture(),cf={APP_ENV:'staging',LUNA_ENABLED:'false',LUNA_PROVIDER:'workers-ai',LUNA_MODEL:GLM_FLASH_MODEL,AI:f.binding}
  expect(createLunaProvider(cf)).toBeInstanceOf(WorkersAiProvider)
  for(const env of [{...cf,APP_ENV:'production'},{...cf,LUNA_ENABLED:'true'},{...cf,LUNA_MODEL:'unknown'},{...cf,AI:undefined}])expect(lunaProviderConfigured(env)).toBe(false)
  const groq={LUNA_MODEL:'openai/gpt-oss-20b',GROQ_API_KEY:'fixture'}
  expect(createLunaProvider(groq)).toBeInstanceOf(GroqSdkProvider)
  expect(lunaJournalConfiguration(groq,'existing')).toBe('existing')
  expect(lunaJournalConfiguration(cf,'existing')).not.toBe('existing')
  expect(glmNeurons({promptTokens:250000,completionTokens:25000})).toBe(2285)
 })
})
