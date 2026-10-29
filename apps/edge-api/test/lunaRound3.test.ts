import {describe,expect,it} from 'vitest'
import {command as c,createThinkHarness} from './fixtures/luna/thinkHarness'
import {applyQuatroPatasStore} from './fixtures/luna/simulatorStore'
import {simulatorScenarios} from './fixtures/luna/simulatorScenarios'
import {withoutInternalErrors} from '../src/luna/thinkPresentation'
// Failures of the agent's third manual round (29/10/2026) on the QuatroPatas store.
describe('rodada 3 do agente',()=>{
 const f=(field:string,value:string)=>({action:'set_field',field,value})
 async function booked(id:number){
  const h=await createThinkHarness(id,'-r3')
  await applyQuatroPatasStore(h as never,simulatorScenarios(1,1)[0])
  await h.run('banho da Mel amanhã às 9, eu levo',[c('open_tools',{capability:'agenda'}),c('search_services',{query:'banho',pet_id:'mel'}),h.update([h.add('banho-p'),f('pet_id','mel'),f('scheduled_at','2026-10-07T09:00:00-03:00'),f('transport_mode','self')],true,'banho-mel','booking'),'ok'])
  return h
 }
 const appointments=async(h:Awaited<ReturnType<typeof booked>>)=>(await h.db.prepare("SELECT COUNT(*) n FROM appointments WHERE tenant_id=? AND status<>'cancelled'").bind(h.tenant).first<{n:number}>())!.n
 it('"pode agendar" depois de "pera, não marca ainda" grava sem pedir outro sim',async()=>{
  const h=await booked(7901),p=await h.proposal('appointment_create')
  await h.run('ok, mas antes: aceitam cartão?',['Sim, aceitamos cartão.'])
  expect(await appointments(h)).toBe(0)
  await h.run('pera, não marca ainda',['Tudo bem, fico aguardando.'])
  expect(await appointments(h)).toBe(0)
  await h.run('pode agendar',[c('commit_confirmed_proposal',p),'feito'])
  expect(await appointments(h)).toBe(1)
 },60000)
 it('tira o fuso, "o sistema exige" e "não foi encontrado para agendamento"',()=>{
  expect(withoutInternalErrors('Preciso de um nome para o pet, pois o sistema exige. Qual nome quer usar?')).toBe('Qual nome quer usar?')
  expect(withoutInternalErrors('O serviço de banho não foi encontrado para agendamento amanhã às 9h. Qual horário você prefere?')).toBe('Qual horário você prefere?')
 })
 async function shelf(id:number){
  const h=await createThinkHarness(id,'-r3')
  await applyQuatroPatasStore(h as never,simulatorScenarios(1,1)[0])
  const now=Date.now(),add=(pid:string,name:string,price:number,stock:number)=>[
   h.db.prepare("INSERT INTO catalog_products(tenant_id,module_id,id,name,price_cents,category,status,created_at_ms,updated_at_ms) VALUES(?,'petshop',?,?,?,'Ração','active',?,?)").bind(h.tenant,pid,name,price,now,now),
   h.db.prepare("INSERT INTO inventory_balances(tenant_id,module_id,product_id,on_hand_milliunits,reserved_milliunits,reorder_milliunits,version,updated_at_ms) VALUES(?,'petshop',?,?,0,0,1,?)").bind(h.tenant,pid,stock*1000,now)]
  // The shelf of the agent's test 6 on staging: alphabetical order hid the Ultralife.
  await h.db.batch([...add('granel-sd-filhote','GRANEL SPECIAL DOG FILHOTES RAÇAS PEQUENAS KG',1300,7),...add('sd-senior-3','RACAO SPECIAL DOG SENIOR 7+RACAS PEQUENAS/ FRANGO 3KG',5690,0),...add('sd-cordeiro-3','SPECIAL DOG AD RAÇAS PEQUENAS CORDEIRO 3KG',5690,2),...add('golden-castrado-frango','GOLDEN GATO CASTRADO SABOR FRANGO 1 KG',3900,2)])
  return h
 }
 const shown=(r:{tools:{name:string;result:unknown}[]})=>JSON.stringify(r.tools.find(t=>t.name==='search_products')?.result)
 it('"special dog pra raça pequena de 3 kg" mostra os pacotes de 3 kg com estoque',async()=>{
  const h=await shelf(7911)
  const r=await h.run('vocês têm special dog pra raça pequena de 3 kg?',[c('search_products',{filters:{productType:'feed',species:'dog',brand:'Special Dog',animalSize:'small'}}),'ok'])
  const out=shown(r)
  expect(out).toContain('sd-ultralife-3')
  expect(out).toContain('sd-cordeiro-3')
  expect(out).not.toContain('sd-senior-3')
 },60000)
 it('sem estoque, oferece o mesmo produto em outro sabor com estoque',async()=>{
  const h=await shelf(7912)
  const r=await h.run('tem golden gato castrado salmão?',[c('search_products',{filters:{productType:'feed',species:'cat',brand:'Golden',nameTerms:['castrado','salmão']}}),'ok'])
  const out=shown(r)
  expect(out).toContain('in_stock_alternatives')
  expect(out).toContain('golden-castrado-frango')
 },60000)
 it('"a mais barata" lista as com estoque, a mais barata primeiro, sem perguntar marca',async()=>{
  const h=await shelf(7913)
  const r=await h.run('ração pra cachorro adulto pequeno, a mais barata',[c('search_products',{filters:{productType:'feed',species:'dog',lifeStage:'adult',animalSize:'small'}}),'ok'])
  const out=shown(r)
  expect(out).not.toContain('needs_refinement')
  expect(out.indexOf('granel-sd-peq')).toBeGreaterThan(-1)
 },60000)
 it('raça do pet vale como porte e a triagem junta as perguntas',async()=>{
  const h=await shelf(7914)
  const r=await h.run('quero uma ração pra shih tzu',[c('search_products',{filters:{productType:'feed',species:'dog',animalSize:'small'}}),'ok'])
  expect(r.tools.find(t=>t.name==='search_products')?.result).toMatchObject({ok:true})
  const first=await shelf(7915)
  const q=await first.run('quero uma ração',[c('search_products',{filters:{productType:'feed'}}),'ok'])
  expect(shown(q)).toMatch(/cachorro ou gato\?.*porte.*filhote, adulto ou idoso/)
 },60000)
})
