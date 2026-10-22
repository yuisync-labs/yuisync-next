import { describe,expect,it,vi } from 'vitest'
import { durableTurnQueue } from '../src/luna/durableTurnQueue'
import { LunaCheckpointError,LunaTurnSuspended } from '../src/luna/turnJournal'

function store(){
 const values=new Map<string,unknown>(),alarms:number[]=[]
 const storage={async get(key:string){return structuredClone(values.get(key))},async put(key:string|Record<string,unknown>,value?:unknown){for(const [k,v] of typeof key==='string'?[[key,value]]:Object.entries(key))values.set(k as string,structuredClone(v))},async setAlarm(at:number){alarms.push(at)}} as unknown as Pick<DurableObjectStorage,'get'|'put'|'setAlarm'>
 return {storage,values,alarms}
}
const id='a'.repeat(64),second='b'.repeat(64)
describe('Durable turn lifecycle independent of browser',()=>{
 it('preserves a turn appended while the previous external inference is running',async()=>{
  const s=store();let release!:()=>void
  const gate=new Promise<void>(resolve=>{release=resolve})
  const q=durableTurnQueue(s.storage,async()=>{await gate;return{status:'replied'}})
  await q.submit(id,{first:true})
  const running=q.process()
  while((await q.load(id))?.status!=='running')await Promise.resolve()
  await q.submit(second,{second:true});release();await running
  expect(s.values.get('luna-job-queue')).toEqual([second])
  await q.process();expect((await q.load(second))?.status).toBe('complete')
 })
 it('accepts once, survives reconstruction and processes independently of the submitting connection',async()=>{
  const s=store(),execute=vi.fn(async()=>({status:'replied',reply:'fixture'}))
  const q=durableTurnQueue(s.storage,execute,()=>1000)
  expect((await q.submit(id,{message:'fixture'})).status).toBe('queued')
  await q.submit(id,{message:'fixture'});expect(execute).not.toHaveBeenCalled()
  await durableTurnQueue(s.storage,execute,()=>1001).process()
  expect((await q.load(id))?.status).toBe('complete')
  await q.process();expect(execute).toHaveBeenCalledOnce()
 })
 it('persists a quota wait, resumes at its alarm and serializes subsequent messages',async()=>{
  let now=1000,calls=0;const s=store(),execute=vi.fn(async()=>{if(++calls===1)throw new LunaTurnSuspended(6000);return{status:'replied'}})
  const q=durableTurnQueue(s.storage,execute,()=>now)
  await q.submit(id,{});await q.submit(second,{later:true});await q.process()
  expect((await q.load(id))?.status).toBe('waiting_quota');expect((await q.load(second))?.status).toBe('queued')
  await q.process();expect(execute).toHaveBeenCalledOnce()
  now=6000;await durableTurnQueue(s.storage,execute,()=>now).process()
  expect((await q.load(id))?.status).toBe('complete')
  await q.process();expect((await q.load(second))?.status).toBe('complete')
 })
 it('blocks ambiguous effects and does not skip the affected turn or retry forever',async()=>{
  const s=store(),execute=vi.fn(async()=>{throw new LunaCheckpointError('LUNA_EXECUTION_RECONCILIATION_REQUIRED')}),q=durableTurnQueue(s.storage,execute)
  await q.submit(id,{});await q.submit(second,{});await q.process();await q.process()
  expect((await q.load(id))?.status).toBe('requires_reconciliation');expect((await q.load(second))?.status).toBe('queued')
  expect(execute).toHaveBeenCalledOnce()
 })
 it('does not label failed conversational or transactional validation complete',async()=>{
  for(const result of [{status:'failed'},{validation:{passed:false}}]){
   const s=store(),q=durableTurnQueue(s.storage,async()=>result)
   await q.submit(id,{});await q.process();expect((await q.load(id))?.status).toBe('failed')
  }
 })
 it('rejects different input using the same idempotency identity',async()=>{
  const s=store(),execute=vi.fn(async()=>true),q=durableTurnQueue(s.storage,execute)
  await q.submit(id,{message:'first'})
  await expect(q.submit(id,{message:'changed'})).rejects.toMatchObject({code:'LUNA_JOB_PAYLOAD_CONFLICT'})
  expect(execute).not.toHaveBeenCalled()
 })
})
