import { describe,expect,it } from 'vitest'
import { createDesignedHarness } from './fixtures/luna/designedRuntimeHarness'
import { LUNA_DESIGNED_SCENARIOS,LUNA_SCENARIO_FIXTURE } from './fixtures/luna/designedScenarios'
import { loadConversationMemory } from '../src/luna/conversationalMemory'
describe('designed scenario 11 — real Worker/local D1/simulated provider',()=>{
 for(const variant of ['canonical','Thor/Premier'])it(`multi-intent ${variant}: isolated proposals, independent confirmations and native commits`,async()=>{
  const s=LUNA_DESIGNED_SCENARIOS.find(s=>s.id===11)!,h=await createDesignedHarness(11,variant==='canonical'?'':'-thor'),f=LUNA_SCENARIO_FIXTURE
  const c=h.command,d=h.draft,at='2026-10-07T12:00:00Z'
  const pet=variant==='canonical'?'mel':'thor'
  try{
   if(variant!=='canonical')await h.db.prepare(`UPDATE catalog_products SET name='Premier adulto' WHERE tenant_id=?1 AND id='racao-a'`).bind(h.tenant).run()
   await h.turn(1,variant==='canonical'?s.messages[0]:'Quero marcar banho pro Thor amanhã e vê se vocês têm Premier adulto.',[[
    c('record_turn_decision',{intents:[{operation_id:'booking',kind:'booking',goal:'create'},{operation_id:'cart',kind:'cart',goal:'create'}],focus:'booking'}),
    c('get_customer_context',{}),c('search_services',{query:'banho'}),c('search_products',{query:variant==='canonical'?'Ração A':'Premier adulto'}),
    d('booking','booking','set_field',{field:'pet_id',value:pet}),d('booking','booking','add_item',{itemId:'banho',quantity:1}),d('booking','booking','set_field',{field:'period',value:'manhã'}),
    d('cart','cart','add_item',{itemId:'racao-a',quantity:1}),d('cart','cart','set_field',{field:'fulfillment_type',value:'counter'}),
    c('get_available_slots',{service_ids:['banho'],starts_at:at,ends_at:'2026-10-07T15:00:00Z'}),
   ]],s.allowedTools)
   expect((await h.state()).operations.cart.items).toEqual([{id:'racao-a',quantity:1}])
   expect((await loadConversationMemory(h.db,h.ctx)).focus).toBe('booking')
   await h.turn(2,s.messages[1],[[d('booking','booking','set_field',{field:'scheduled_at',value:at}),h.booking(at,undefined,pet),c('prepare_product_order',{customer_id:f.customer,items:[{product_id:'racao-a',quantity:1}],fulfillment_type:'counter',operation_id:'cart'})]],s.allowedTools)
   const bath=h.proposals.appointment_create
   expect(bath).toBeDefined();expect(h.proposals.product_order_create).toBeDefined()
   await h.turn(3,s.messages[2],[[d('cart','cart','set_quantity',{itemId:'racao-a',quantity:2}),c('prepare_product_order',{customer_id:f.customer,items:[{product_id:'racao-a',quantity:2}],fulfillment_type:'counter',operation_id:'cart'})]],s.allowedTools)
   expect((await h.state()).operations.booking.fields.scheduled_at).toBe(at)
   expect((await h.state()).operations.cart.items).toEqual([{id:'racao-a',quantity:2}])
   expect(await h.db.prepare(`SELECT status FROM luna_proposals WHERE tenant_id=?1 AND id=?2`).bind(h.tenant,bath.proposal_id).first()).toEqual({status:'awaiting_confirmation'})
   await h.turn(4,s.messages[3],[[c('present_proposal',{proposal_id:bath.proposal_id})]],s.allowedTools)
   const committed=await h.turn(5,s.messages[4],[[c('commit_confirmed_proposal',bath)]],s.allowedTools,[],['call-5-1-0:result'])
   expect(committed.committedOperationIds).toHaveLength(1)
   expect((await h.db.prepare(`SELECT id FROM sales WHERE tenant_id=?1`).bind(h.tenant).all()).results).toEqual([])
   await h.turn(6,s.messages[5],[[c('present_proposal',{proposal_id:h.proposals.product_order_create.proposal_id})]],s.allowedTools)
   await h.turn(7,s.messages[6],[[c('commit_confirmed_proposal',h.proposals.product_order_create)]],s.allowedTools,[],['call-7-1-0:result'])
   expect((await h.db.prepare(`SELECT pet_id,scheduled_at_ms FROM appointments WHERE tenant_id=?1`).bind(h.tenant).all()).results).toEqual([{pet_id:pet,scheduled_at_ms:Date.parse(at)}])
   expect((await h.db.prepare(`SELECT total_cents,status FROM sales WHERE tenant_id=?1`).bind(h.tenant).all()).results).toEqual([{total_cents:18000,status:'pending'}])
   expect(await h.db.prepare(`SELECT COUNT(*) AS count FROM payments WHERE tenant_id=?1`).bind(h.tenant).first()).toEqual({count:0})
   expect(h.tools.filter(t=>t==='commit_confirmed_proposal')).toHaveLength(2);expect(h.transcripts).toHaveLength(s.messages.length)
  }finally{h.close()}
 })
})
