import {env} from 'cloudflare:workers'
import {describe,it,expect} from 'vitest'
import {generateText} from 'ai'
import {MockLanguageModelV3} from 'ai/test'
import {dailyAiRemaining,withDailyAiBudget} from '../src/luna/aiBudget'
import {THINK_TURN_NEURON_LIMIT,thinkNeurons} from '../src/luna/thinkPolicy'
const namespace=env.LUNA_AI_BUDGET!
const call=(stub:DurableObjectStub,path:string,body?:unknown)=>stub.fetch('https://budget'+path,body?{method:'POST',body:JSON.stringify(body)}:undefined)
describe('Account daily neuron guard',()=>{
 it('reserves atomically across conversations and settles exactly once',async()=>{
  const stub=namespace.get(namespace.idFromName('concurrent'))
  const a=await Promise.all([call(stub,'/reserve',{bound:6000}),call(stub,'/reserve',{bound:6000})])
  expect(a.map(r=>r.status).sort()).toEqual([200,429])
  const ticket=await a.find(r=>r.ok)!.json() as {id:string;day:string;bound:number}
  await call(stub,'/settle',{...ticket,actual:30});await call(stub,'/settle',{...ticket,actual:30})
  expect(await(await call(stub,'/status')).json()).toMatchObject({used:30,reserved:0,limit:9000})
 })
 it('charges the full reservation when actual usage is unknown',async()=>{
  const stub=namespace.get(namespace.idFromName('uncertain')),ticket=await(await call(stub,'/reserve',{bound:500})).json()
  await call(stub,'/settle',ticket)
  expect(await(await call(stub,'/status')).json()).toMatchObject({used:500,reserved:0})
 })
 it('accounts non-streaming compaction through the same model wrapper',async()=>{
  const model=new MockLanguageModelV3({doGenerate:{content:[{type:'text',text:'ok'}],finishReason:{unified:'stop',raw:'stop'},usage:{inputTokens:{total:100,noCache:100,cacheRead:0,cacheWrite:0},outputTokens:{total:10,text:10,reasoning:0}},warnings:[]}})
  await generateText({model:withDailyAiBudget(model,{LUNA_AI_BUDGET:namespace}),prompt:'test',maxOutputTokens:500,maxRetries:0})
  const status=await(await call(namespace.get(namespace.idFromName('workers-ai-account')),'/status')).json() as {used:number;reserved:number}
  expect(status.used).toBeCloseTo(0.914);expect(status.reserved).toBe(0)
 })
 it('reports what is left today so a turn never plans past the daily budget',async()=>{
  const stub=namespace.get(namespace.idFromName('workers-ai-account'))
  const before=await(await call(stub,'/status')).json() as {used:number;reserved:number;limit:number}
  const ticket=await(await call(stub,'/reserve',{bound:200})).json() as {id:string;day:string}
  expect(await dailyAiRemaining({LUNA_AI_BUDGET:namespace})).toBeCloseTo(before.limit-before.used-before.reserved-200)
  await call(stub,'/settle',{...ticket,actual:0})
  expect(await dailyAiRemaining({})).toBeNull()
 })
 it('lets one turn spend about 64k input tokens, 4% of the daily ceiling',()=>{
  expect(thinkNeurons(64000,0)).toBeLessThan(THINK_TURN_NEURON_LIMIT)
  expect(thinkNeurons(64000,1200)).toBeGreaterThan(THINK_TURN_NEURON_LIMIT)
  expect(THINK_TURN_NEURON_LIMIT/9000).toBe(0.04)
 })
})
