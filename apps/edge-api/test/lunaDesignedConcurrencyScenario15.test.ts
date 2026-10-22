import { describe,expect,it } from 'vitest'
import { createDesignedHarness } from './fixtures/luna/designedRuntimeHarness'
import { peerRuntime } from './fixtures/luna/peerRuntime'
import { LUNA_DESIGNED_SCENARIOS,LUNA_SCENARIO_FIXTURE } from './fixtures/luna/designedScenarios'
describe('designed scenario 15 — real Worker/local D1/simulated provider',()=>{
 it('stale price, two sessions on last stock, two sessions on last benefit, no invented payment',async()=>{
  const s=LUNA_DESIGNED_SCENARIOS.find(s=>s.id===15)!,h=await createDesignedHarness(15),f=LUNA_SCENARIO_FIXTURE,c=h.command,d=h.draft
  try{
   const order=c('prepare_product_order',{customer_id:f.customer,items:[{product_id:'racao-a',quantity:1}],fulfillment_type:'counter'})
   await h.turn(1,s.messages[0],[[c('get_customer_context',{}),c('search_products',{query:'Ração A'}),d('cart','cart','add_item',{itemId:'racao-a',quantity:1}),d('cart','cart','set_field',{field:'fulfillment_type',value:'counter'}),{...order,args:{...order.args,operation_id:'cart'}}]],s.allowedTools)
   await h.db.batch([
    h.db.prepare(`UPDATE catalog_products SET price_cents=10000 WHERE tenant_id=?1 AND id='racao-a'`).bind(h.tenant),
    h.db.prepare(`UPDATE inventory_balances SET on_hand_milliunits=1000 WHERE tenant_id=?1 AND product_id='racao-a'`).bind(h.tenant),
   ])
   const stale=await h.turn(2,s.messages[1],[[c('commit_confirmed_proposal',h.proposals.product_order_create)]],s.allowedTools,['PROPOSAL_STALE'],['call-2-1-0:unavailable'])
   expect(stale.committedOperationIds).toEqual([])
   expect((await h.db.prepare(`SELECT id FROM sales WHERE tenant_id=?1`).bind(h.tenant).all()).results).toEqual([])
   const peer=(thread:string,step:number,message:string,command:ReturnType<typeof c>,expectedFailures:string[]=[])=>peerRuntime({tenantId:h.tenant,conversationId:thread,phone:f.phone,step,message,command,now:Date.now(),expectedFailures})
   const p1=await peer('stock-peer-1',1,'Quero uma Ração A para retirar.',order)
   const p2=await peer('stock-peer-2',1,'Quero uma Ração A para retirar.',order)
   h.clock.mockReturnValue(Date.now()+10)
   const stock=await Promise.all([peer('stock-peer-1',2,'Confirmo.',c('commit_confirmed_proposal',p1.proposal!),['INSUFFICIENT_STOCK','ORDER_STOCK_OR_PRICE_CHANGED']),peer('stock-peer-2',2,'Confirmo.',c('commit_confirmed_proposal',p2.proposal!),['INSUFFICIENT_STOCK','ORDER_STOCK_OR_PRICE_CHANGED'])])
   expect(stock.filter(r=>r.result.committedOperationIds.length)).toHaveLength(1)
   expect((await h.db.prepare(`SELECT total_cents,status FROM sales WHERE tenant_id=?1`).bind(h.tenant).all()).results).toEqual([{total_cents:10000,status:'pending'}])
   expect(await h.db.prepare(`SELECT on_hand_milliunits,reserved_milliunits FROM inventory_balances WHERE tenant_id=?1 AND product_id='racao-a'`).bind(h.tenant).first()).toEqual({on_hand_milliunits:1000,reserved_milliunits:1000})
   await h.db.batch([
    h.db.prepare(`INSERT INTO subscription_plans(tenant_id,module_id,id,name,price_cents,billing_cycle,services_json,status,created_at_ms,updated_at_ms) VALUES(?1,'petshop','plan','Último banho',5500,'monthly',?2,'active',?3,?3)`).bind(h.tenant,JSON.stringify([{service_type:'banho',qty_per_cycle:1}]),h.start),
    h.db.prepare(`INSERT INTO client_subscriptions(tenant_id,module_id,id,plan_id,client_id,status,started_at_ms,next_billing_date,services_used_json,created_at_ms,updated_at_ms,benefit_ledger_base_used_json) VALUES(?1,'petshop','subscription','plan',?2,'active',?3,'2026-11-06','{}',?3,?3,'{}')`).bind(h.tenant,f.customer,h.start),
   ])
   const at='2026-10-07T12:00:00Z'
   await h.turn(3,s.messages[2],[[c('get_package_eligibility',{customer_id:f.customer,service_id:'banho'}),d('booking','booking','set_field',{field:'pet_id',value:'mel'}),d('booking','booking','add_item',{itemId:'banho',quantity:1}),d('booking','booking','set_field',{field:'scheduled_at',value:at}),h.booking(at)]],s.allowedTools)
   const bath=c('prepare_appointment',{customer_id:f.customer,pet_id:'mel',service_ids:['banho'],scheduled_at:at,notes:null})
   const competing=await peer('benefit-peer',1,'Quero usar o último banho do pacote para a Mel às 09h.',bath)
   h.clock.mockReturnValue(Date.now()+10)
   const benefits=await Promise.all([
    h.turn(4,s.messages[3],[[c('commit_confirmed_proposal',h.proposals.appointment_create)]],s.allowedTools,['PACKAGE_BENEFITS_CHANGED','PACKAGE_BENEFIT_CAPACITY_EXCEEDED']),
    peer('benefit-peer',2,'Confirmo o horário.',c('commit_confirmed_proposal',competing.proposal!),['PACKAGE_BENEFITS_CHANGED','PACKAGE_BENEFIT_CAPACITY_EXCEEDED']),
   ])
   const commits=benefits.flatMap(r=>'result' in r?r.result.committedOperationIds:r.committedOperationIds)
   expect(commits).toHaveLength(1)
   expect(await h.db.prepare(`SELECT COUNT(*) AS count FROM subscription_benefit_allocations WHERE tenant_id=?1 AND state IN ('reserved','consumed')`).bind(h.tenant).first()).toEqual({count:1})
   expect((await h.db.prepare(`SELECT subscription_discount_cents FROM appointments WHERE tenant_id=?1`).bind(h.tenant).all()).results).toEqual([{subscription_discount_cents:5500}])
   expect(await h.db.prepare(`SELECT COUNT(*) AS count FROM payments WHERE tenant_id=?1`).bind(h.tenant).first()).toEqual({count:0})
   expect(h.transcripts).toHaveLength(s.messages.length)
  }finally{h.close()}
 })
})
