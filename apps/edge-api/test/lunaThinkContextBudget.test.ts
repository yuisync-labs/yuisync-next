import {it,expect} from 'vitest'
import {createThinkHarness,command} from './fixtures/luna/thinkHarness'

it('measures the actual model prompt and keeps the draft menu outside the initial catalog capabilities',async()=>{
 const h=await createThinkHarness(197,'-context',undefined,{profileModel:true})
 try{
  const result=await h.run('Tem ração Quatree adulto 15 kg para cachorro?',[
   command('search_products',{filters:{brand:'Quatree',species:'dog',lifeStage:'adult',packageWeightGrams:15000}}),
   'Encontrei opções. Você prefere a Ração A ou B?',
  ])
  expect(result.result.usage.modelCalls).toBe(2)
  const first=h.modelFootprint[0]
  const chars=first.messages.reduce((n,message)=>n+message.chars,0)+(first.tools??[]).reduce((n,tool)=>n+tool.chars,0)
  // Character regression bound, not a tokenizer or the 12k per-turn token limit.
  expect(chars).toBeLessThan(13000)
  expect(h.modelFootprint[0].tools?.some(tool=>tool.name==='update_draft')).toBe(false)
 }finally{h.close()}
})
