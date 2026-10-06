import {hashCanonicalJson} from '../../apps/edge-api/src/luna/canonicalJson'
import {LUNA_SCENARIO_FIXTURE as fixture} from '../../apps/edge-api/test/fixtures/luna/designedScenarios'
// Assertions consume authoritative snapshots; they never plan tools or answers.
export async function operationalAssertions(input:{id:number;turn:number;total:number;tenant:string;before:any;after:any;tools:any[];faults:any[]}){
 const {id,turn,total,tenant,before,after,tools,faults}=input,violations:string[]=[]
 const check=(ok:unknown,code:string)=>{if(!ok)violations.push(code)}
 const rows=(name:string)=>after.tables[name]??[]
 for(const list of Object.values(after.tables) as any[][])for(const row of list)check(row.tenant_id===tenant&&row.module_id==='petshop','CROSS_SCOPE_ROW')
 check(!rows('inventory_movements').length,'PREMATURE_PHYSICAL_STOCK_DEBIT')
 for(const balance of rows('inventory_balances')){
  check(balance.reserved_milliunits>=0&&balance.on_hand_milliunits>=balance.reserved_milliunits,'OVERSELL')
  const reservations=rows('pending_order_stock_reservations').filter((r:any)=>r.product_id===balance.product_id)
  check(reservations.reduce((n:number,r:any)=>n+r.quantity_milliunits,0)===balance.reserved_milliunits,'RESERVATION_BALANCE_MISMATCH')
 }
 for(const sale of rows('sales')){
  const lines=rows('sale_items').filter((r:any)=>r.sale_id===sale.id)
  check(lines.length>0,'ORDER_LINES_MISSING')
  check(lines.reduce((n:number,r:any)=>n+r.subtotal_cents,0)===sale.total_cents,'ORDER_TOTAL_MISMATCH')
 }
 for(const proposal of rows('luna_proposals')){
  check(await hashCanonicalJson(JSON.parse(proposal.payload_json))===proposal.fingerprint,'PROPOSAL_FINGERPRINT_MISMATCH')
  if(proposal.status==='completed'){
   check(proposal.committed_operation_id,'COMMIT_RECEIPT_MISSING')
   check(rows('luna_proposal_presentations').some((p:any)=>p.proposal_id===proposal.id&&p.proposal_version===proposal.version&&p.fingerprint===proposal.fingerprint),'COMMIT_WITHOUT_PRESENTATION')
  }
 }
 const operations=Object.values(after.operational.operations??{}) as any[],cart=operations.find(o=>o.kind==='cart'),booking=operations.find(o=>o.kind==='booking')
 if(id!==10)check(rows('clients').length===1&&rows('clients')[0].id===fixture.customer,'CUSTOMER_CHANGED')
 if(id===10){
  if(turn<total-1)check(!rows('clients').length&&!rows('pets').length,'PREMATURE_REGISTRATION')
  else{
   check(rows('clients').length===1&&rows('clients')[0].name==='Mariana'&&rows('clients')[0].phone===fixture.phone,'CUSTOMER_REGISTRATION_WRONG')
   check(rows('pets').length===1&&rows('pets')[0].name==='Theo'&&rows('pets')[0].species==='dog'&&rows('pets')[0].breed?.toLowerCase()==='poodle'&&rows('pets')[0].weight_kg===8,'PET_REGISTRATION_WRONG')
   check(rows('luna_registration_receipts').length===1,'REGISTRATION_RECEIPT_WRONG')
  }
 }
 if(id===5&&turn===0)check(tools.some(t=>t.name==='search_products'&&t.result.ok),'UNAVAILABLE_PRODUCT_NOT_QUERIED')
 if(id===6&&turn===1)check(tools.some(t=>t.name==='get_store_information'&&t.result.ok),'STORE_FACTS_UNVERIFIED')
 if(id===8&&turn===1){
  const previous=before.tables.luna_conversation_memory?.find((m:any)=>m.conversation_id==='scenario-8')
  const options=previous?JSON.parse(previous.context_json).options.filter((o:any)=>o.kind==='product'):[]
  check(options.length>=2&&cart?.items[0]?.id===options[1].id,'ORDINAL_NOT_FROM_PRESENTED_ORDER')
 }
 if(id===9&&turn===1)check(JSON.stringify(cart?.fields).includes('20')&&JSON.stringify(cart?.fields).includes('portão azul'),'ADDRESS_CORRECTION_NOT_PRESERVED')
 if(id===9&&turn===total-1){check(cart?.fields.fulfillment_type==='counter','DELIVERY_NOT_REMOVED');check(!rows('sale_delivery_addresses').length,'RETIRED_ORDER_HAS_DELIVERY')}
 if(id===11&&turn===2){
  const previous=Object.values(before.operational.operations??{}).find((o:any)=>o.kind==='booking') as any
  check(booking&&previous&&JSON.stringify(booking)===JSON.stringify(previous),'CART_CHANGE_DESTROYED_BOOKING')
 }
 if(id===13&&turn===1)check(!rows('luna_proposals').some((p:any)=>p.status==='awaiting_confirmation'&&JSON.parse(p.payload_json).total_cents===9000),'OLD_PRICE_SUMMARY_NOT_INVALIDATED')
 if(id===14&&turn===1)check(faults.some(f=>f.kind==='post_commit_redelivery'&&f.persistedOnce&&f.reconciled&&f.rejectedSend),'REDELIVERY_NOT_CERTIFIED')
 if(id===15&&turn===total-1){
  check(faults.some(f=>f.kind==='benefit_race'&&f.winners===1&&f.conflicts===1),'LAST_BENEFIT_RACE_NOT_CERTIFIED')
  check(rows('subscription_benefit_allocations').filter((r:any)=>['reserved','consumed'].includes(r.state)).length===1,'LAST_BENEFIT_DUPLICATED')
 }
 if(id===16){
  const appointments=rows('appointments').filter((a:any)=>a.id!=='occupied')
  if(turn<3)check(!appointments.length,'PREMATURE_APPOINTMENT')
  if(turn===4&&appointments.length)check(appointments[0].scheduled_at_ms!==Date.parse('2026-10-09T18:00:00Z'),'PREMATURE_RESCHEDULE')
  if(turn===5)check(appointments.length===1&&appointments[0].version===2&&appointments[0].scheduled_at_ms===Date.parse('2026-10-09T18:00:00Z'),'RESCHEDULE_WRONG')
  if(turn===6)check(appointments[0]?.status==='scheduled','PREMATURE_CANCELLATION')
  if(turn===7)check(appointments[0]?.version===3&&!rows('appointment_transport_reservations').length&&!rows('subscription_benefit_allocations').some((r:any)=>r.state==='reserved'),'CANCELLATION_RESERVES_NOT_RELEASED')
 }
 if(id===17){
  if(turn===0)check(!JSON.stringify(booking?.fields??{}).includes('grooming_machine_no'),'SCISSORS_REQUESTS_MACHINE_NUMBER')
  if(turn===total-1)check(rows('appointments')[0]?.grooming_machine_no===4,'MACHINE_NUMBER_WRONG')
 }
 if(id===18&&turn===total-1)check(!rows('appointment_transport_reservations').length&&rows('appointments')[0]?.transport_fee_cents===0,'TRANSPORT_RESERVATION_RETAINED')
 if(id===19&&turn===1)check(JSON.stringify(before.operational.operations)===JSON.stringify(after.operational.operations),'TIMEOUT_RESUME_LOST_DRAFT')
 if(id===20)check(!rows('luna_proposals').length&&!rows('luna_operation_events').length,'INJECTION_HAS_OPERATIONAL_EFFECT')
 return violations
}
