import { LunaCheckpointError,LunaTurnSuspended } from './turnJournal'
import { canonicalJson } from './canonicalJson'

export type DurableTurnStatus = 'queued'|'running'|'waiting_quota'|'complete'|'failed'|'requires_reconciliation'
export type DurableTurnJob = {
 id: string; payload: unknown; status: DurableTurnStatus; createdAtMs: number; updatedAtMs: number;
 resumeAtMs?: number; result?: unknown; errorCode?: string
 attempts?:number; activeDurationMs?:number; quotaWaitMs?:number; waitingSinceMs?:number
}
type Storage = Pick<DurableObjectStorage,'get'|'put'|'setAlarm'>

// Called under the existing DO serial executor. Only one conversation turn is
// active; later inbound messages cannot rewrite drafts while an earlier turn
// is awaiting quota. Alarms are at-least-once, so every step still needs a journal.
export function durableTurnQueue(storage: Storage, execute: (job: DurableTurnJob) => Promise<unknown>, now=Date.now,observe?:(job:DurableTurnJob)=>void) {
 const jobKey=(id:string)=>`luna-job:${id}`
 const load=(id:string)=>storage.get<DurableTurnJob>(jobKey(id))
 return {
  load,
  async submit(id:string,payload:unknown) {
   if(!/^[a-f0-9]{64}$/.test(id))throw new LunaCheckpointError('LUNA_JOB_ID_INVALID')
   const previous=await load(id)
   if(previous){if(canonicalJson(previous.payload)!==canonicalJson(payload))throw new LunaCheckpointError('LUNA_JOB_PAYLOAD_CONFLICT');return previous}
   const queued=await storage.get<string[]>('luna-job-queue')??[]
   if(queued.length>=50)throw new LunaCheckpointError('LUNA_CONVERSATION_QUEUE_FULL')
   const job:DurableTurnJob={id,payload,status:'queued',createdAtMs:now(),updatedAtMs:now()}
   // The queue and job are committed together. Register wakeup first: if the
   // process stops before the write, an empty alarm is safe; after it, work resumes.
   await storage.setAlarm(now()+1)
   await storage.put({[jobKey(id)]:job,'luna-job-queue':[...queued,id],'luna-job-latest':id})
   return job
  },
  async process() {
   const queued=await storage.get<string[]>('luna-job-queue')??[]
   if(!queued.length)return
   const job=await load(queued[0])
   if(!job)throw new LunaCheckpointError('LUNA_QUEUED_JOB_MISSING')
   if(job.status==='requires_reconciliation'||job.status==='failed')return // Never silently skip an ambiguous predecessor.
   if(job.resumeAtMs&&job.resumeAtMs>now()){await storage.setAlarm(job.resumeAtMs);return}
   if(job.status!=='complete') {
    if(job.waitingSinceMs){job.quotaWaitMs=(job.quotaWaitMs??0)+Math.max(0,now()-job.waitingSinceMs);delete job.waitingSinceMs}
    const attemptStarted=now();job.attempts=(job.attempts??0)+1
    job.status='running';job.updatedAtMs=now();await storage.put(jobKey(job.id),job)
    try {
     job.result=await execute(job)
     const outcome=job.result as {status?:string;validation?:{passed?:boolean};errorCode?:string}
     job.status=outcome?.status==='quota_paused'?'requires_reconciliation':outcome?.status==='failed'||outcome?.validation?.passed===false?'failed':'complete'
     if(job.status!=='complete')job.errorCode=outcome?.errorCode??'LUNA_TURN_NOT_APPROVED'
     delete job.resumeAtMs
    } catch(error) {
     if(error instanceof LunaTurnSuspended){job.status='waiting_quota';job.resumeAtMs=error.resumeAtMs;job.waitingSinceMs=now();await storage.setAlarm(error.resumeAtMs)}
     else {job.status=error instanceof LunaCheckpointError?'requires_reconciliation':'failed';job.errorCode=error instanceof LunaCheckpointError?error.code:'LUNA_EXECUTION_FAILED'}
    }
    job.activeDurationMs=(job.activeDurationMs??0)+Math.max(0,now()-attemptStarted)
    job.updatedAtMs=now();await storage.put(jobKey(job.id),job)
    observe?.(job)
   }
   if(job.status==='complete') {
    if(queued.length>1)await storage.setAlarm(now()+1)
    await storage.put('luna-job-queue',queued.slice(1))
   }
  },
 }
}
