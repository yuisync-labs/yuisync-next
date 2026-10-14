import {test} from 'node:test'
import assert from 'node:assert/strict'
import {distributeWaitingGrooming} from '../scripts/migration/legacy-supabase/agendaWaitingDistribution.mjs'
import {buildAgendaSyncPlan} from '../scripts/migration/legacy-supabase/agendaSyncPlan.mjs'
import {projectLegacyAgendaSnapshot} from '../scripts/migration/legacyCanonicalProjection.mjs'
const staff=[{key:'a',name:'Ana'},{key:'b',name:'Bia'}]
const settings=[{module_id:'petshop',data_json:JSON.stringify({petshop_operational_staff:staff})}]
const row=(id,status='scheduled',key=null)=>({id,status,responsible_staff_key:key,service_group:'banho_tosa',scheduled_at_ms:1,updated_at_ms:1})
test('balances appointment, bath and grooming counts deterministically while preserving history',()=>{
 const appts=Array.from({length:8},(_,i)=>row(String(i)))
 appts.push(row('done','completed'),row('assigned','scheduled','a'),{...row('vet'),service_group:'veterinaria'})
 const services=appts.map((a,i)=>({appointment_id:a.id,service_name:i%2?'Tosa':'Banho'}))
 const first=distributeWaitingGrooming(appts,services,[],staff)
 assert.deepEqual(first.totals.map(t=>[t.appointments,t.baths,t.grooming]),[[4,2,2],[4,2,2]])
 assert.deepEqual([...first.assignments], [...distributeWaitingGrooming(appts,services,[],staff).assignments])
 for(const id of ['done','assigned','vet'])assert.equal(first.assignments.has(id),false)
})
test('preserves newer native rows and completed unassigned commission snapshots',()=>{
 const history={...row('done','completed'),responsible_staff_name:null}
 const source={appointments:[history,row('local')],pets:[],clients:[],services:[],appointment_services:[{appointment_id:'done',position:0,commission_basis_points:null}],module_settings_extensions:settings}
 const destination={appointments:[history,{...row('local','scheduled','b'),updated_at_ms:2}],pets:[],clients:[],appointment_services:source.appointment_services,module_settings_extensions:settings}
 const plan=buildAgendaSyncPlan({source,destination,now:3})
 assert.deepEqual(plan.protected_local,['local'])
 assert.deepEqual(plan.conflicts,[])
 assert.equal(plan.expected_appointments[0].responsible_staff_key,null)
 assert.deepEqual(plan.assignments,{})
 assert.equal(plan.updates.appointment_services,undefined)
})

test('agenda projection preserves recorded rates and missing staff without rebuilding financial ledgers',()=>{
 const scoped=r=>({tenant_id:'t',module_id:'petshop',...r})
 const projected=projectLegacyAgendaSnapshot({tables:{
  petshop_services:[scoped({id:'svc',code:'banho',name:'Banho',group_type:'banho_tosa',default_price:100,commission_rate:50,active:true})],
  appointments:[5,null].map((rate,i)=>scoped({id:String(i),pet_id:'pet',client_id:'client',status:'concluido',service_type:'banho',service_group:'banho_tosa',price:100,scheduled_at:'2026-10-13T09:00:00Z',responsible_staff_key:i===0?'a':null,service_items:[{code:'banho',name:'Banho',unit_price:100,commission_rate:rate}]})),
 }},{tenantId:'t'})
 assert.deepEqual(projected.collections.appointment_services.map(s=>s.commission_basis_points),[500,null])
 assert.deepEqual(projected.collections.appointments.map(a=>a.responsible_staff_key),['a',null])
 assert.equal(projected.collections.subscription_benefit_allocations,undefined)
 assert.equal(projected.collections.client_subscriptions,undefined)
})
