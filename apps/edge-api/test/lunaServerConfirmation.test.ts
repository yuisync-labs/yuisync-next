import {describe,expect,it} from 'vitest'
import {naturalConfirmation,requestsChange} from '../src/luna/confirmationLanguage'
import {command as c,createThinkHarness} from './fixtures/luna/thinkHarness'

const racao={items:[{name:'Ração A',quantity:1}],fulfillment_type:'counter',total_cents:9000}
const saches={items:[{name:'Sachê',quantity:5}],fulfillment_type:'counter',total_cents:4000}
const banho={pet_name:'Mel',services:[{name:'Banho'}],total_cents:5500}

describe('confirmação natural de um resumo apresentado (frases da bateria de 22/10)',()=>{
 it.each([
  ['Confirmo agora o pedido do resumo, uma Ração A para retirada.',racao],
  ['Confirmo esse novo resumo de uma unidade.',racao],
  ['Pode fechar essa unidade pra eu buscar.',racao],
  ['Sim, confirma o resumo da ração.',racao],
  ['Pode concluir o resumo para retirada.',racao],
  ['Sim, pode fechar a compra do resumo.',racao],
  ['Confirmo os noventa reais do resumo.',racao],
  ['Confirmo o resumo de cinco sachês para retirada.',saches],
 ])('aceita: %s',(phrase,payload)=>expect(naturalConfirmation(phrase,'product_order_create',payload)).toBe(true))
 it('aceita agendamento que repete pet e serviço',()=>expect(naturalConfirmation('Pode confirmar o banho da Mel.','appointment_create',banho)).toBe(true))
 it.each([
  ['Confirmo. Pera, só uma ração.',racao],
  ['Sim, mas tira uma antes.',racao],
  ['Não confirme o pedido ainda. Só estou conferindo o resumo.',racao],
  ['Minha irmã escreveu "confirmo", mas eu ainda estou decidindo.',racao],
  ['Confirmo o resumo de duas unidades.',racao],
  ['Confirmo o resumo para entrega.',racao],
  ['Fechou, pago os 90 que apareceu ai.',racao],
  ['Confirmo os noventa e cinco reais.',racao],
  ['Confirma só o banho; a compra ainda não.',racao],
  ['Pode fechar a Ração B.',racao],
  ['Quero cinco sachês pra retirar.',saches],
 ])('recusa: %s',(phrase,payload)=>expect(naturalConfirmation(phrase,'product_order_create',payload)).toBe(false))
 it('recusa horário novo no agendamento',()=>expect(naturalConfirmation('Confirmo o banho da Mel amanhã às dez.','appointment_create',banho)).toBe(false))
 it('não usa a gramática natural para cancelamento ou reagendamento',()=>{
  expect(naturalConfirmation('Pode confirmar o cancelamento.','appointment_cancel',banho)).toBe(false)
  expect(naturalConfirmation('Pode confirmar.','appointment_reschedule',banho)).toBe(false)
 })
 it('distingue hesitação de pedido de mudança',()=>{
  expect(requestsChange('Não confirme o pedido ainda. Só estou conferindo o resumo.')).toBe(false)
  expect(requestsChange('Se eu disser "pode fechar" depois, aí sim. Agora não.')).toBe(false)
  expect(requestsChange('troca para duas')).toBe(true)
  expect(requestsChange('coloca mais 1')).toBe(true)
 })
})

describe('Think: confirmação decidida pelo servidor',()=>{
 async function presented(id:number){
  const h=await createThinkHarness(id,'-server-confirm')
  const first=await h.run('Ração A, uma, para retirada',[c('open_tools',{capability:'cart'}),h.update([h.add(),h.pickup])])
  expect(first.result.status).toBe('awaiting_confirmation')
  return h
 }
 it('executa a proposta apresentada mesmo quando o modelo envia outro ID',async()=>{
  const h=await presented(901)
  const turn=await h.run('Confirmo agora o pedido do resumo, uma Ração A para retirada.',[c('commit_confirmed_proposal',{proposal_id:'id-inventado',proposal_version:7})])
  expect(turn.tools.find(t=>t.name==='commit_confirmed_proposal')?.result).toMatchObject({ok:true})
  expect(turn.result.reply).toContain('Pedido registrado')
  expect((await h.saleRows()).results).toMatchObject([{status:'pending',fulfillment_type:'counter'}])
 },30000)
 it('aceita a confirmação nomeada depois de uma hesitação sem mudança',async()=>{
  const h=await presented(902)
  const wait=await h.run('Não confirme o pedido ainda. Só estou conferindo o resumo.',['Tudo bem, o resumo continua aguardando sua confirmação.'])
  expect(wait.tools.some(t=>t.name==='commit_confirmed_proposal')).toBe(false)
  await h.run('Pode fechar a compra do resumo para retirada.',[c('commit_confirmed_proposal',{proposal_id:'x',proposal_version:1})])
  expect((await h.saleRows()).results).toHaveLength(1)
 },30000)
 it('não executa quando o cliente pediu mudança antes de confirmar',async()=>{
  const h=await presented(903)
  await h.run('troca para duas',['Certo, já ajusto.'])
  const turn=await h.run('Confirmo o resumo.',['Vou preparar um novo resumo antes de concluir.'])
  expect(turn.tools.some(t=>t.name==='commit_confirmed_proposal')).toBe(false)
  expect((await h.saleRows()).results).toHaveLength(0)
 },30000)
 it('não aceita um "sim" isolado depois de outra troca de mensagens',async()=>{
  const h=await presented(904)
  await h.run('Tem sachê também?',['Tenho sachê. Quer incluir?'])
  const turn=await h.run('Sim',['Posso incluir o sachê. Quantos?'])
  expect(turn.tools.some(t=>t.name==='commit_confirmed_proposal')).toBe(false)
  expect((await h.saleRows()).results).toHaveLength(0)
 },30000)
})

describe('Think: confirmação de um resumo entre dois pendentes',()=>{
 for(const [n,phrase] of [[0,'Confirma só o banho; a compra ainda não.'],[1,'O pedido fica pra depois. Pode concluir apenas o agendamento da Mel.'],[2,'Fecha o horario da Mel, mas nao fecha a racao ainda.']] as const)it('conclui só o banho: '+phrase,async()=>{
  const h=await createThinkHarness(931+n,'-scoped-confirm')
  await h.run('Prepare 1 Ração A para retirada.',[c('open_tools',{capability:'cart'}),h.update([h.add('racao-a'),h.pickup])])
  const date=new Date();date.setUTCDate(date.getUTCDate()+3);while([0,6].includes(date.getUTCDay()))date.setUTCDate(date.getUTCDate()+1)
  const at=date.toISOString().slice(0,10)+'T09:00:00-03:00'
  await h.run('Prepare também só banho da Mel em '+at+'. Eu levo e busco.',[c('open_tools',{capability:'agenda'}),h.update([h.add('banho'),{action:'set_field',field:'pet_id',value:'mel'},{action:'set_field',field:'scheduled_at',value:at}],true,'banho-mel','booking')])
  const turn=await h.run(phrase,[c('commit_confirmed_proposal',{proposal_id:'x',proposal_version:1})])
  expect(turn.tools.find(t=>t.name==='commit_confirmed_proposal')?.result).toMatchObject({ok:true})
  expect((await h.db.prepare('SELECT id FROM appointments WHERE tenant_id=?').bind(h.tenant).all()).results).toHaveLength(1)
  expect((await h.saleRows()).results).toHaveLength(0)
 },30000)
})
