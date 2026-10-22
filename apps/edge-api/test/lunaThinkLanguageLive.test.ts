import {env} from 'cloudflare:workers'
import {describe,it,expect} from 'vitest'
import {createLiveHarness,liveService} from './fixtures/luna/liveHarness'
import {command as c} from './fixtures/luna/thinkHarness'
import catalogue from '../../../docs/luna-think-language-cases.json'
const liveIds=(env as unknown as {LANG_CASE_IDS?:string}).LANG_CASE_IDS
const selected=String(liveIds??'LANG-01-1,LANG-02-1,LANG-04-1').split(',')
const cases=catalogue.cases.filter(s=>selected.includes(s.id))
// These tests are admitted only by vitest.language-live.config.ts. Standard CI
// skips them; importing a plan does not constitute live certification.
describe.skipIf(!liveService||!liveIds)('Budgeted real-model language variants',()=>{
 for(const s of cases)it(s.id+' '+s.name,async test=>{
  const control=await(await liveService.fetch('https://live-model.local/control')).json() as {stop:boolean}
  if(control.stop){test.skip();return}
  if(!['confirmation_quote','fragmented_correction','scoped_operations'].includes(s.family))throw Error('VARIANT_NOT_IMPLEMENTED')
  const number=Number(s.id.split('-')[1])*100+Number(s.id.split('-')[2]),h=await createLiveHarness(2000+number)
  const sales=()=>h.saleRows().then(r=>r.results)
  const appointments=()=>h.db.prepare('SELECT id,status FROM appointments WHERE tenant_id=?').bind(h.tenant).all()
  try{
   // Deterministic setup is a fixture, not a language pass: only challenge and
   // follow-up turns below use native GLM via the shared daily budget proxy.
   await h.run('Prepare '+(s.family==='fragmented_correction'?2:1)+' unidades de Ração A para retirar.',[c('open_tools',{capability:'cart'}),h.update([h.add('racao-a',s.family==='fragmented_correction'?2:1),h.pickup])])
   let at=''
   if(s.family==='scoped_operations'){
    const date=new Date();date.setUTCDate(date.getUTCDate()+3);while([0,6].includes(date.getUTCDay()))date.setUTCDate(date.getUTCDate()+1)
    at=date.toISOString().slice(0,10)+'T09:00:00-03:00'
    await h.run('Prepare também só banho da Mel em '+at+'. Eu levo e busco.',[c('open_tools',{capability:'agenda'}),h.update([h.add('banho'),{action:'set_field',field:'pet_id',value:'mel'},{action:'set_field',field:'scheduled_at',value:at}],true,'banho-mel','booking')])
   }
   await h.attachLiveModel()
   expect(await sales()).toHaveLength(0)
   const challenge=await h.turn(s.input_fragments)
   expect(challenge.status,'Unexpected handoff: '+challenge.reply).not.toBe('handoff')
   expect(await sales(),'No purchase may be committed by this challenge').toHaveLength(0)
   const beforeFollow={sales:await sales(),appointments:(await appointments()).results,reply:challenge.reply}
   if(s.family==='scoped_operations')expect(beforeFollow.appointments).toHaveLength(1)
   else expect(beforeFollow.appointments).toHaveLength(0)
   if(s.family==='fragmented_correction'){
    expect(challenge.status).toBe('awaiting_confirmation')
    const p=await h.db.prepare("SELECT payload_json FROM luna_proposals WHERE tenant_id=? AND operation_kind='product_order_create' AND status='awaiting_confirmation' ORDER BY updated_at_ms DESC LIMIT 1").bind(h.tenant).first<{payload_json:string}>()
    const payload=JSON.parse(p!.payload_json);expect(payload.items).toHaveLength(1);expect(payload.items[0].quantity).toBe(1)
   }
   const follow=await h.turn(s.follow_up!)
   expect(follow.status,'Follow-up failed: '+follow.reply).not.toBe('handoff')
   const rows=await sales()
   if(s.family==='scoped_operations'){expect(rows).toHaveLength(0);expect((await appointments()).results).toHaveLength(1)}
   else{
    expect(rows).toHaveLength(1);expect(rows[0]).toMatchObject({status:'pending',total_cents:9000})
    expect(await h.db.prepare("SELECT reserved_milliunits FROM inventory_balances WHERE tenant_id=? AND product_id='racao-a'").bind(h.tenant).first()).toEqual({reserved_milliunits:1000})
   }
   expect(await h.db.prepare('SELECT count(*) n FROM payments WHERE tenant_id=?').bind(h.tenant).first()).toEqual({n:0})
   await h.evidence('passed',{languageCaseId:s.id,setup:'deterministic_fixture',beforeFollow,after:{sales:rows,appointments:(await appointments()).results},model:'@cf/zai-org/glm-4.7-flash'})
  }catch(error){await h.evidence('failed',{languageCaseId:s.id,error:String(error)});throw error}finally{h.close()}
 })
})
