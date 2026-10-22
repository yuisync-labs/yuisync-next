import {it,expect} from 'vitest'
import {createThinkHarness,command as c} from './fixtures/luna/thinkHarness'
for(const units of [1,2])it('prepares the language fixture with '+units+' units without commercial effects',async()=>{
 const h=await createThinkHarness(7300+units,'-language-fixture')
 try{
  await h.run('Prepare '+units+' unidades de Ração A para retirar.',[c('open_tools',{capability:'cart'}),h.update([h.add('racao-a',units),h.pickup])])
  const p=await h.db.prepare("SELECT payload_json FROM luna_proposals WHERE tenant_id=? AND status='awaiting_confirmation'").bind(h.tenant).first<{payload_json:string}>()
  expect(JSON.parse(p!.payload_json).items[0].quantity).toBe(units)
  expect((await h.saleRows()).results).toHaveLength(0)
 }finally{h.close()}
})
it('keeps separate prepared cart and booking proposals for scoped confirmation',async()=>{
 const h=await createThinkHarness(7400,'-language-fixture')
 try{
  const date=new Date();date.setUTCDate(date.getUTCDate()+3);while([0,6].includes(date.getUTCDay()))date.setUTCDate(date.getUTCDate()+1)
  const at=date.toISOString().slice(0,10)+'T09:00:00-03:00'
  await h.run('Prepare uma Ração A para retirar.',[c('open_tools',{capability:'cart'}),h.update([h.add(),h.pickup])])
  await h.run('Prepare também só banho da Mel em '+at+'. Eu levo e busco.',[c('open_tools',{capability:'agenda'}),h.update([h.add('banho'),{action:'set_field',field:'pet_id',value:'mel'},{action:'set_field',field:'scheduled_at',value:at}],true,'banho-mel','booking')])
  const proposals=(await h.db.prepare("SELECT operation_kind FROM luna_proposals WHERE tenant_id=? AND status='awaiting_confirmation' ORDER BY operation_kind").bind(h.tenant).all()).results
  expect(proposals).toEqual([{operation_kind:'appointment_create'},{operation_kind:'product_order_create'}])
  expect((await h.saleRows()).results).toHaveLength(0)
  expect((await h.db.prepare('SELECT id FROM appointments WHERE tenant_id=?').bind(h.tenant).all()).results).toHaveLength(0)
 }finally{h.close()}
})

// The extended fixture paths must work on real local D1 without any AI call.
import {createLiveHarness} from './fixtures/luna/liveHarness'
import {prepareLanguageCase} from './fixtures/luna/languageSetup'
const families=['confirmation_quote','fragmented_correction','scoped_operations','price_race','last_unit','transport_retry','handoff_interrupt','ambiguous_reference','tenant_injection','date_boundary','unknown_attribute','rating_quantity']
for(const [index,family] of families.entries())it('seeds '+family+' without inference or business effects',async()=>{
 const h=await createLiveHarness(8500+index);let restore=()=>{}
 try{
  const setup=await prepareLanguageCase(h,family);restore=setup.restore
  expect((await h.saleRows()).results).toHaveLength(0)
  expect((await h.db.prepare('SELECT id FROM appointments WHERE tenant_id=?').bind(h.tenant).all()).results).toHaveLength(0)
  const proposals=(await h.db.prepare("SELECT payload_json FROM luna_proposals WHERE tenant_id=? AND status='awaiting_confirmation'").bind(h.tenant).all<{payload_json:string}>()).results
  const expected=['tenant_injection','date_boundary','unknown_attribute','rating_quantity'].includes(family)?0:['scoped_operations','last_unit'].includes(family)?2:1
  expect(proposals).toHaveLength(expected)
  if(family==='ambiguous_reference')expect(JSON.parse(proposals[0].payload_json).items).toHaveLength(2)
  if(family==='last_unit'){expect(setup.peer).toBeDefined();expect(await h.db.prepare("SELECT on_hand_milliunits,reserved_milliunits FROM inventory_balances WHERE tenant_id=? AND product_id='racao-a'").bind(h.tenant).first()).toEqual({on_hand_milliunits:1000,reserved_milliunits:0})}
 }finally{restore();h.close()}
})

it('controls the store date while native alarms keep real time',async()=>{
 const h=await createLiveHarness(8600),wall=Date.now();let restore=()=>{}
 try{
  restore=(await prepareLanguageCase(h,'date_boundary')).restore
  expect(Date.now()-wall).toBeLessThan(3000)
  expect(new Date().toISOString().slice(0,16)).toBe('2026-11-02T02:55')
  const at='2026-11-02T09:00:00-03:00'
  await h.run('Banho da Mel amanhã às nove. Eu levo e busco.',[c('open_tools',{capability:'agenda'}),h.update([h.add('banho'),{action:'set_field',field:'pet_id',value:'mel'},{action:'set_field',field:'scheduled_at',value:at}],true,'banho-mel','booking')])
  const p=await h.db.prepare("SELECT payload_json FROM luna_proposals WHERE tenant_id=? AND operation_kind='appointment_create'").bind(h.tenant).first<{payload_json:string}>()
  expect(JSON.parse(p!.payload_json).scheduled_at_ms).toBe(Date.parse(at))
 }finally{restore();h.close()}
})
