import {env} from 'cloudflare:workers'
import {runInDurableObject} from 'cloudflare:test'
import {getAgentByName} from 'agents'
import {MockLanguageModelV3} from 'ai/test'
import {describe,it,expect} from 'vitest'
import {LunaThinkAgent} from '../src/luna/thinkAgent'
import {THINK_MODEL} from '../src/luna/thinkPolicy'
import {createDesignedHarness} from './fixtures/luna/designedRuntimeHarness'
import type {InternalChatJob} from '../src/luna/internalChatTurn'
import {createThinkHarness,command} from './fixtures/luna/thinkHarness'

const stream=(name:string|null,input:unknown,text='')=>({stream:new ReadableStream({start(c){
 c.enqueue({type:'stream-start',warnings:[]})
 if(name)c.enqueue({type:'tool-call',toolCallId:crypto.randomUUID(),toolName:name,input:JSON.stringify(input)})
 else{c.enqueue({type:'text-start',id:'text'});c.enqueue({type:'text-delta',id:'text',delta:text});c.enqueue({type:'text-end',id:'text'})}
 c.enqueue({type:'finish',finishReason:{unified:name?'tool-calls':'stop',raw:name?'tool_calls':'stop'},usage:{inputTokens:{total:30,noCache:30,cacheRead:0,cacheWrite:0},outputTokens:{total:20,text:20,reasoning:0}}});c.close()
}})})

describe('Think nativo: SDK real, D1 real, modelo simulado',()=>{
 it('espera 10 segundos após o último fragmento e gera uma única resposta',async()=>{
  const h=await createThinkHarness(879)
  try{
   let calls=0
   await runInDurableObject(h.stub,async agent=>{
    agent.getModel=()=>new MockLanguageModelV3({doStream:async()=>{calls++;return stream(null,{},'Olá! Como posso ajudar?')}})
    const submit=(source:string,text:string)=>agent.onRequest(new Request('https://local/submit',{method:'POST',body:JSON.stringify(h.job(source,text))}))
    expect((await submit('debounce-1','Olá')).status).toBe(202)
    h.clock.mockReturnValue(h.start+8000)
    expect((await submit('debounce-2','bom dia')).status).toBe(202)
    h.clock.mockReturnValue(h.start+17999)
    await agent.flushInbound()
    expect(calls).toBe(0);expect(await agent.listSubmissions()).toHaveLength(0)
    expect(agent.state.pending).toHaveLength(2)
    h.clock.mockReturnValue(h.start+18000)
    await agent.flushInbound()
   })
   await runInDurableObject(h.stub,async agent=>{
    const submissions=await agent.listSubmissions()
    expect(submissions).toHaveLength(1)
    await agent.waitForSubmission(submissions[0].submissionId,{timeoutMs:15000})
    expect(agent.state.pending).toHaveLength(0)
   })
   expect(calls).toBe(1)
  }finally{h.close()}
 },30000)
 it('busca sachês no plural e preserva quantidade fora dos filtros da embalagem',async()=>{
  const h=await createThinkHarness(774)
  try{
   await h.db.prepare("UPDATE catalog_product_attributes SET food_form='wet' WHERE tenant_id=? AND product_id='sache'").bind(h.tenant).run()
   const r=await h.run('Dois sachês para gata.',[command('search_products',{query:'sachês',filters:{foodForm:'wet',species:'cat',packCount:2}}),'Encontrei o sachê.'])
   expect(r.tools[0].result).toMatchObject({ok:true,data:{products:[{id:'sache'}],ignored_filters:{packCount:expect.any(String)}}})
  }finally{h.close()}
 })
 it('interpreta petisco genérico como família sem exigir a palavra no nome comercial',async()=>{
  const h=await createThinkHarness(771)
  try{
   await h.db.prepare("INSERT INTO catalog_product_species(tenant_id,module_id,product_id,species) VALUES(?,'petshop','petisco','dog')").bind(h.tenant).run()
   const r=await h.run('Petiscos para cachorro.',[command('search_products',{query:'petisco',filters:{productType:'treat',species:'dog'}}),'Encontrei Bifinho carne, mas a adequação à espécie precisa ser confirmada.'])
   expect(r.tools[0].result).toMatchObject({ok:true,data:{products:[{id:'petisco'}]}})
  }finally{h.close()}
 })
 it('entrega resposta final validada no limite sem chamar novamente o modelo',async()=>{
  const h=await createThinkHarness(772,'-budget',undefined,{profileModel:true,inputTokens:6000})
  try{
   const r=await h.run('Tem Ração A?',[command('search_products',{query:'Ração A'}),'Encontrei Ração A por R$ 90,00.'])
   expect(r.result.status).toBe('replied');expect(r.result.usage.modelCalls).toBe(2)
   expect(h.modelFootprint).toHaveLength(2)
  }finally{h.close()}
 })
 it('apresenta resumo já validado quando a última ferramenta atinge o limite',async()=>{
  const h=await createThinkHarness(773,'-budget',undefined,{profileModel:true,inputTokens:6000})
  try{
   const r=await h.run('Uma Ração A para retirar.',[command('search_products',{query:'Ração A'}),command('set_cart',{items:[{product_id:'racao-a',quantity:1}],fulfillment_type:'counter'})])
   expect(r.result.status).toBe('awaiting_confirmation');expect(r.result.usage.modelCalls).toBe(2)
   expect((await h.saleRows()).results).toHaveLength(0);expect(h.modelFootprint).toHaveLength(2)
  }finally{h.close()}
 })
 it('busca nome específico sem apagar espécie, distingue classificação ausente e usa o perfil v2',async()=>{
  const h=await createThinkHarness(198)
  try{
   const lookup=command('search_products',{filters:{productType:'treat',species:'dog',nameTerms:['Bifinho','carne']}})
   const before=await h.run('Quero Bifinho carne para cachorro.',[lookup,'Encontrei o produto, mas a adequação à espécie precisa ser confirmada.'])
   expect(before.tools[0].result).toMatchObject({ok:true,data:{preferences:{species:'dog'},products:[{id:'petisco',species_confirmation_required:true}]}})
   await h.db.prepare("INSERT INTO catalog_product_profile_species(tenant_id,module_id,product_id,species) VALUES(?,'petshop','petisco','dog')").bind(h.tenant).run()
   const after=await h.run('Busque Bifinho carne para cachorro novamente.',[lookup,'Encontrei o produto para cachorro.'])
   expect(after.tools[0].result).toMatchObject({ok:true,data:{preferences:{species:'dog'},products:[{id:'petisco',species_confirmation_required:false}]}})
  }finally{h.close()}
 })
 it('aceita rótulos de busca em português sem gastar uma chamada em reparo de formato',async()=>{
  const h=await createThinkHarness(196)
  try{
   const result=await h.run('Tem areia para gato?',[command('search_products',{search_key:'areia_gato_higiênica',filters:{catalogCategory:'hygiene',subtype:'litter',species:'cat'}}),'Encontrei areia para gato. Você quer essa opção?'])
   expect(result.result.usage.modelCalls).toBe(2)
   await runInDurableObject(h.stub,async agent=>{
    expect(agent.state.catalog.areia_gato_higienica).toBeDefined()
    expect(Object.keys(agent.state.catalog)).toHaveLength(1)
   })
  }finally{h.close()}
 })
 it('prepara entrega e corrige o carrinho completo sem somar quantidades ou comprar antes da confirmação',async()=>{
  const h=await createThinkHarness(195)
  try{
   const first=await h.run('Quero uma Ração A, entrega na Rua Teste 48, Centro, Cidade Teste.',[command('search_products',{filters:{brand:'Quatree'}}),command('set_cart',{items:[{product_id:'racao-a',quantity:1,pet_id:'mel'}],fulfillment_type:'delivery',delivery_address:{street:'Rua Teste',number:'48',city:'Cidade Teste',neighborhood:'Centro'}})])
   expect(first.result.reply).toContain('105,00')
   const old=await h.proposal()
   const changed=await h.run('Agora duas para retirar, minha irmã Ana busca.',[command('set_cart',{items:[{product_id:'racao-a',quantity:2,pet_id:'mel'}],fulfillment_type:'counter',reference:'Minha irmã Ana retira.'})])
   expect(changed.result.reply).toContain('180,00')
   expect((await h.state()).operations).toMatchObject({[Object.keys((await h.state()).operations)[0]]:{items:[{id:'racao-a',quantity:2,petId:'mel'}]}})
   expect((await h.saleRows()).results).toHaveLength(0)
   expect(await h.db.prepare('SELECT status FROM luna_proposals WHERE tenant_id=? AND id=?').bind(h.tenant,old.proposal_id).first()).toEqual({status:'invalidated'})
   const p=await h.proposal();await h.run('Confirmo.',[command('commit_confirmed_proposal',p)])
   expect((await h.saleRows()).results).toMatchObject([{status:'pending',total_cents:18000,fulfillment_type:'counter'}])
   expect((await h.db.prepare('SELECT sale_id FROM sale_delivery_addresses WHERE tenant_id=?').bind(h.tenant).all()).results).toHaveLength(0)
  }finally{h.close()}
 })
 it('preserva o resultado da consulta de serviço no contexto do turno seguinte',async()=>{
  const h=await createThinkHarness(194)
  try{
   await h.run('Tem banho para a Mel?',[command('search_services',{query:'banho',pet_id:'mel'}),'O banho da Mel custa R$ 55,00. Qual dia prefere?'])
   await runInDurableObject(h.stub,async agent=>{
    const original=agent.beforeTurn.bind(agent)
    agent.beforeTurn=async ctx=>{
     const config=await original(ctx)
     expect(config.messages?.some(message=>message.role==='tool'&&JSON.stringify(message.content).includes('search_services'))).toBe(true)
     expect(JSON.stringify(config.messages)).toContain('banho')
     return config
    }
   })
   const prepared=await h.run('Amanhã às 9h. Eu levo a Mel.',[h.update([h.add('banho'),{action:'set_field',field:'pet_id',value:'mel'},{action:'set_field',field:'scheduled_at',value:'2026-10-07T12:00:00Z'}],true,'banho-mel','booking')])
   expect(prepared.result.reply).toContain('Você confirma este resumo?')
   expect((await h.db.prepare('SELECT id FROM appointments WHERE tenant_id=?').bind(h.tenant).all()).results).toHaveLength(0)
  }finally{h.close()}
 })
 it('mantém rascunho incompleto sem efeito e prepara o resumo ao receber a modalidade',async()=>{
  const h=await createThinkHarness(190)
  try{
   const partial=await h.run('Quero uma Ração A.',[
    command('open_tools',{capability:'cart'}),
    command('update_draft',{operation_id:'cart',kind:'cart',changes:[h.add()]}),
    'Você prefere retirar ou receber em casa?',
   ],['DRAFT_INCOMPLETE'])
   expect(partial.tools.find(result=>result.name==='update_draft')?.result).toMatchObject({ok:false,code:'DRAFT_INCOMPLETE',missing_fields:['fulfillment_type']})
   expect(await h.db.prepare('SELECT id FROM luna_proposals WHERE tenant_id=?').bind(h.tenant).first()).toBeNull()
   const ready=await h.run('Vou retirar.',[command('update_draft',{operation_id:'cart',kind:'cart',changes:[h.pickup]})])
   expect(ready.result.reply).toContain('Você confirma este resumo?')
   expect((await h.state()).operations.cart.items).toEqual([{id:'racao-a',quantity:1}])
   expect((await h.saleRows()).results).toHaveLength(0)
  }finally{h.close()}
 })
 it('prepara e confirma pedido uma vez, reserva saldo, encerra e recebe avaliação',async()=>{
  const h=await createDesignedHarness(1,'-think'),principal='think-native-owner'
  try{
   await h.db.batch([
    h.db.prepare("UPDATE chat_threads SET channel='internal' WHERE tenant_id=? AND id=?").bind(h.tenant,h.ctx.conversationId),
    h.db.prepare("INSERT INTO identity_principals(id,provider,subject,status,created_at_ms,updated_at_ms) VALUES(?,'better-auth',?,'active',?,?)").bind(principal,principal,h.start,h.start),
    h.db.prepare("INSERT INTO tenant_memberships(tenant_id,principal_id,role,status,module_permissions_json,created_at_ms,updated_at_ms) VALUES(?,?,'owner','active','{}',?,?)").bind(h.tenant,principal,h.start,h.start),
   ])
   const namespace=(env as EdgeEnv & {LUNA_THINK:DurableObjectNamespace<LunaThinkAgent>}).LUNA_THINK
   const stub=await getAgentByName(namespace,h.tenant+':'+h.ctx.conversationId)
   let call=0
   const commands:[string|null,unknown,string?][]=[
    ['open_tools',{capability:'cart'}],
    ['set_cart',{items:[{product_id:'racao-a',quantity:1}],fulfillment_type:'counter'}],
   ]
   const model=new MockLanguageModelV3({doStream:async()=>{const next=commands[call++];if(!next)throw Error('Unexpected model call');return stream(next[0],next[1],next[2])}})
   async function turn(index:number,message:string){
    h.clock.mockReturnValue(h.start+index*20000)
    const job:InternalChatJob={kind:'internal-chat',principalId:principal,releaseSha:'local',model:THINK_MODEL,provider:'workers-ai',message,context:{...h.ctx,sourceMessageId:'think-in-'+index,traceId:'think-'+index,executionMode:'staging'}}
    const accepted=await runInDurableObject(stub,async(agent:LunaThinkAgent)=>{
     agent.getModel=()=>model
     const r=await agent.onRequest(new Request('https://local/submit',{method:'POST',body:JSON.stringify(job)}));expect(r.status).toBe(202)
     const payload=await r.json() as {turn_id:string}
     agent.setState({...agent.state,pending:agent.state.pending.map(e=>({...e,at:Date.now()-11000}))})
     await agent.flushInbound()
     return payload
    })
    // The SDK owns the actual submitted turn; runTurn wait joins that same admission.
    await runInDurableObject(stub,async(agent:LunaThinkAgent)=>{
     const submissions=await agent.listSubmissions();expect(submissions.length).toBeGreaterThan(0)
     const newest=submissions.reduce((a,b)=>a.createdAt>b.createdAt?a:b)
     await agent.waitForSubmission(newest.submissionId,{timeoutMs:15000})
    })
    const result=await runInDurableObject(stub,async(agent:LunaThinkAgent)=>await(await agent.onRequest(new Request('https://local/turns/'+accepted.turn_id))).json()) as {status:string;result?:{reply:string}}
    expect(result.status,JSON.stringify(result)).toBe('complete');return result
   }
   const prepared=await turn(1,'Quero uma Ração A, um pacote, vou retirar.')
   expect(prepared.result?.reply).toContain('Você confirma este resumo?')
   expect(await h.db.prepare('SELECT id FROM sales WHERE tenant_id=?').bind(h.tenant).first()).toBeNull()
   const proposal=await h.db.prepare('SELECT id,version FROM luna_proposals WHERE tenant_id=?').bind(h.tenant).first<{id:string;version:number}>()
   commands.push(['commit_confirmed_proposal',{proposal_id:proposal!.id,proposal_version:proposal!.version}])
   const done=await turn(2,'Confirmo esse pedido para retirada.')
   expect(done.result?.reply).toContain('1 a 5 estrelas')
   expect(await h.db.prepare('SELECT status FROM sales WHERE tenant_id=?').bind(h.tenant).all()).toMatchObject({results:[{status:'pending'}]})
   expect(await h.db.prepare("SELECT status FROM chat_threads WHERE tenant_id=? AND id=?").bind(h.tenant,h.ctx.conversationId).first()).toMatchObject({status:'closed'})
   commands.push([null,{},'Por nada!'])
   await turn(3,'Obrigado!')
   expect(await h.db.prepare("SELECT status,json_extract(context_json,'$.think.awaiting_rating') awaiting FROM chat_threads WHERE tenant_id=? AND id=?").bind(h.tenant,h.ctx.conversationId).first()).toMatchObject({status:'closed',awaiting:1})
   commands.push(['record_rating',{score:5}])
   await turn(4,'5 estrelas')
   expect(await h.db.prepare('SELECT csat_score FROM chat_threads WHERE tenant_id=? AND id=?').bind(h.tenant,h.ctx.conversationId).first()).toMatchObject({csat_score:5})
  }finally{h.close()}
 },30000)
})
