import { describe,expect,it } from 'vitest'
import { createDesignedHarness } from './fixtures/luna/designedRuntimeHarness'
import { LUNA_DESIGNED_SCENARIOS,LUNA_SCENARIO_FIXTURE } from './fixtures/luna/designedScenarios'
describe('designed scenario 16 — real Worker/local D1/simulated provider',()=>{
 it('occupied slot, actual alternatives, revalidated reschedule, reconfirmation and cancellation',async()=>{
  const s=LUNA_DESIGNED_SCENARIOS.find(s=>s.id===16)!,h=await createDesignedHarness(16),f=LUNA_SCENARIO_FIXTURE,c=h.command,d=h.draft
  try{
   await h.db.prepare(`UPDATE module_settings_extensions SET data_json=json_set(data_json,'$.petbot_booking_capacity',1) WHERE tenant_id=?1`).bind(h.tenant).run()
   await h.db.prepare(`INSERT INTO appointments(tenant_id,module_id,id,client_id,pet_id,scheduled_at_ms,duration_min,service_group,status,source,subtotal_cents,transport_fee_cents,version,created_at_ms,updated_at_ms) VALUES(?1,'petshop','occupied',?2,'mel',?3,60,'banho_tosa','blocked','manual',0,0,1,?4,?4)`).bind(h.tenant,f.customer,Date.parse('2026-10-07T17:00:00Z'),h.start).run()
   await h.turn(1,s.messages[0],[[c('get_customer_context',{}),c('search_services',{query:'banho'}),d('booking','booking','set_field',{field:'pet_id',value:'mel'}),d('booking','booking','add_item',{itemId:'banho',quantity:1}),d('booking','booking','set_field',{field:'period',value:'manhã'})]],s.allowedTools)
   const blocked=await h.turn(2,s.messages[1],[[d('booking','booking','set_field',{field:'period',value:'tarde'}),d('booking','booking','set_field',{field:'scheduled_at',value:'2026-10-07T17:00:00Z'}),h.booking('2026-10-07T17:00:00Z')]],s.allowedTools,['SLOT_UNAVAILABLE'],['call-2-1-2:unavailable'])
   expect(blocked.proposalIds).toEqual([]);expect(blocked.reply).not.toContain('Agendamento registrado')
   let alternative=''
   await h.turn(3,s.messages[2],[[c('get_available_slots',{service_ids:['banho'],starts_at:'2026-10-07T17:00:00Z',ends_at:'2026-10-07T21:00:00Z'})],results=>{
    const slots=results.find(r=>r.data?.slots)!.data.slots as string[];expect(slots).not.toContain('2026-10-07T17:00:00.000Z');alternative=slots[0]
    return[d('booking','booking','set_field',{field:'scheduled_at',value:alternative}),h.booking(alternative)]
   }],s.allowedTools)
   const booked=await h.turn(4,s.messages[3],[[c('commit_confirmed_proposal',h.proposals.appointment_create)]],s.allowedTools,[],['call-4-1-0:result'])
   const appointmentId=booked.committedOperationIds[0]
   expect(appointmentId).toBeDefined()
   const friday='2026-10-09T18:00:00Z'
   await h.turn(5,s.messages[4],[[d('booking','booking','set_field',{field:'scheduled_at',value:friday}),c('prepare_appointment_reschedule',{customer_id:f.customer,appointment_id:appointmentId,scheduled_at:friday,operation_id:'booking'})]],s.allowedTools)
   expect(await h.db.prepare(`SELECT scheduled_at_ms FROM appointments WHERE tenant_id=?1 AND id=?2`).bind(h.tenant,appointmentId).first()).toEqual({scheduled_at_ms:Date.parse(alternative)})
   await h.turn(6,s.messages[5],[[c('commit_confirmed_proposal',h.proposals.appointment_reschedule)]],s.allowedTools,[],['call-6-1-0:result'])
   expect(await h.db.prepare(`SELECT scheduled_at_ms,version FROM appointments WHERE tenant_id=?1 AND id=?2`).bind(h.tenant,appointmentId).first()).toEqual({scheduled_at_ms:Date.parse(friday),version:2})
   await h.turn(7,s.messages[6],[[c('prepare_appointment_cancellation',{customer_id:f.customer,appointment_id:appointmentId,reason:null,operation_id:'booking'})]],s.allowedTools)
   expect(await h.db.prepare(`SELECT status FROM appointments WHERE tenant_id=?1 AND id=?2`).bind(h.tenant,appointmentId).first()).toEqual({status:'scheduled'})
   await h.turn(8,s.messages[7],[[c('commit_confirmed_proposal',h.proposals.appointment_cancel)]],s.allowedTools,[],['call-8-1-0:result'])
   expect(await h.db.prepare(`SELECT status,version FROM appointments WHERE tenant_id=?1 AND id=?2`).bind(h.tenant,appointmentId).first()).toEqual({status:'cancelled',version:3})
   expect((await h.state()).operations.booking.fields.scheduled_at).toBe(friday)
   for(const table of ['sales','payments'])expect(await h.db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE tenant_id=?1`).bind(h.tenant).first()).toEqual({count:0})
   expect(h.transcripts).toHaveLength(s.messages.length)
  }finally{h.close()}
 })
})
