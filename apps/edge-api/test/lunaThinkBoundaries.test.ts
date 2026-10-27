import {describe,it,expect} from 'vitest'
import {runInDurableObject} from 'cloudflare:test'
import {command as c,createThinkHarness} from './fixtures/luna/thinkHarness'
import {validateThinkJob} from '../src/luna/thinkDomain'
import {MockLanguageModelV3} from 'ai/test'

describe('Think operational boundaries on local D1',()=>{
 it('does not cache a refused confirmation across later customer messages',async()=>{
  const h=await createThinkHarness(193)
  try{
   await h.run('Uma Ração A, retirada.',[c('open_tools',{capability:'cart'}),h.update([h.add(),h.pickup])])
   const p=await h.proposal()
   await h.run('Confirmo esse pedido para entrega.',[c('commit_confirmed_proposal',p),c('get_operation_status',{proposal_id:p.proposal_id})],['CONFIRMATION_REQUIRED'])
   expect((await h.saleRows()).results).toHaveLength(0)
   const done=await h.run('Confirmo esse pedido para retirada.',[c('commit_confirmed_proposal',p)])
   expect(done.result.reply).toContain('pagamento continua pendente')
   expect((await h.saleRows()).results).toHaveLength(1)
  }finally{h.close()}
 })
 for(const [offset,change,code] of [[0,'price','PROPOSAL_STALE'],[1,'stock','INSUFFICIENT_STOCK']] as const){
  it('requires a new proposal after '+change+' changes',async()=>{
   const h=await createThinkHarness(180+offset)
   try{
    await h.run('Uma Ração A, retirada.',[c('open_tools',{capability:'cart'}),h.update([h.add(),h.pickup])])
    const p=await h.proposal()
    await h.db.prepare(change==='price'?"UPDATE catalog_products SET price_cents=price_cents+100 WHERE tenant_id=? AND id='racao-a'":"UPDATE inventory_balances SET on_hand_milliunits=0 WHERE tenant_id=? AND product_id='racao-a'").bind(h.tenant).run()
    await h.run('Confirmo.',[c('commit_confirmed_proposal',p),'As condições mudaram; preciso revisar o resumo.'],[code])
    expect((await h.saleRows()).results).toHaveLength(0)
   }finally{h.close()}
  })
 }
 it('recovers a lost HTTP response and ignores duplicate confirmation without repeating CSAT',async()=>{
  const h=await createThinkHarness(182)
  try{
   await h.run('Uma Ração A, retirada.',[c('open_tools',{capability:'cart'}),h.update([h.add(),h.pickup])])
   const p=await h.proposal(),done=await h.run('Confirmo.',[c('commit_confirmed_proposal',p)])
   await runInDurableObject(h.stub,async agent=>{
    const repeated=await agent.onRequest(new Request('https://local/submit',{method:'POST',body:JSON.stringify(done.body)}))
    expect((await repeated.json() as {turn_id:string}).turn_id).toBe(done.admitted[0])
    const recovered=await agent.onRequest(new Request('https://local/turns/'+done.admitted[0]))
    expect((await recovered.json() as {result:unknown}).result).toEqual(done.result)
   })
   await h.run('Confirmo.',[c('commit_confirmed_proposal',p)])
   expect((await h.saleRows()).results).toHaveLength(1)
   const requests=await h.db.prepare("SELECT id FROM chat_messages WHERE tenant_id=? AND direction='outbound' AND content_text LIKE '%1 a 5 estrelas%'").bind(h.tenant).all()
   expect(requests.results).toHaveLength(1)
  }finally{h.close()}
 })
 it('does not commit confirmation combined with a correction',async()=>{
  const h=await createThinkHarness(183)
  try{
   await h.run('Uma Ração A, retirada.',[c('open_tools',{capability:'cart'}),h.update([h.add(),h.pickup])])
   const p=await h.proposal()
   await h.run(['Confirmo','mas troca para duas'],[c('commit_confirmed_proposal',p),'Vou revisar para duas unidades.'],['CONFIRMATION_REQUIRED'])
   expect((await h.saleRows()).results).toHaveLength(0)
  }finally{h.close()}
 })
 it('blocks another tenant, another customer and revoked membership',async()=>{
  const h=await createThinkHarness(184)
  try{
   const job=h.job('scope','Oi')
   await expect(validateThinkJob(h.db,{...job,context:{...job.context,tenantId:'foreign'}})).rejects.toThrow('FORBIDDEN')
   await expect(validateThinkJob(h.db,{...job,context:{...job.context,customerAddress:'5532999990888'}})).rejects.toThrow('LUNA_CHAT_BINDING_CHANGED')
   await h.db.prepare("UPDATE tenant_memberships SET status='inactive' WHERE tenant_id=? AND principal_id=?").bind(h.tenant,h.principal).run()
   await expect(validateThinkJob(h.db,job)).rejects.toThrow('FORBIDDEN')
   expect((await h.saleRows()).results).toHaveLength(0)
  }finally{h.close()}
 })
 it('keeps restock and incoming messages paused throughout human handoff',async()=>{
  const h=await createThinkHarness(185)
  try{
   await h.run('Quero uma pessoa da loja.',[c('handoff_to_human',{reason:'Cliente pediu atendimento humano.'})])
   const summary=JSON.parse(String((await h.db.prepare("SELECT json_extract(context_json,'$.think.handoff_summary') s FROM chat_threads WHERE tenant_id=?").bind(h.tenant).first<{s:string}>())?.s))
   expect(summary).toMatchObject({reason:'Cliente pediu atendimento humano.',recent:expect.arrayContaining(['Cliente: Quero uma pessoa da loja.'])})
   expect(summary.customer?.name).toBeTruthy()
   await h.db.prepare("UPDATE chat_threads SET context_json=json_set(context_json,'$.think.restock_product','racao-a','$.think.restock_consent_message','consent-1') WHERE tenant_id=?").bind(h.tenant).run()
   await runInDurableObject(h.stub,async agent=>{
    await agent.checkRestock()
    expect((await agent.onRequest(new Request('https://local/submit',{method:'POST',body:JSON.stringify(h.job('paused','Oi'))}))).status).toBe(409)
   })
   expect((await h.db.prepare("SELECT id FROM chat_messages WHERE tenant_id=? AND external_message_id='restock:consent-1'").bind(h.tenant).all()).results).toHaveLength(0)
   // A legacy UI changing only the thread cannot restart the agent.
   await h.db.prepare("UPDATE chat_threads SET status='open' WHERE tenant_id=?").bind(h.tenant).run()
   await expect(validateThinkJob(h.db,h.job('still-paused','Oi'))).rejects.toThrow('LUNA_CHAT_BINDING_CHANGED')
  }finally{h.close()}
 })
 it('does not interpret a quantity as a rating',async()=>{
  const h=await createThinkHarness(186)
  try{
   await h.run('Quero 5 sachês para retirar.',[c('open_tools',{capability:'cart'}),h.update([h.add('sache',5),h.pickup])])
   expect((await h.state()).operations.cart.items).toEqual([{id:'sache',quantity:5}])
   expect(await h.db.prepare('SELECT csat_score FROM chat_threads WHERE tenant_id=?').bind(h.tenant).first()).toEqual({csat_score:null})
   expect((await h.saleRows()).results).toHaveLength(0)
  }finally{h.close()}
 })
 it('preserves native Think permission grants even when the model attempts an action during clinical risk',async()=>{
  const h=await createThinkHarness(187)
  try{
   await h.run('Qual dose devo dar ao meu cão?',[c('open_tools',{capability:'cart'}),h.update([h.add(),h.pickup]),'Vou encaminhar para a loja.'])
   expect(Object.values((await h.state()).operations)).toHaveLength(0)
   expect((await h.saleRows()).results).toHaveLength(0)
   expect(await h.db.prepare('SELECT status FROM chat_threads WHERE tenant_id=?').bind(h.tenant).first()).toEqual({status:'handoff'})
  }finally{h.close()}
 })
 it('places a failed model turn visibly in the human queue without any business effect',async()=>{
  const h=await createThinkHarness(189)
  try{
   h.clock.mockReturnValue(h.start+10000)
   await runInDurableObject(h.stub,async agent=>{
    agent.getModel=()=>new MockLanguageModelV3({doStream:async()=>{throw Error('TEST_PROVIDER_UNAVAILABLE')}})
    expect((await agent.onRequest(new Request('https://local/submit',{method:'POST',body:JSON.stringify(h.job('provider-failed','Oi'))}))).status).toBe(202)
    agent.setState({...agent.state,pending:agent.state.pending.map(entry=>({...entry,at:Date.now()-11000}))})
    await agent.flushInbound()
   })
   await runInDurableObject(h.stub,async agent=>{
    const submissions=await agent.listSubmissions()
    await agent.waitForSubmission(submissions[0].submissionId,{timeoutMs:15000}).catch(()=>undefined)
   })
   let row: {status:string;last_message_at_ms:number|null}|null=null
   for(let attempt=0;attempt<30;attempt++){
    row=await h.db.prepare('SELECT status,last_message_at_ms FROM chat_threads WHERE tenant_id=?').bind(h.tenant).first()
    if(row?.last_message_at_ms)break
    await new Promise(resolve=>setTimeout(resolve,50))
   }
   expect(row).toMatchObject({status:'handoff',last_message_at_ms:h.start+10000})
   expect((await h.saleRows()).results).toHaveLength(0)
   expect((await h.db.prepare("SELECT id FROM chat_messages WHERE tenant_id=? AND direction='outbound'").bind(h.tenant).all()).results).toHaveLength(1)
   await runInDurableObject(h.stub,async agent=>{
    expect(Object.values(agent.state.turns).at(-1)?.modelCalls).toBe(1)
   })
  }finally{h.close()}
 })
})
