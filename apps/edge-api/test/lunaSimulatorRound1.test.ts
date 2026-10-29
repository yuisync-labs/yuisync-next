import {describe,expect,it} from 'vitest'
import {command as c,createThinkHarness} from './fixtures/luna/thinkHarness'
import {applyQuatroPatasStore} from './fixtures/luna/simulatorStore'
import {simulatorScenarios} from './fixtures/luna/simulatorScenarios'
import {claimsDone} from '../src/luna/thinkPresentation'
// Failures of the first simulator round (29/10/2026), on the QuatroPatas catalogue
// with a scripted model: what the server must do whatever the model says.
describe('rodada 1 do simulador',()=>{
 const f=(field:string,value:string)=>({action:'set_field',field,value})
 async function booked(id:number){
  const h=await createThinkHarness(id,'-sim1')
  await applyQuatroPatasStore(h as never,simulatorScenarios(1,1)[0])
  await h.run('banho da Mel amanhã às 9, eu levo',[c('open_tools',{capability:'agenda'}),c('search_services',{query:'banho',pet_id:'mel'}),h.update([h.add('banho-p'),f('pet_id','mel'),f('scheduled_at','2026-10-07T09:00:00-03:00'),f('transport_mode','self')],true,'banho-mel','booking'),'ok'])
  return h
 }
 const appointments=async(h:Awaited<ReturnType<typeof booked>>)=>(await h.db.prepare("SELECT COUNT(*) n FROM appointments WHERE tenant_id=? AND status<>'cancelled'").bind(h.tenant).first<{n:number}>())!.n
 it('um sim nas palavras do cliente grava o agendamento',async()=>{
  const h=await booked(7801),p=await h.proposal('appointment_create')
  await h.run('confirmo sim, pode deixar marcado entao',[c('commit_confirmed_proposal',p),'feito'])
  expect(await appointments(h)).toBe(1)
 },60000)
 it('um sim com outro horário não grava',async()=>{
  const h=await booked(7802),p=await h.proposal('appointment_create')
  await h.run('confirmo, mas às 10h',[c('commit_confirmed_proposal',p),'certo'],['CONFIRMATION_REQUIRED'])
  expect(await appointments(h)).toBe(0)
 },60000)
 it('"agendado" sem gravação volta ao resumo',async()=>{
  const h=await booked(7803)
  const r=await h.run('hmm deixa eu ver',['Pronto, seu banho está confirmado para amanhã às 9h!'])
  expect(r.result.status).toBe('awaiting_confirmation')
  expect(r.result.reply).toContain('Você confirma')
  expect(await appointments(h)).toBe(0)
 },60000)
 it('"banho e tosa total" acha a tosa total',async()=>{
  const h=await createThinkHarness(7804,'-sim1')
  await applyQuatroPatasStore(h as never,simulatorScenarios(1,1)[0])
  const r=await h.run('quanto custa banho e tosa total pra Mel?',[c('search_services',{query:'banho e tosa total',pet_id:'mel'}),'R$ 85,00'])
  const found=r.tools.find(t=>t.name==='search_services'&&JSON.stringify(t.result).includes('tosa-total-p'))
  expect(found).toBeTruthy()
 },60000)
 it('preço do cadastro dito de novo não passa para a loja',async()=>{
  const h=await createThinkHarness(7805,'-sim1')
  await applyQuatroPatasStore(h as never,simulatorScenarios(1,1)[0])
  const r=await h.run('é R$ 85 mesmo a tosa total?',['Sim, a tosa total da Mel é R$ 85,00.'])
  expect(r.result.status).toBe('replied')
 },60000)
 it('"tem vaga" sem consultar a agenda vira pergunta',async()=>{
  const h=await createThinkHarness(7806,'-sim1')
  await applyQuatroPatasStore(h as never,simulatorScenarios(1,1)[0])
  const r=await h.run('oi, tem horário amanhã?',['Temos vaga amanhã às 9h!'])
  expect(r.result.status).toBe('replied')
  expect(r.result.reply).toContain('confiro a vaga')
 },60000)
 it('reconhece promessa de feito',()=>{
  for(const yes of ['Seu pedido está confirmado para retirada na loja.','Sim, o MotoDog vai buscar a Mel na sexta-feira às 9h certinho.','Prontinho, ficou marcado!'])expect(claimsDone(yes),yes).toBe(true)
  for(const no of ['O MotoDog vai buscar a Mel na sexta às 9h e trazer de volta. Confirma?','Tem vaga sexta às 9h. Você vai levar a Mel?','O banho custa R$ 55,00.'])expect(claimsDone(no),no).toBe(false)
 })
})
