import { env } from 'cloudflare:workers'
import { describe,expect,it,vi } from 'vitest'
import { createLunaToolRegistry } from '../src/luna/toolRegistry'
import { loadPresentableProposals,recordProposalPresentation,renderProposalSummary } from '../src/luna/proposalPresentation'
import { appointmentScheduleGuardStatement } from '../src/appointmentScheduleGuard'
const db=(env as EdgeEnv & {DB:D1Database}).DB
describe('native booking safety on local D1',()=>{
 it('fecha corrida de agenda no batch, rollback e persistência da máquina',async()=>{
  const tenant='luna-booking-safety',now=Date.parse('2026-10-06T12:00:00Z'),at=Date.parse('2026-10-07T12:00:00Z')
  const clock=vi.spyOn(Date,'now').mockReturnValue(now)
  const settingsJSON=JSON.stringify({petbot_timezone:'America/Sao_Paulo',petbot_booking_capacity:1,petbot_business_hours:Object.fromEntries(Array.from({length:7},(_,i)=>[String(i+1),[{open:'08:00',close:'18:00'}]]))})
  try{
   await db.batch([
    db.prepare(`INSERT INTO tenants(id,slug,name,status,created_at_ms,updated_at_ms) VALUES(?1,?1,'Segurança fictícia','active',?2,?2)`).bind(tenant,now),
    db.prepare(`INSERT INTO clients(tenant_id,module_id,id,name,phone,status,created_at_ms,updated_at_ms) VALUES(?1,'petshop','customer','Maria','5532999990181','active',?2,?2)`).bind(tenant,now),
    db.prepare(`INSERT INTO pets(tenant_id,module_id,id,client_id,name,species,weight_kg,status,created_at_ms,updated_at_ms) VALUES(?1,'petshop','pet','customer','Mel','dog',8,'active',?2,?2)`).bind(tenant,now),
    db.prepare(`INSERT INTO module_settings_extensions(tenant_id,module_id,data_json,updated_at_ms) VALUES(?1,'petshop',?2,?3)`).bind(tenant,settingsJSON,now),
    ...['tosa-maquina','tosa-tesoura'].map(code=>db.prepare(`INSERT INTO services(tenant_id,module_id,id,code,name,group_type,default_price_cents,default_duration_min,status,created_at_ms,updated_at_ms) VALUES(?1,'petshop',?2,?2,?2,'banho_tosa',10000,90,'active',?3,?3)`).bind(tenant,code,now)),
   ])
   const registry=createLunaToolRegistry(db)
   const base={tenantId:tenant,moduleId:'petshop' as const,conversationId:'',customerAddress:'5532999990181',phoneNumberId:'fixture',sourceMessageId:'prepare',traceId:'booking-safety',executionMode:'fixture' as const}
   const args={customer_id:'customer',pet_id:'pet',service_ids:['tosa-maquina'],scheduled_at:new Date(at).toISOString(),notes:null}
   expect(await registry.execute('prepare_appointment',args,{...base,conversationId:'missing-number'})).toMatchObject({ok:false,code:'GROOMING_MACHINE_REQUIRED'})
   expect(await registry.execute('prepare_appointment',{...args,service_ids:['tosa-tesoura'],grooming_machine_no:4},{...base,conversationId:'wrong-service'})).toMatchObject({ok:false,code:'GROOMING_MACHINE_NOT_APPLICABLE'})
   const committers=[]
   for(const id of ['one','two']){
    const ctx={...base,conversationId:id}
    await db.prepare(`INSERT INTO chat_threads(tenant_id,module_id,id,channel,external_thread_id,status,last_message_at_ms,created_at_ms,updated_at_ms) VALUES(?1,'petshop',?2,'whatsapp',?2,'open',?3,?3,?3)`).bind(tenant,id,now).run()
    const prepared=await registry.execute('prepare_appointment',{...args,grooming_machine_no:4},ctx)
    expect(prepared.ok).toBe(true)
    const data=(prepared as {data:{proposal_id:string;proposal_version:number}}).data
    const summary=renderProposalSummary((await loadPresentableProposals(db,ctx,[data.proposal_id]))[0])
    expect(summary).toContain('Número da máquina: 4')
    await db.prepare(`INSERT INTO chat_messages(tenant_id,module_id,id,thread_id,direction,actor_type,content_text,created_at_ms) VALUES(?1,'petshop',?2,?3,'outbound','assistant',?4,?5)`).bind(tenant,`out-${id}`,id,summary,now).run()
    await recordProposalPresentation(db,ctx,[data.proposal_id],`out-${id}`)
    await db.prepare(`INSERT INTO chat_messages(tenant_id,module_id,id,thread_id,external_message_id,direction,actor_type,content_text,created_at_ms) VALUES(?1,'petshop',?2,?3,?2,'inbound','customer','Confirmo o horário.',?4)`).bind(tenant,`in-${id}`,id,now+1).run()
    committers.push(()=>registry.execute('commit_confirmed_proposal',{proposal_id:data.proposal_id,proposal_version:1},{...ctx,sourceMessageId:`in-${id}`}))
   }
   clock.mockReturnValue(now+2)
   const outcomes=await Promise.all(committers.map(f=>f()))
   expect(outcomes.filter(r=>r.ok)).toHaveLength(1)
   expect(outcomes.filter(r=>!r.ok)).toHaveLength(1)
   const appointments=await db.prepare('SELECT id,grooming_machine_no FROM appointments WHERE tenant_id=?1').bind(tenant).all()
   expect(appointments.results).toHaveLength(1)
   expect(appointments.results[0].grooming_machine_no).toBe(4)
   expect(await db.prepare('SELECT COUNT(*) AS count FROM appointment_command_registry WHERE tenant_id=?1').bind(tenant).first()).toEqual({count:1})
   // A writer that does not call the agent still cannot overwrite its reservation.
   await expect(db.prepare(`INSERT INTO appointments(tenant_id,module_id,id,client_id,pet_id,scheduled_at_ms,duration_min,service_group,status,source,subtotal_cents,transport_fee_cents,version,created_at_ms,updated_at_ms) VALUES(?1,'petshop','manual','customer','pet',?2,90,'banho_tosa','scheduled','manual',10000,0,1,?3,?3)`).bind(tenant,at,now).run()).rejects.toThrow('SCHEDULE_CAPACITY_EXCEEDED')
   // Prove the DB guard independently of the application precheck.
   await expect(db.batch([
    appointmentScheduleGuardStatement(db,{tenantId:tenant,moduleId:'petshop',appointmentId:'raced',guard:{capacity:1,settingsJSON}}),
    db.prepare(`INSERT INTO appointments(tenant_id,module_id,id,client_id,pet_id,scheduled_at_ms,duration_min,service_group,status,source,subtotal_cents,transport_fee_cents,version,created_at_ms,updated_at_ms) VALUES(?1,'petshop','raced','customer','pet',?2,90,'banho_tosa','scheduled','whatsapp',10000,0,1,?3,?3)`).bind(tenant,at,now),
   ])).rejects.toThrow('SCHEDULE_CAPACITY_EXCEEDED')
   expect(await db.prepare(`SELECT appointment_id FROM appointment_schedule_guards WHERE tenant_id=?1 AND appointment_id='raced'`).bind(tenant).first()).toBeNull()
  }finally{clock.mockRestore()}
 })
})
