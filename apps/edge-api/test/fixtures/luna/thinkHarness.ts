import {env} from 'cloudflare:workers'
import {runInDurableObject} from 'cloudflare:test'
import {getAgentByName} from 'agents'
import {MockLanguageModelV3} from 'ai/test'
import {expect} from 'vitest'
import {LunaThinkAgent} from '../../../src/luna/thinkAgent'
import {THINK_MODEL} from '../../../src/luna/thinkPolicy'
import {createDesignedHarness} from './designedRuntimeHarness'
import type {InternalChatJob} from '../../../src/luna/internalChatTurn'

export type ThinkCommand={name:string;input:Record<string,unknown>}
export type ThinkStep=ThinkCommand|string
export const command=(name:string,input:Record<string,unknown>={}):ThinkCommand=>({name,input})
export async function createThinkHarness(id:number,suffix='',overrideNamespace?:DurableObjectNamespace<LunaThinkAgent>,diagnostic?:{profileModel:boolean;inputTokens?:number}){
 const h=await createDesignedHarness(id,'-think-path'+suffix),principal='think-path-owner-'+id+suffix
 await h.db.batch([
  h.db.prepare("UPDATE chat_threads SET channel='internal' WHERE tenant_id=? AND id=?").bind(h.tenant,h.ctx.conversationId),
  h.db.prepare("INSERT INTO identity_principals(id,provider,subject,status,created_at_ms,updated_at_ms) VALUES(?,'better-auth',?,'active',?,?)").bind(principal,principal,h.start,h.start),
  h.db.prepare("INSERT INTO tenant_memberships(tenant_id,principal_id,role,status,module_permissions_json,created_at_ms,updated_at_ms) VALUES(?,?,'owner','active','{}',?,?)").bind(h.tenant,principal,h.start,h.start),
  h.db.prepare("UPDATE module_settings_extensions SET data_json=json_set(data_json,'$.store_business_hours',json(json_extract(data_json,'$.petbot_business_hours')),'$.delivery_coverage',json(?)) WHERE tenant_id=?").bind(JSON.stringify([{city:'Cidade Teste',neighborhood:'Centro',active:true,fee_cents:1500}]),h.tenant),
  h.db.prepare("UPDATE pets SET species='cat' WHERE tenant_id=? AND id='luna'").bind(h.tenant),
  ...['racao-a','racao-b','sache'].flatMap(product=>[
   h.db.prepare("INSERT INTO catalog_product_attributes(tenant_id,module_id,product_id,product_type,brand_code,brand_label,life_stage,sale_form,package_weight_grams,search_enabled,review_state,evidence_json,revision,created_at_ms) VALUES(?,'petshop',?,'feed',?,?, 'adult','packaged',?,1,'reviewed','{}',1,?)").bind(h.tenant,product,product==='sache'?'whiskas':'quatree',product==='sache'?'Whiskas':'Quatree',product==='sache'?85:15000,h.start),
   h.db.prepare("INSERT INTO catalog_product_species(tenant_id,module_id,product_id,species) VALUES(?,'petshop',?,?)").bind(h.tenant,product,product==='sache'?'cat':'dog'),
  ]),
  ...[['areia','Areia comum 4 kg','hygiene','litter'],['petisco','Bifinho carne 60 g','treat','strip'],['cama-g','Cama G','accessory','bed'],['coleira-azul','Coleira azul','accessory','collar'],['tapete','Tapete 28 unidades','hygiene','pad']].flatMap(([product,name,type,subtype])=>[
   h.db.prepare("INSERT INTO catalog_products(tenant_id,module_id,id,name,price_cents,status,created_at_ms,updated_at_ms) VALUES(?,'petshop',?,?,2000,'active',?,?)").bind(h.tenant,product,name,h.start,h.start),
   h.db.prepare("INSERT INTO inventory_balances(tenant_id,module_id,product_id,on_hand_milliunits,reserved_milliunits,reorder_milliunits,version,updated_at_ms) VALUES(?,'petshop',?,20000,0,0,1,?)").bind(h.tenant,product,h.start),
   h.db.prepare("INSERT INTO catalog_product_profiles(tenant_id,module_id,product_id,entity_kind,domain,product_type,subtype,sale_unit,requires_professional_guidance,review_state,source_name,source_category,attributes_json,evidence_json,revision,created_at_ms) VALUES(?,'petshop',?,'product','petshop',?,?,'UN',0,'classified',?,?,'{}','{}','think-test',?)").bind(h.tenant,product,type,subtype,name,type,h.start),
   ...(type==='treat'?[h.db.prepare("INSERT INTO catalog_product_attributes(tenant_id,module_id,product_id,product_type,sale_form,search_enabled,review_state,evidence_json,revision,created_at_ms) VALUES(?,'petshop',?,'treat','packaged',1,'reviewed','{}','test',?)").bind(h.tenant,product,h.start)]:[]),
  ]),
 ])
 const namespace=overrideNamespace??(env as EdgeEnv&{LUNA_THINK:DurableObjectNamespace<LunaThinkAgent>}).LUNA_THINK,stub=await getAgentByName(namespace,h.tenant+':petshop:'+h.ctx.conversationId)
 let index=0
 const transcripts:{message:string[];result:unknown}[]=[]
 const modelFootprint:{messages:{role:string;chars:number}[];tools:{name:string;chars:number}[]|undefined}[]=[]
 const job=(source:string,message:string):InternalChatJob=>({kind:'internal-chat',principalId:principal,releaseSha:'local',model:THINK_MODEL,provider:'workers-ai',message,context:{...h.ctx,sourceMessageId:source,traceId:'trace-'+source,executionMode:'staging'}})
 async function run(message:string|string[],steps:ThinkStep[],expectedCodes:string[]=[]){
  const parts=Array.isArray(message)?message:[message];index++;h.clock.mockReturnValue(h.start+index*20000)
  let call=0
  const model=new MockLanguageModelV3({doStream:async options=>{
   if(diagnostic?.profileModel)modelFootprint.push({messages:options.prompt.map(message=>({role:message.role,chars:JSON.stringify(message.content).length})),tools:options.tools?.map(tool=>({name:tool.name,chars:JSON.stringify(tool).length}))})
   const next=steps[call++];if(next===undefined)throw Error('Unscripted model call: '+index+':'+call)
   return {stream:new ReadableStream({start(c){c.enqueue({type:'stream-start',warnings:[]});if(typeof next==='string'){c.enqueue({type:'text-start',id:'text'});c.enqueue({type:'text-delta',id:'text',delta:next});c.enqueue({type:'text-end',id:'text'})}else c.enqueue({type:'tool-call',toolCallId:crypto.randomUUID(),toolName:next.name,input:JSON.stringify(next.input)});c.enqueue({type:'finish',finishReason:{unified:typeof next==='string'?'stop':'tool-calls',raw:'fixture'},usage:{inputTokens:{total:diagnostic?.inputTokens??50,noCache:diagnostic?.inputTokens??50,cacheRead:0,cacheWrite:0},outputTokens:{total:20,text:20,reasoning:0}}});c.close()}})}
  }})
  const admitted=await runInDurableObject(stub,async(agent:LunaThinkAgent)=>{
   agent.getModel=()=>model
   const ids=[]
   for(const [part,text] of parts.entries()){
    const response=await agent.onRequest(new Request('https://local/submit',{method:'POST',body:JSON.stringify(job('in-'+index+'-'+part,text))}));expect(response.status).toBe(202)
    ids.push((await response.json() as {turn_id:string}).turn_id)
   }
   agent.setState({...agent.state,pending:agent.state.pending.map(e=>({...e,at:Date.now()-11000}))});await agent.flushInbound();return ids
  })
  await runInDurableObject(stub,async(agent:LunaThinkAgent)=>{const s=await agent.listSubmissions();const newest=s.reduce((a,b)=>a.createdAt>b.createdAt?a:b);await agent.waitForSubmission(newest.submissionId,{timeoutMs:15000})})
  const data=await runInDurableObject(stub,async(agent:LunaThinkAgent)=>{
   const results=[]
   for(const id of admitted)results.push(await(await agent.onRequest(new Request('https://local/turns/'+id))).json())
   const turns=Object.values(agent.state.turns),tools=turns.at(-1)?.results??[]
   for(const result of tools){const output=result.result as {ok?:boolean;code?:string};if(output.ok===false)expect(expectedCodes,JSON.stringify(result)).toContain(output.code)}
   return {results,tools}
  }) as {results:{status:string;result:{reply:string;status:string;usage:{modelCalls:number;toolCalls:number}}}[];tools:{name:string;result:unknown}[]}
  for(const r of data.results)expect(r.status,JSON.stringify(r)).toBe('complete')
  expect(data.results.map(r=>r.result.reply).every(r=>r===data.results[0].result.reply)).toBe(true)
  transcripts.push({message:parts,result:data.results[0]});return {result:data.results[0].result,tools:data.tools,admitted,source:'in-'+index+'-0',body:job('in-'+index+'-0',parts[0])}
 }
 async function proposal(kind='product_order_create'){
  const row=await h.db.prepare("SELECT id,version FROM luna_proposals WHERE tenant_id=? AND conversation_id=? AND operation_kind=? AND status='awaiting_confirmation' ORDER BY updated_at_ms DESC LIMIT 1").bind(h.tenant,h.ctx.conversationId,kind).first<{id:string;version:number}>()
  expect(row).not.toBeNull();return {proposal_id:row!.id,proposal_version:row!.version}
 }
 const update=(changes:Record<string,unknown>[],prepare=true,operation_id='cart',kind='cart')=>command('update_draft',{operation_id,kind,changes,prepare})
 const add=(id='racao-a',quantity=1)=>({action:'add_item',item_id:id,quantity})
 const pickup={action:'set_fulfillment',value:'counter'}
 const saleRows=()=>h.db.prepare('SELECT id,status,total_cents,fulfillment_type FROM sales WHERE tenant_id=?').bind(h.tenant).all<Record<string,unknown>>()
 return {...h,principal,stub,run,proposal,update,add,pickup,saleRows,transcripts,job,modelFootprint}
}
