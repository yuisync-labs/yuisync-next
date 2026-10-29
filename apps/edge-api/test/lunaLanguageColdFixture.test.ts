import {it,expect} from 'vitest'
import {runInDurableObject} from 'cloudflare:test'
import {createLiveHarness,liveService} from './fixtures/luna/liveHarness'
import {prepareLanguageCase} from './fixtures/luna/languageSetup'
it.skipIf(!liveService)('uses the persistent local model bridge on a cold first submission',async()=>{
 const h=await createLiveHarness(8910)
 try{
  // Do not rely on an instance monkeypatch surviving a native queue wake.
  await runInDurableObject(h.stub,async a=>{delete (a as unknown as {getModel?:unknown}).getModel})
  const result=await h.turn('Oi')
  expect(result.status).toBe('replied');expect(result.usage.modelCalls).toBe(1)
  expect((await h.saleRows()).results).toHaveLength(0)
 }finally{h.close()}
})
it.skipIf(!liveService)('keeps a cold submission running with the controlled store date',async()=>{
 const h=await createLiveHarness(8911);let restore=()=>{}
 try{
  restore=(await prepareLanguageCase(h,'date_boundary')).restore
  await runInDurableObject(h.stub,async a=>{delete (a as unknown as {getModel?:unknown}).getModel})
  const result=await h.turn('Oi')
  expect(result.status).toBe('replied');expect(result.usage.modelCalls).toBe(1)
  expect(new Date().toISOString().slice(0,16)).toBe('2026-11-02T02:55')
 }finally{restore();h.close()}
})
