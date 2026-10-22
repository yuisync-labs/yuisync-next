import {it,expect} from 'vitest'
import {runInDurableObject} from 'cloudflare:test'
import {createLiveHarness,liveService} from './fixtures/luna/liveHarness'
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
