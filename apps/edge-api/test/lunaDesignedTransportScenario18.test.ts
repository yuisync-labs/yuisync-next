import { describe,expect,it } from 'vitest'
import { createDesignedHarness } from './fixtures/luna/designedRuntimeHarness'
import { peerRuntime } from './fixtures/luna/peerRuntime'
import { LUNA_DESIGNED_SCENARIOS,LUNA_SCENARIO_FIXTURE } from './fixtures/luna/designedScenarios'
describe('designed scenario 18 — real Worker/local D1/simulated provider',()=>{
 it('explicit vehicle capacity, address/reference, modality change, native reservation/commit and cancellation',async()=>{
  const s=LUNA_DESIGNED_SCENARIOS.find(s=>s.id===18)!,h=await createDesignedHarness(18),f=LUNA_SCENARIO_FIXTURE,c=h.command,d=h.draft
  const at='2026-10-07T12:00:00Z',address={city:'Cidade Teste',address:'Rua Teste, 20',reference:'portão azul'}
  try{
   await h.db.batch(['both','pickup'].map(id=>h.db.prepare(`INSERT INTO transport_options(tenant_id,module_id,id,label,fee_cents,max_weight_grams,pickup_required,dropoff_required,outside_city,status,sort_order) VALUES(?1,'petshop',?2,?3,?4,20000,1,?5,0,'active',1)`).bind(h.tenant,id,id==='both'?'MotoDog buscar e levar':'MotoDog só buscar',id==='both'?2000:1000,id==='both'?1:0)))
   const transportOrder=c('prepare_appointment',{customer_id:f.customer,pet_id:'mel',service_ids:['banho'],scheduled_at:at,notes:null,transport:{...address,option_id:'both'}})
   const unavailable=await peerRuntime({tenantId:h.tenant,conversationId:'unconfigured-transport',phone:f.phone,step:1,message:'Quero banho da Mel amanhã às 09h com MotoDog.',command:transportOrder,now:h.start,expectedFailures:['TRANSPORT_CAPACITY_UNAVAILABLE']})
   expect(unavailable.result.proposalIds).toEqual([])
   await h.db.batch([
    h.db.prepare(`INSERT INTO transport_resources VALUES(?1,'petshop','bike',1,'active')`).bind(h.tenant),
    ...['both','pickup'].map(id=>h.db.prepare(`INSERT INTO transport_option_resources VALUES(?1,'petshop',?2,'bike')`).bind(h.tenant,id)),
    h.db.prepare(`INSERT INTO transport_availability_windows VALUES(?1,'petshop','window','bike',?2,?3,1)`).bind(h.tenant,Date.parse(at),Date.parse('2026-10-07T15:00:00Z')),
   ])
   await h.turn(1,s.messages[0],[[c('get_customer_context',{}),c('search_services',{query:'banho'}),c('get_transport_quote',{pet_id:'mel',city:'Cidade Teste'}),d('booking','booking','set_field',{field:'pet_id',value:'mel'}),d('booking','booking','add_item',{itemId:'banho',quantity:1}),d('booking','booking','set_field',{field:'transport_mode',value:'both'}),c('get_available_slots',{service_ids:['banho'],starts_at:at,ends_at:'2026-10-07T15:00:00Z'})],results=>{
    const selected=results.find(r=>r.data?.slots)!.data.slots[0];expect(selected).toBe('2026-10-07T12:00:00.000Z')
    return[d('booking','booking','set_field',{field:'scheduled_at',value:selected})]
   }],s.allowedTools,[],[],'address')
   await h.turn(2,s.messages[1],[[d('booking','booking','set_field',{field:'address',value:address.address}),d('booking','booking','set_field',{field:'reference',value:address.reference}),h.booking(at,{...address,option_id:'both'})]],s.allowedTools)
   const first=h.proposals.appointment_create
   expect(h.transcripts[1].result.reply).toContain('MotoDog buscar e levar');expect(h.transcripts[1].result.reply).toContain('portão azul')
   await h.turn(3,s.messages[2],[[d('booking','booking','set_field',{field:'transport_mode',value:'pickup'}),h.booking(at,{...address,option_id:'pickup'})]],s.allowedTools)
   expect(await h.db.prepare(`SELECT status FROM luna_proposals WHERE tenant_id=?1 AND id=?2`).bind(h.tenant,first.proposal_id).first()).toEqual({status:'invalidated'})
   expect(h.transcripts[2].result.reply).toContain('MotoDog só buscar')
   await h.turn(4,s.messages[3],[[d('booking','booking','set_field',{field:'transport_mode',value:'client'}),h.booking(at)]],s.allowedTools)
   expect(h.transcripts[3].result.reply).not.toContain('Transporte:');expect(h.transcripts[3].result.reply).toContain('R$ 55,00')
   await h.turn(5,s.messages[4],[[c('commit_confirmed_proposal',h.proposals.appointment_create)]],s.allowedTools,[],['call-5-1-0:result'])
   expect((await h.state()).operations.booking.fields).toMatchObject({address:address.address,reference:address.reference,transport_mode:'client'})
   expect((await h.db.prepare(`SELECT transport_fee_cents FROM appointments WHERE tenant_id=?1`).bind(h.tenant).all()).results).toEqual([{transport_fee_cents:0}])
   for(const table of ['appointment_transport','appointment_transport_reservations'])expect((await h.db.prepare(`SELECT appointment_id FROM ${table} WHERE tenant_id=?1`).bind(h.tenant).all()).results).toEqual([])
   // Controlled branch of the same designed transport scenario: prove native
   // MotoDog commit and last-vehicle race, not just removal from the final draft.
   const peer=(thread:string,step:number,message:string,command:ReturnType<typeof c>,expectedFailures:string[]=[])=>peerRuntime({tenantId:h.tenant,conversationId:thread,phone:f.phone,step,message,command,now:Date.now(),expectedFailures})
   const p1=await peer('bike-peer-1',1,'Banho da Mel às 09h com MotoDog buscar e levar, Rua Teste 20, portão azul.',transportOrder)
   const p2=await peer('bike-peer-2',1,'Banho da Mel às 09h com MotoDog buscar e levar, Rua Teste 20, portão azul.',transportOrder)
   h.clock.mockReturnValue(Date.now()+10)
   const outcomes=await Promise.all([peer('bike-peer-1',2,'Confirmo o horário.',c('commit_confirmed_proposal',p1.proposal!),['TRANSPORT_SLOT_UNAVAILABLE']),peer('bike-peer-2',2,'Confirmo o horário.',c('commit_confirmed_proposal',p2.proposal!),['TRANSPORT_SLOT_UNAVAILABLE'])])
   expect(outcomes.filter(o=>o.result.committedOperationIds.length)).toHaveLength(1)
   const transport=await h.db.prepare(`SELECT appointment_id,fee_cents,pickup_address,dropoff_address,pickup_reference,dropoff_reference FROM appointment_transport WHERE tenant_id=?1`).bind(h.tenant).all()
   expect(transport.results).toHaveLength(1);expect(transport.results[0]).toMatchObject({fee_cents:2000,pickup_address:address.address,dropoff_address:address.address,pickup_reference:address.reference,dropoff_reference:address.reference})
   const appointmentId=String(transport.results[0].appointment_id)
   expect(await h.db.prepare(`SELECT transport_fee_cents FROM appointments WHERE tenant_id=?1 AND id=?2`).bind(h.tenant,appointmentId).first()).toEqual({transport_fee_cents:2000})
   await expect(h.db.prepare(`UPDATE appointment_transport SET option_id='pickup' WHERE tenant_id=?1 AND appointment_id=?2`).bind(h.tenant,appointmentId).run()).rejects.toThrow('TRANSPORT_REPREPARATION_REQUIRED')
   await expect(h.db.prepare(`UPDATE appointments SET scheduled_at_ms=scheduled_at_ms+600000 WHERE tenant_id=?1 AND id=?2`).bind(h.tenant,appointmentId).run()).rejects.toThrow('TRANSPORT_REPREPARATION_REQUIRED')
   const cancellation=await peer('bike-cancel',1,'Preciso cancelar o banho com MotoDog.',c('prepare_appointment_cancellation',{customer_id:f.customer,appointment_id:appointmentId,reason:null}))
   h.clock.mockReturnValue(Date.now()+10)
   await peer('bike-cancel',2,'Confirmo o cancelamento.',c('commit_confirmed_proposal',cancellation.proposal!))
   expect((await h.db.prepare(`SELECT appointment_id FROM transport_resource_allocations WHERE tenant_id=?1`).bind(h.tenant).all()).results).toEqual([])
   await expect(h.db.prepare(`UPDATE appointments SET status='scheduled' WHERE tenant_id=?1 AND id=?2`).bind(h.tenant,appointmentId).run()).rejects.toThrow('TRANSPORT_REPREPARATION_REQUIRED')
   for(const table of ['sales','payments'])expect(await h.db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE tenant_id=?1`).bind(h.tenant).first()).toEqual({count:0})
   expect(h.transcripts).toHaveLength(s.messages.length)
  }finally{h.close()}
 })
})
