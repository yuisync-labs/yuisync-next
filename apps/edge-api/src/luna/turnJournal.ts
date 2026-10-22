import { hashCanonicalJson } from './canonicalJson'
import type { LunaExecutionContext } from './contracts'

export class LunaCheckpointError extends Error {
 constructor(readonly code: string) { super(code) }
}
export class LunaTurnSuspended extends Error {
 constructor(readonly resumeAtMs: number) { super('LUNA_WAITING_QUOTA') }
}
export interface LunaTurnJournal {
 run<T>(key: string, input: unknown, operation: () => Promise<T>, reconcile?: () => Promise<T | undefined>): Promise<T>
 waitUntil(atMs: number): Promise<void>
}
type Row = { fingerprint: string; status: string; result_json: string | null; error_code: string | null }

// Results are private execution state, not telemetry. No credentials or private
// reasoning belong here. Access is always bound to server-owned conversation.
export function createD1TurnJournal(db: D1Database, context: LunaExecutionContext, configuration: string, now = Date.now): LunaTurnJournal {
 if (!context.sourceMessageId || !configuration) throw new LunaCheckpointError('LUNA_JOURNAL_IDENTITY_REQUIRED')
 const scope = [context.tenantId,context.moduleId,context.conversationId,context.sourceMessageId]
 const persist = async (key: string, fingerprint: string, value: unknown) => {
  const encoded = JSON.stringify(value)
  if (!encoded || new TextEncoder().encode(encoded).length > 262144) throw new LunaCheckpointError('LUNA_CHECKPOINT_SIZE_EXCEEDED')
  const result = await db.prepare(`UPDATE luna_turn_steps SET status='complete',result_json=?7,error_code=NULL,updated_at_ms=?8
   WHERE tenant_id=?1 AND module_id=?2 AND conversation_id=?3 AND source_message_id=?4 AND step_key=?5 AND fingerprint=?6 AND status IN ('running','failed')`)
   .bind(...scope,key,fingerprint,encoded,now()).run()
  if (result.meta.changes !== 1) throw new LunaCheckpointError('LUNA_CHECKPOINT_WRITE_CONFLICT')
  return value
 }
 return {
  async waitUntil(atMs) {
   if (!Number.isSafeInteger(atMs)) throw new LunaCheckpointError('LUNA_RESUME_TIME_INVALID')
   if (atMs > now()) throw new LunaTurnSuspended(atMs)
  },
  async run<T>(key: string, input: unknown, operation: () => Promise<T>, reconcile?: () => Promise<T | undefined>): Promise<T> {
   if (!/^[a-z0-9:_-]{1,160}$/i.test(key)) throw new LunaCheckpointError('LUNA_STEP_KEY_INVALID')
   const fingerprint = await hashCanonicalJson({ configuration,input })
   const row = await db.prepare(`SELECT fingerprint,status,result_json,error_code FROM luna_turn_steps
    WHERE tenant_id=?1 AND module_id=?2 AND conversation_id=?3 AND source_message_id=?4 AND step_key=?5`)
    .bind(...scope,key).first<Row>()
   if (row) {
    if (row.fingerprint !== fingerprint) throw new LunaCheckpointError('LUNA_CHECKPOINT_FINGERPRINT_MISMATCH')
    if (row.status === 'complete' && row.result_json !== null) return JSON.parse(row.result_json) as T
    if ((row.status === 'running'||row.status==='failed') && reconcile) {
     const result = await reconcile()
     if (result !== undefined) return await persist(key,fingerprint,result) as T
    }
    throw new LunaCheckpointError(row.status === 'failed' ? row.error_code ?? 'LUNA_CHECKPOINT_FAILED' : 'LUNA_EXECUTION_RECONCILIATION_REQUIRED')
   }
   const encodedInput=JSON.stringify(input)
   if(!encodedInput||new TextEncoder().encode(encodedInput).length>262144)throw new LunaCheckpointError('LUNA_CHECKPOINT_SIZE_EXCEEDED')
   const lock = await db.prepare(`INSERT INTO luna_turn_steps(tenant_id,module_id,conversation_id,source_message_id,step_key,fingerprint,input_json,status,created_at_ms,updated_at_ms)
    VALUES(?1,?2,?3,?4,?5,?6,?7,'running',?8,?8) ON CONFLICT DO NOTHING`).bind(...scope,key,fingerprint,encodedInput,now()).run()
   if (lock.meta.changes !== 1) throw new LunaCheckpointError('LUNA_EXECUTION_RECONCILIATION_REQUIRED')
   let value: T
   try { value = await operation() }
   catch (error) {
    if(reconcile){const completed=await reconcile();if(completed!==undefined)return await persist(key,fingerprint,completed) as T}
    // A failed external call can have unknown effects/usage. Persist failure;
    // never refund its reservation or retry it just because an alarm repeats.
    const candidate = (error as {code?:unknown})?.code
    const code = typeof candidate === 'string' && /^[A-Z_]{1,80}$/.test(candidate) ? candidate : 'LUNA_CHECKPOINT_FAILED'
    await db.prepare(`UPDATE luna_turn_steps SET status='failed',error_code=?6,updated_at_ms=?7
     WHERE tenant_id=?1 AND module_id=?2 AND conversation_id=?3 AND source_message_id=?4 AND step_key=?5 AND status='running'`)
     .bind(...scope,key,code,now()).run()
    throw new LunaCheckpointError(code)
   }
   // A crash between effect and receipt leaves running, requiring explicit
   // reconciliation. In particular, it must never replay the model request.
   return await persist(key,fingerprint,value) as T
  },
 }
}
