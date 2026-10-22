import {env} from 'cloudflare:workers'
import {runInDurableObject} from 'cloudflare:test'
import {describe,it,expect} from 'vitest'
import {createWorkersAI} from 'workers-ai-provider'
import {createThinkHarness} from './fixtures/luna/thinkHarness'
import {THINK_MODEL} from '../src/luna/thinkPolicy'

describe.skipIf(!('LIVE_MODEL' in env))('Luna with real GLM and disposable local business data',()=>{
 it('presents a purchase and commits only after a later confirmation',async()=>{
  const h=await createThinkHarness(811,'-live')
  // Real inference takes wall time; do not keep the offline fixture's old clock.
  // An old frozen date schedules native lifecycle jobs in the past.
  h.close()
  const service=(env as unknown as {LIVE_MODEL:Fetcher}).LIVE_MODEL
  try{
   await runInDurableObject(h.stub,async agent=>{
    agent.getModel=()=>createWorkersAI({binding:{run:async(model:string,input:unknown)=>{
     const response=await service.fetch('https://live-model.local/run',{method:'POST',body:JSON.stringify({model,input})})
     if(!response.ok)throw Error('LIVE_MODEL_ERROR_'+response.status+':'+await response.text())
     return response.json()
    }} as never})(THINK_MODEL,{chat_template_kwargs:{enable_thinking:false}})
   })
   for(const [index,message] of ['Oi, quero uma Ração A de 15 kg para cachorro adulto, vou retirar na loja.','Confirmo esse pedido para retirada.'].entries()){
    const job=h.job('live-'+index,message)
    const turnId=await runInDurableObject(h.stub,async agent=>{
     const response=await agent.onRequest(new Request('https://local/submit',{method:'POST',body:JSON.stringify(job)}))
     expect(response.status).toBe(202)
     const data=await response.json() as {turn_id:string}
     return data.turn_id
    })
    await new Promise(resolve=>setTimeout(resolve,10500))
    await runInDurableObject(h.stub,async agent=>{
     await agent.flushInbound()
     const submissions=await agent.listSubmissions()
     const newest=submissions.reduce((a,b)=>a.createdAt>b.createdAt?a:b)
     await agent.waitForSubmission(newest.submissionId,{timeoutMs:150000})
    })
    const result=await runInDurableObject(h.stub,async agent=>await(await agent.onRequest(new Request('https://local/turns/'+turnId))).json() as Record<string,any>)
    console.log('LIVE_TURN '+JSON.stringify({message,result}))
    expect(result?.status).toBe('complete')
    expect(result?.result?.status).not.toBe('handoff')
    const sales=await h.saleRows()
    expect(sales.results.length).toBe(index===0?0:1)
    if(index===0){
     expect(result?.result?.status).toBe('awaiting_confirmation')
     expect(result?.result?.reply.toLowerCase()).not.toContain('mel')
    }
   }
   const sale=(await h.saleRows()).results[0]
   expect(sale.total_cents).toBe(9000)
   expect(await h.db.prepare('SELECT COUNT(*) n FROM payments WHERE tenant_id=?').bind(h.tenant).first()).toEqual({n:0})
   expect(await h.db.prepare("SELECT reserved_milliunits FROM inventory_balances WHERE tenant_id=? AND product_id='racao-a'").bind(h.tenant).first()).toEqual({reserved_milliunits:1000})
  }finally{h.close()}
 })
})
