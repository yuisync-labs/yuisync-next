import {hashCanonicalJson} from './canonicalJson'
import type {LunaExecutionContext} from './contracts'
import {LunaCheckpointError,LunaTurnSuspended,type LunaTurnJournal} from './turnJournal'

type Receipt={step_key:string;fingerprint:string;input_json:string;status:'running'|'failed'|'complete';result_json:string|null;error_code:string|null;created_at_ms:number;updated_at_ms:number}
type Header={configuration:string;keys:string[]}
type Storage=Pick<DurableObjectStorage,'get'|'put'>
export type DurableLunaTurnJournal=LunaTurnJournal & {flush():Promise<void>}

// Execution checkpoints live in the SAME conversation DO as the serialized
// queue. Storage is written before effects and after results. D1 is a batched
// audit mirror, plus the fail-closed source for pre-upgrade checkpoints.
// No effect, model call or ambiguous commit is retried by this journal.
export function createDurableTurnJournal(storage:Storage,db:D1Database,context:LunaExecutionContext,configuration:string,now=Date.now):DurableLunaTurnJournal {
 if(!context.sourceMessageId||!configuration)throw new LunaCheckpointError('LUNA_JOURNAL_IDENTITY_REQUIRED')
 const scope=[context.tenantId,context.moduleId,context.conversationId,context.sourceMessageId]
 const prefix=hashCanonicalJson(scope).then(hash=>`luna-journal:${hash}:`)
 let header:Header|undefined
 const size=(value:unknown)=>{const json=JSON.stringify(value);if(!json||new TextEncoder().encode(json).length>128000)throw new LunaCheckpointError('LUNA_CHECKPOINT_SIZE_EXCEEDED');return json}
 const initialize=async()=>{
  const p=await prefix
  if(header)return p
  const saved=await storage.get<Header>(p+'header')
  if(saved){if(saved.configuration!==configuration)throw new LunaCheckpointError('LUNA_CHECKPOINT_FINGERPRINT_MISMATCH');if(!Array.isArray(saved.keys)||saved.keys.length>200||saved.keys.some(key=>!/^[a-z0-9:_-]{1,160}$/i.test(key)))throw new LunaCheckpointError('LUNA_CHECKPOINT_LIMIT');header=saved;return p}
  const legacy=await db.prepare(`SELECT step_key,fingerprint,input_json,status,result_json,error_code,created_at_ms,updated_at_ms FROM luna_turn_steps WHERE tenant_id=?1 AND module_id=?2 AND conversation_id=?3 AND source_message_id=?4 LIMIT 201`).bind(...scope).all<Receipt>()
  if(legacy.results.length>200)throw new LunaCheckpointError('LUNA_CHECKPOINT_LIMIT')
  const loaded:Header={configuration,keys:legacy.results.map(row=>row.step_key)}
  // One atomic local write: an interrupted hydration never loses a legacy lock.
  await storage.put({[p+'header']:loaded,...Object.fromEntries(legacy.results.map(row=>[p+row.step_key,row]))})
  header=loaded
  return p
 }
 const save=async(p:string,row:Receipt)=>{
  size(row)
  const next={configuration,keys:header!.keys.includes(row.step_key)?header!.keys:[...header!.keys,row.step_key]}
  if(next.keys.length>200)throw new LunaCheckpointError('LUNA_CHECKPOINT_LIMIT')
  await storage.put({[p+row.step_key]:row,[p+'header']:next})
  header=next
 }
 return {
  async waitUntil(at){if(!Number.isSafeInteger(at))throw new LunaCheckpointError('LUNA_RESUME_TIME_INVALID');if(at>now())throw new LunaTurnSuspended(at)},
  async run<T>(key:string,input:unknown,operation:()=>Promise<T>,reconcile?:()=>Promise<T|undefined>):Promise<T>{
   if(!/^[a-z0-9:_-]{1,160}$/i.test(key))throw new LunaCheckpointError('LUNA_STEP_KEY_INVALID')
   const p=await initialize(),fingerprint=await hashCanonicalJson({configuration,input})
   let row=await storage.get<Receipt>(p+key)
   const complete=async(value:T)=>{await save(p,{...row!,status:'complete',result_json:size(value),error_code:null,updated_at_ms:now()});return value}
   if(row){
    if(row.fingerprint!==fingerprint)throw new LunaCheckpointError('LUNA_CHECKPOINT_FINGERPRINT_MISMATCH')
    if(row.status==='complete'&&row.result_json!==null)return JSON.parse(row.result_json) as T
    if((row.status==='running'||row.status==='failed')&&reconcile){const known=await reconcile();if(known!==undefined)return complete(known)}
    throw new LunaCheckpointError(row.status==='failed'?row.error_code??'LUNA_CHECKPOINT_FAILED':'LUNA_EXECUTION_RECONCILIATION_REQUIRED')
   }
   row={step_key:key,fingerprint,input_json:size(input),status:'running',result_json:null,error_code:null,created_at_ms:now(),updated_at_ms:now()}
   await save(p,row)
   let result:T
   try{result=await operation()}
   catch(error){
    if(reconcile){const known=await reconcile();if(known!==undefined)return complete(known)}
    const code=(error as {code?:unknown})?.code
    const safeCode=typeof code==='string'&&/^[A-Z_]{1,80}$/.test(code)?code:'LUNA_CHECKPOINT_FAILED'
    await save(p,{...row,status:'failed',error_code:safeCode,updated_at_ms:now()})
    throw new LunaCheckpointError(safeCode)
   }
   return complete(result)
  },
  async flush(){
   const p=await initialize()
   const rows=await storage.get<Receipt>(header!.keys.map(key=>p+key))
   const receipts=header!.keys.map(key=>rows.get(p+key))
   if(receipts.some(row=>!row))throw new LunaCheckpointError('LUNA_CHECKPOINT_MISSING')
   for(let offset=0;offset<receipts.length;offset+=16){
    const results=await db.batch(receipts.slice(offset,offset+16).map(row=>db.prepare(`INSERT INTO luna_turn_steps(tenant_id,module_id,conversation_id,source_message_id,step_key,fingerprint,input_json,status,result_json,error_code,created_at_ms,updated_at_ms)
     VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12) ON CONFLICT(tenant_id,module_id,conversation_id,source_message_id,step_key) DO UPDATE SET status=excluded.status,result_json=excluded.result_json,error_code=excluded.error_code,updated_at_ms=excluded.updated_at_ms WHERE fingerprint=excluded.fingerprint AND (luna_turn_steps.status!='complete' OR (excluded.status='complete' AND luna_turn_steps.result_json=excluded.result_json))`)
      .bind(...scope,row!.step_key,row!.fingerprint,row!.input_json,row!.status,row!.result_json,row!.error_code,row!.created_at_ms,row!.updated_at_ms)))
    if(results.some(result=>result.meta.changes!==1))throw new LunaCheckpointError('LUNA_CHECKPOINT_WRITE_CONFLICT')
   }
  },
 }
}
