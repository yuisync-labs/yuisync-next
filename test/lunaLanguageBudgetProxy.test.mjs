import {test} from 'node:test'
import assert from 'node:assert/strict'
import {timingSafeEqual} from 'node:crypto'
import worker,{modelReservation} from '../scripts/luna/languageBudgetProxy.mjs'
import {batchHeadroom} from '../scripts/luna/languageBatchBudget.mjs'
if(!crypto.subtle.timingSafeEqual)Object.defineProperty(crypto.subtle,'timingSafeEqual',{value:(a,b)=>timingSafeEqual(Buffer.from(a),Buffer.from(b))})
const token='x'.repeat(43),model='@cf/zai-org/glm-4.7-flash',day=new Date().toISOString().slice(0,10)
function fixture(){
 const state={used:500,reserved:7500,limit:9000,day},tickets=new Map();let calls=0
 const budget={async fetch(request,options){
  const path=new URL(request).pathname,input=options?.body?JSON.parse(options.body):{}
  if(path==='/status')return Response.json(state)
  if(path==='/reserve'){
   if(state.used+state.reserved+input.bound>state.limit)return Response.json({code:'DAILY_AI_BUDGET_EXHAUSTED'},{status:429})
   const id=crypto.randomUUID();tickets.set(id,{bound:input.bound});state.reserved+=input.bound;return Response.json({id,day,bound:input.bound})
  }
  const t=tickets.get(input.id);if(!t)return Response.json({code:'NOT_FOUND'},{status:404})
  if(!t.settled){t.settled=true;state.reserved-=t.bound;state.used+=input.actual??t.bound}
  return Response.json(state)
 }}
 const env={TEST_TOKEN:token,BATCH_ACTIVE:'true',BATCH_DAY:day,BATCH_START_USED:'500',BATCH_MAX:'1000',BUDGET:{idFromName:n=>{assert.equal(n,'workers-ai-account');return n},get:()=>budget},AI:{run:async()=>{calls++;return {response:'ok',usage:{prompt_tokens:100,completion_tokens:10}}}}}
 const request=(body,authorization='Bearer '+token)=>new Request('https://proxy.test/run',{method:'POST',headers:{authorization,'content-type':'application/json'},body:JSON.stringify(body)})
 return {env,state,request,calls:()=>calls}
}
const job={model,input:{messages:[{role:'user',content:'teste'}],max_tokens:800,stream:true}}
test('blocks unauthenticated calls, wrong model and output limits without inference',async()=>{
 const f=fixture()
 assert.equal((await worker.fetch(f.request(job,'Bearer wrong'),f.env)).status,404)
 assert.equal((await worker.fetch(f.request({...job,model:'another'}),f.env)).status,400)
 assert.equal((await worker.fetch(f.request({...job,input:{...job.input,max_tokens:801}}),f.env)).status,400)
 assert.equal(f.calls(),0)
})
test('real transport settles the same shared counter and disables reasoning/streaming',async()=>{
 const f=fixture();f.env.AI.run=async(m,input)=>{assert.equal(m,model);assert.equal(input.stream,false);assert.equal(input.chat_template_kwargs.enable_thinking,false);return {response:'ok',usage:{prompt_tokens:100,completion_tokens:10}}}
 assert.equal((await worker.fetch(f.request(job),f.env)).status,200)
 assert.ok(Math.abs(f.state.used-500.914)<1e-6);assert.equal(f.state.reserved,7500)
})
test('unknown usage is fully charged and is not reported as a successful response',async()=>{
 const f=fixture();f.env.AI.run=async()=>({response:'unknown'})
 assert.equal((await worker.fetch(f.request(job),f.env)).status,502)
 const expected=modelReservation({...job.input,stream:false,chat_template_kwargs:{enable_thinking:false}})
 assert.equal(f.state.used,500+expected);assert.equal(f.state.reserved,7500)
})
test('concurrent inference cannot exceed the held batch headroom',async()=>{
 const f=fixture();f.env.AI.run=async()=>{await new Promise(r=>setTimeout(r,10));return {response:'ok',usage:{prompt_tokens:10,completion_tokens:1}}}
 const input={...job.input,messages:[{role:'user',content:'x'.repeat(21000)}]},bound=modelReservation({...input,stream:false,chat_template_kwargs:{enable_thinking:false}})
 assert.ok(bound>490&&bound<=1000)
 const results=await Promise.all([worker.fetch(f.request({...job,input}),f.env),worker.fetch(f.request({...job,input}),f.env),worker.fetch(f.request({...job,input}),f.env)])
 assert.ok(results.some(r=>r.status===429));assert.ok(f.state.used<=1500);assert.equal(f.state.reserved,7500)
})
test('day changes and an insufficient batch stop before inference',async()=>{
 const f=fixture();f.env.BATCH_DAY='1999-01-01'
 assert.equal((await worker.fetch(f.request(job),f.env)).status,429);assert.equal(f.calls(),0)
 f.env.BATCH_DAY=day;f.state.used=1490
 assert.equal((await worker.fetch(f.request(job),f.env)).status,429);assert.equal(f.calls(),0)
})
test('headroom includes current account consumption and existing reservations',()=>{
 assert.deepEqual(batchHeadroom({day,used:500,reserved:0,limit:9000},{day,floor:700}),{floor:700,cap:1000,hold:7300})
 assert.throws(()=>batchHeadroom({day,used:500,reserved:1100,limit:9000},{day,floor:700}),/UNAVAILABLE/)
 assert.throws(()=>batchHeadroom({day,used:8999,reserved:0,limit:9000},{day,floor:8999}),/UNAVAILABLE/)
 assert.throws(()=>batchHeadroom({day,used:500,reserved:0,limit:9000},{day:'1999-01-01',floor:100}),/INVALID/)
})
