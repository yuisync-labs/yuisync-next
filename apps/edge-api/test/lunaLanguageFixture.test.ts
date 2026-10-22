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
