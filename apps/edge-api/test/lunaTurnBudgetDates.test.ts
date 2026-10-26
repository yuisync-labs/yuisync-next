import {describe,expect,it} from 'vitest'
import {storeCalendar} from '../src/luna/thinkPolicy'
import {ambiguousQuantityChange} from '../src/luna/thinkCart'
import {command as c,createThinkHarness} from './fixtures/luna/thinkHarness'

describe('calendário da loja',()=>{
 it('resolve hoje e amanhã no fuso da loja perto da meia-noite UTC',()=>{
  const cal=storeCalendar(new Date('2026-11-02T02:30:00Z'),'America/Sao_Paulo')
  expect(cal.local_now).toBe('2026-11-01 23:30')
  expect(cal.dates.split('; ').slice(0,3)).toEqual(['hoje dom 2026-11-01','amanhã seg 2026-11-02','ter 2026-11-03'])
  expect(cal.dates.split('; ')).toHaveLength(8)
 })
 it('usa São Paulo quando o fuso cadastrado é inválido',()=>expect(storeCalendar(new Date('2026-11-02T02:30:00Z'),'Lua/Crateras').timezone).toBe('America/Sao_Paulo'))
})

describe('referência ambígua no carrinho',()=>{
 const prior={items:[{id:'racao-a',quantity:1},{id:'racao-b',quantity:1}]}
 const names={'racao-a':'Ração A','racao-b':'Ração B'}
 const both=[{action:'set_quantity',item_id:'racao-a',quantity:2},{action:'set_quantity',item_id:'racao-b',quantity:2}]
 it.each(['Dessa coloca duas.','Aquela lá, aumenta pra dois pacotes.','Quero 2 da ração, da que a gente falou.'])('bloqueia: %s',text=>expect(ambiguousQuantityChange(prior,both,text,names)).toBe(true))
 it.each(['Coloca duas de cada.','As duas rações com 2 unidades.','Ração A e Ração B, duas de cada uma.','Ração A com 2 e Ração B com 2.'])('aceita: %s',text=>expect(ambiguousQuantityChange(prior,both,text,names)).toBe(false))
 it('aceita quando só um item muda',()=>expect(ambiguousQuantityChange(prior,[both[0]],'Dessa coloca duas.',names)).toBe(false))
})

describe('Think: orçamento do turno, preço alterado e referência ambígua',()=>{
 it('conclui um agendamento em quatro passos com prompt de 9.000 tokens',async()=>{
  const h=await createThinkHarness(911,'-budget',undefined,{profileModel:false,inputTokens:9000})
  const turn=await h.run('Banho da Mel amanhã às 14h, eu levo.',[
   c('open_tools',{capability:'agenda'}),
   c('search_services',{query:'banho',pet_id:'mel'}),
   c('get_available_slots',{service_ids:['banho'],starts_at:'2026-10-07T13:00:00-03:00',ends_at:'2026-10-07T18:00:00-03:00'}),
   h.update([h.add('banho'),{action:'set_field',field:'pet_id',value:'mel'},{action:'set_field',field:'scheduled_at',value:'2026-10-07T17:00:00Z'}],true,'banho-mel','booking'),
  ])
  expect(turn.result.status,turn.result.reply).toBe('awaiting_confirmation')
 },30000)
 it('refaz o resumo com o preço atual quando o preço muda antes da confirmação',async()=>{
  const h=await createThinkHarness(912,'-price')
  await h.run('Ração A, uma, para retirada',[c('open_tools',{capability:'cart'}),h.update([h.add(),h.pickup])])
  await h.db.prepare("UPDATE catalog_products SET price_cents=price_cents+500 WHERE tenant_id=? AND id='racao-a'").bind(h.tenant).run()
  const {price_cents:price}=(await h.db.prepare("SELECT price_cents FROM catalog_products WHERE tenant_id=? AND id='racao-a'").bind(h.tenant).first<{price_cents:number}>())!
  const stale=await h.run('Confirmo o pedido do resumo.',[c('commit_confirmed_proposal',{proposal_id:'x',proposal_version:1})],['PROPOSAL_STALE'])
  expect(stale.result.status).toBe('awaiting_confirmation')
  expect(stale.result.reply).toContain('mudaram')
  expect((await h.saleRows()).results).toHaveLength(0)
  expect(JSON.parse((await h.db.prepare("SELECT payload_json FROM luna_proposals WHERE tenant_id=? AND status='awaiting_confirmation'").bind(h.tenant).first<{payload_json:string}>())!.payload_json).total_cents).toBe(price)
  await h.run('Confirmo o resumo.',[c('commit_confirmed_proposal',{proposal_id:'x',proposal_version:1})])
  expect((await h.saleRows()).results).toMatchObject([{status:'pending',total_cents:price}])
 },30000)
 it('pergunta qual item muda em vez de alterar as duas rações',async()=>{
  const h=await createThinkHarness(913,'-ambiguous')
  await h.run('Uma Ração A e uma Ração B para retirada',[c('open_tools',{capability:'cart'}),h.update([h.add(),h.add('racao-b'),h.pickup])])
  const turn=await h.run('Dessa coloca duas.',[c('set_cart',{items:[{product_id:'racao-a',quantity:2},{product_id:'racao-b',quantity:2}],fulfillment_type:'counter'}),'Qual das rações você quer com duas unidades, a Ração A ou a Ração B?'],['REFERENCE_AMBIGUOUS'])
  expect(turn.result.reply).toContain('Qual das rações')
  const p=await h.db.prepare("SELECT payload_json FROM luna_proposals WHERE tenant_id=? AND status='awaiting_confirmation'").bind(h.tenant).first<{payload_json:string}>()
  expect(JSON.parse(p!.payload_json).items.map((i:{quantity:number})=>i.quantity)).toEqual([1,1])
 },30000)
})
