import { describe, expect, it } from 'vitest'
import { GroqSdkProvider } from '../src/luna/providers/groqSdkProvider'
import { WorkersAiProvider, GLM_FLASH_MODEL } from '../src/luna/providers/workersAiProvider'
import { groqWireToolArguments } from '../src/luna/providers/groqToolSchema'
import { runLunaTurn } from '../src/luna/runLunaTurn'
import { createLunaToolRegistry } from '../src/luna/toolRegistry'
import { recordProposalPresentation } from '../src/luna/proposalPresentation'
import { createDesignedHarness, type Command } from './fixtures/luna/designedRuntimeHarness'
import { LUNA_DESIGNED_SCENARIOS } from './fixtures/luna/designedScenarios'
import { DRAFT_TOOL_DEFINITIONS } from '../src/luna/draftTools'

type Harness=Awaited<ReturnType<typeof createDesignedHarness>>
async function turn(h:Harness,index:number,message:string,commands:Command[],transport:'groq'|'workers-ai'='groq'){
  h.clock.mockReturnValue(h.start+index*10000)
  const context={...h.ctx,sourceMessageId:`sdk-in-${index}`,traceId:`sdk-trace-${index}`}
  await h.db.prepare(`INSERT INTO chat_messages(tenant_id,module_id,id,thread_id,external_message_id,direction,actor_type,content_text,created_at_ms) VALUES(?1,'petshop',?2,?3,?2,'inbound','customer',?4,?5)`)
    .bind(h.tenant,context.sourceMessageId,context.conversationId,message,Date.now()).run()
  let requests=0
  const definitions=[...createLunaToolRegistry(h.db).definitions,...DRAFT_TOOL_DEFINITIONS]
  const response=(wire:{tools:{function:{name:string}}[]})=>{
    const command=commands[requests++]
    if(!command)throw new Error('Unexpected SDK replay')
    expect(wire.tools.some((t:{function:{name:string}})=>['record_turn_decision','update_operation_draft'].includes(t.function.name))).toBe(false)
    expect(wire.tools.some((t:{function:{name:string}})=>t.function.name===command.name)).toBe(true)
    const definition=definitions.find(t=>t.name===command.name)
    const args=transport==='groq'&&definition?groqWireToolArguments(JSON.stringify(command.args),definition.parameters):JSON.stringify(command.args)
    return {choices:[{index:0,finish_reason:'tool_calls',message:{content:null,tool_calls:[{id:`sdk-${index}-${requests}`,type:'function',function:{name:command.name,arguments:args}}]}}],usage:{prompt_tokens:100,completion_tokens:30}}
  }
  const provider=transport==='groq'
    ?new GroqSdkProvider({apiKey:'fixture-not-real',model:'openai/gpt-oss-20b',fetchFn:async(_url,init)=>Response.json(response(JSON.parse(String(init?.body))))})
    :new WorkersAiProvider({run:async(model:string,wire:{tools:{function:{name:string}}[]})=>{expect(model).toBe(GLM_FLASH_MODEL);return response(wire)}} as unknown as Ai)
  const result=await runLunaTurn({database:h.db,provider,context})
  expect(result.errorCode).toBeNull()
  expect(requests).toBe(commands.length)
  if(result.reply){
    h.clock.mockReturnValue(Date.now()+1)
    const out=`sdk-out-${index}`
    await h.db.prepare(`INSERT INTO chat_messages(tenant_id,module_id,id,thread_id,direction,actor_type,content_text,created_at_ms) VALUES(?1,'petshop',?2,?3,'outbound','assistant',?4,?5)`)
      .bind(h.tenant,out,context.conversationId,result.reply,Date.now()).run()
    await recordProposalPresentation(h.db,context,result.proposalIds,out)
  }
  return result
}

describe('vertical purchase: real SDK + Worker/D1, HTTP model simulated',()=>{
  it('recovers the observed missing question and premature finish without a second draft mutation or invented sale',async()=>{
    const h=await createDesignedHarness(1,'-sdk-browser-regression')
    try{
      const first=await turn(h,1,'Quero uma Ração A.',[
        h.command('search_products',{query:'Ração A'}),
        h.command('draft_add_item',{operation_id:'cart',kind:'cart',item_id:'racao-a',quantity:1}),
        {name:'finish_turn',args:{intent:'cart',operation_ids:['cart'],social:[],fact_ids:['bootstrap-identity:pet.0','sdk-1-1:product.0'],question:'none'}},
        {name:'finish_turn',args:{intent:'cart',operation_ids:['cart'],social:[],fact_ids:['bootstrap-identity:pet.0','sdk-1-1:product.0'],question:'fulfillment'}},
      ])
      expect(first.reply).toContain('retirar ou receber em casa')
      expect(first.reply).not.toContain('Pet cadastrado')
      expect((await h.state()).operations.cart.items).toEqual([{id:'racao-a',quantity:1}])
      const second=await turn(h,2,'Vou retirar na loja.',[
        h.command('draft_set_fulfillment',{operation_id:'cart',kind:'cart',value:'counter'}),
        {name:'finish_turn',args:{intent:'cart',operation_ids:['cart'],social:['Tudo certo!'],fact_ids:['bootstrap-identity:pet.0'],question:'none'}},
        h.command('prepare_product_order',{customer_id:'cliente-maria',operation_id:'cart',items:[{product_id:'racao-a',quantity:1}],fulfillment_type:'counter'}),
      ])
      expect(second.status).toBe('awaiting_confirmation')
      expect(second.reply).toContain('Ração A × 1: R$ 90,00')
      expect(second.reply).toContain('Modalidade: retirada')
      expect((await h.db.prepare('SELECT * FROM luna_proposal_presentations WHERE tenant_id=?1').bind(h.tenant).all()).results).toHaveLength(1)
      expect(await h.db.prepare('SELECT COUNT(*) AS n FROM sales WHERE tenant_id=?1').bind(h.tenant).first()).toEqual({n:0})
    }finally{h.close()}
  })
  it.each(['groq','workers-ai'] as const)('completes scenario 1 through %s + ToolLoopAgent, with a pending order and no invented payment',async(transport)=>{
    const h=await createDesignedHarness(1,'-sdk-vertical-'+transport)
    try{
      const first=await turn(h,1,LUNA_DESIGNED_SCENARIOS[0].messages[0],[
        h.command('search_products',{query:'Ração A'}),
        h.command('draft_add_item',{operation_id:'cart',kind:'cart',item_id:'racao-a',quantity:1}),
        {name:'finish_turn',args:{intent:'cart',operation_ids:['cart'],social:[],fact_ids:['sdk-1-1:product.0'],question:'fulfillment'}},
      ],transport)
      expect(first).toMatchObject({status:'replied',errorCode:null,usage:{modelCalls:3}})
      expect(first.reply).toContain('Ração A: R$ 90,00')
      expect(first.reply).toContain('retirar ou receber em casa')
      expect(first.reply).not.toContain('Qual quantidade?')
      expect((await h.state()).operations.cart.items).toEqual([{id:'racao-a',quantity:1}])
      const second=await turn(h,2,LUNA_DESIGNED_SCENARIOS[0].messages[1],[
        h.command('draft_set_fulfillment',{operation_id:'cart',kind:'cart',value:'counter'}),
        h.command('prepare_product_order',{customer_id:'cliente-maria',operation_id:'cart',items:[{product_id:'racao-a',quantity:1}],fulfillment_type:'counter'}),
      ],transport)
      expect(second).toMatchObject({status:'awaiting_confirmation',errorCode:null,usage:{modelCalls:2}})
      expect(second.reply).toContain('Modalidade: retirada')
      expect(await h.db.prepare(`SELECT COUNT(*) AS n FROM sales WHERE tenant_id=?1`).bind(h.tenant).first()).toEqual({n:0})
      const proposal=await h.db.prepare(`SELECT id,version FROM luna_proposals WHERE tenant_id=?1`).bind(h.tenant).first<{id:string;version:number}>()
      const third=await turn(h,3,LUNA_DESIGNED_SCENARIOS[0].messages[2],[h.command('commit_confirmed_proposal',{proposal_id:proposal!.id,proposal_version:proposal!.version})],transport)
      expect(third).toMatchObject({status:'replied',errorCode:null,usage:{modelCalls:1}})
      expect(third.reply).toContain('não significa que o pagamento foi recebido')
      expect((await h.db.prepare(`SELECT status,total_cents FROM sales WHERE tenant_id=?1`).bind(h.tenant).all()).results).toEqual([{status:'pending',total_cents:9000}])
      expect(await h.db.prepare(`SELECT COUNT(*) AS n FROM payments WHERE tenant_id=?1`).bind(h.tenant).first()).toEqual({n:0})
    }finally{h.close()}
  })
  it('restricts a bad final response to one read-only repair without replaying the persisted draft',async()=>{
    const h=await createDesignedHarness(1,'-sdk-repair')
    try{
      const result=await turn(h,1,'Quero uma Ração A.',[
        h.command('search_products',{query:'Ração A'}),
        h.command('draft_add_item',{operation_id:'cart',kind:'cart',item_id:'racao-a',quantity:1}),
        {name:'finish_turn',args:{intent:'cart',operation_ids:['cart'],social:['Está pago.'],fact_ids:[],question:'none'}},
        {name:'finish_turn',args:{intent:'cart',operation_ids:['cart'],social:[],fact_ids:['sdk-1-1:product.0'],question:'fulfillment'}},
      ])
      expect(result).toMatchObject({status:'replied',errorCode:null,usage:{modelCalls:4}})
      expect(result.reply).not.toContain('Está pago')
      expect((await h.state()).operations.cart.version).toBe(1)
      expect(await h.db.prepare(`SELECT COUNT(*) AS n FROM luna_operation_events WHERE tenant_id=?1`).bind(h.tenant).first()).toEqual({n:1})
      expect(await h.db.prepare(`SELECT COUNT(*) AS n FROM sales WHERE tenant_id=?1`).bind(h.tenant).first()).toEqual({n:0})
    }finally{h.close()}
  })
})
