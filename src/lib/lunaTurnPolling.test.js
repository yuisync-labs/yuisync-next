import { describe,expect,it,vi } from 'vitest'
import { waitForLunaTurn } from './lunaTurnPolling'

describe('Luna status polling, never submitting an operation',()=>{
 it('backs off from 2 to 10 seconds and stops at a terminal result',async()=>{
  const statuses=['running','running','running','running','running','waiting_quota','complete']
  const fetchStatus=vi.fn(async()=>({status:statuses.shift(),result:{data:{reply:'fixture'}}})),sleep=vi.fn(async()=>{})
  expect(await waitForLunaTurn({fetchStatus,sleep,visible:()=>true})).toEqual({reply:'fixture'})
  expect(sleep.mock.calls.map(call=>call[0])).toEqual([2000,4000,6000,8000,10000,2000])
  expect(fetchStatus).toHaveBeenCalledTimes(7)
 })
 it('makes no request while hidden and resumes with a status read, not a submit',async()=>{
  let visible=false;const fetchStatus=vi.fn(async()=>({status:'complete',result:{reply:'safe'}}))
  const waitVisible=vi.fn(async()=>{expect(fetchStatus).not.toHaveBeenCalled();visible=true})
  expect(await waitForLunaTurn({fetchStatus,visible:()=>visible,waitVisible})).toEqual({reply:'safe'})
  expect(waitVisible).toHaveBeenCalledOnce();expect(fetchStatus).toHaveBeenCalledOnce()
 })
 it('stops without retrying an ambiguous or failed operation',async()=>{
  for(const status of ['failed','requires_reconciliation']){
   const fetchStatus=vi.fn(async()=>({status,errorCode:'UNCERTAIN'}))
   await expect(waitForLunaTurn({fetchStatus,visible:()=>true})).rejects.toThrow('não reenvie')
   expect(fetchStatus).toHaveBeenCalledOnce()
  }
 })
})
