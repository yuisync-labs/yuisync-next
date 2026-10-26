import {describe,expect,it} from 'vitest'
import {namedPet,serviceQuery,thinkTopics} from '../src/luna/thinkPolicy'
import {createThinkHarness} from './fixtures/luna/thinkHarness'

describe('escopo do prompt por assunto',()=>{
 it('separa agenda, compra e alteração de agendamento',()=>{
  expect(thinkTopics('quero agendar um banho pra nina')).toEqual({agenda:true,commerce:false,appointmentChange:false})
  expect(thinkTopics('tem ração de 15 kg?')).toMatchObject({agenda:false,commerce:true})
  expect(thinkTopics('oi')).toMatchObject({agenda:false,commerce:true})
  expect(thinkTopics('amanhã às 14h',"agenda")).toMatchObject({agenda:true,commerce:false})
  expect(thinkTopics('banho da Mel e uma ração para retirar')).toMatchObject({agenda:true,commerce:true})
  expect(thinkTopics('preciso remarcar o banho')).toMatchObject({agenda:true,appointmentChange:true})
 })
 it('extrai a busca de serviço e o pet citado só quando não há dúvida',()=>{
  expect(serviceQuery('Quero um BANHO e tosa')).toBe('banho e tosa')
  expect(serviceQuery('hidratação para o Thor')).toBe('hidrata')
  expect(serviceQuery('quero agendar')).toBeNull()
  const pets=[{id:'1',name:'Nina'},{id:'2',name:'Thor'},{id:'3',name:'Nina'}]
  expect(namedPet('banho pra nina',pets)).toBeNull()
  expect(namedPet('banho pro thor',pets)?.id).toBe('2')
  expect(namedPet('banho',pets)).toBeNull()
 })
})

describe('Think: agendamento guiado pelo servidor',()=>{
 it('abre a agenda e já traz os serviços do pet na primeira chamada',async()=>{
  const h=await createThinkHarness(921,'-scope',undefined,{profileModel:true})
  try{
   const turn=await h.run('Quero agendar um banho pra Mel',['O banho da Mel custa R$ 55. Qual dia você prefere?'])
   expect(turn.result.usage.modelCalls).toBe(1)
   const first=h.modelFootprint[0],tools=(first.tools??[]).map(t=>t.name)
   expect(tools).toContain('get_available_slots')
   expect(tools).not.toContain('search_products')
   expect(tools).not.toContain('prepare_appointment_reschedule')
   const chars=first.messages.reduce((n,m)=>n+m.chars,0)+(first.tools??[]).reduce((n,t)=>n+t.chars,0)
   // Before: open_tools + search_services + reply, about 45k chars over three calls.
   expect(chars).toBeLessThan(14000)
  }finally{h.close()}
 },30000)
 it('mostra remarcar e cancelar quando o cliente fala de um agendamento existente',async()=>{
  const h=await createThinkHarness(922,'-scope-change',undefined,{profileModel:true})
  try{
   await h.run('Preciso remarcar o banho da Mel',['Qual novo dia?'])
   expect((h.modelFootprint[0].tools??[]).map(t=>t.name)).toContain('prepare_appointment_reschedule')
  }finally{h.close()}
 },30000)
})
