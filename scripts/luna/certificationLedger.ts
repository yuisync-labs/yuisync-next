// Certification-only durable accounting. Every SQL operation, including
// accounting itself, is charged. A failed/ambiguous operation retains its
// reservation: it cannot silently refund unknown work after a process crash.
export type ReadCategory='runtime'|'admin'|'setup'
export const CERTIFICATION_LEDGER_SCHEMA=`CREATE TABLE IF NOT EXISTS luna_cert_budget(
 round_id TEXT PRIMARY KEY,fingerprint TEXT NOT NULL,
 runtime_reads INTEGER NOT NULL DEFAULT 0,admin_reads INTEGER NOT NULL DEFAULT 0,setup_reads INTEGER NOT NULL DEFAULT 0,
 reserved_reads INTEGER NOT NULL DEFAULT 0,calls INTEGER NOT NULL DEFAULT 0,input_tokens INTEGER NOT NULL DEFAULT 0,output_tokens INTEGER NOT NULL DEFAULT 0,
 reserved_calls INTEGER NOT NULL DEFAULT 0,reserved_tokens INTEGER NOT NULL DEFAULT 0,uncertain INTEGER NOT NULL DEFAULT 0
) STRICT`
type BudgetRow={round_id:string;fingerprint:string;runtime_reads:number;admin_reads:number;setup_reads:number;reserved_reads:number;calls:number;input_tokens:number;output_tokens:number;reserved_calls:number;reserved_tokens:number;uncertain:number}
function reads(result:D1Result){const n=result.meta?.rows_read;if(!Number.isSafeInteger(n)||n<0)throw new Error('CERTIFICATION_READ_METRICS_UNAVAILABLE');return n}
export async function openCertificationLedger(raw:D1Database,roundId:string,fingerprint:string){
 // D1 reports two reads for an indexed UPDATE ... RETURNING (lookup + return),
 // asserted on every successful execution rather than assumed to be one.
 // execution. Bootstrap INSERT is zero reads on creation, one on conflict.
 const initial=await raw.prepare('INSERT INTO luna_cert_budget(round_id,fingerprint) VALUES(?1,?2) ON CONFLICT DO NOTHING').bind(roundId,fingerprint).run()
 const initialReads=reads(initial)
 if(initialReads>1)throw new Error('CERTIFICATION_LEDGER_QUERY_BOUND_EXCEEDED')
 const boot=await raw.prepare(`UPDATE luna_cert_budget SET admin_reads=admin_reads+?3 WHERE round_id=?1 AND fingerprint=?2
  AND runtime_reads+admin_reads+setup_reads+reserved_reads+?3<=99000 RETURNING *`).bind(roundId,fingerprint,initialReads+2).all<BudgetRow>()
 if(reads(boot)!==2||!boot.results[0])throw new Error('CERTIFICATION_LEDGER_IDENTITY_OR_BUDGET_INVALID')
 let latest=boot.results[0],category:ReadCategory='admin'
 const local={runtime:0,admin:initialReads+2,setup:0}
 async function execute(statements:D1PreparedStatement[],single:boolean,chargedCategory:ReadCategory){
  const ceiling=statements.length*512,reservation=ceiling+2
  const locked=await raw.prepare(`UPDATE luna_cert_budget SET reserved_reads=reserved_reads+?3,admin_reads=admin_reads+2
   WHERE round_id=?1 AND fingerprint=?2 AND uncertain=0
   AND runtime_reads+admin_reads+setup_reads+reserved_reads+?3+2<=99000 RETURNING *`).bind(roundId,fingerprint,reservation).all<BudgetRow>()
  if(!locked.results[0]){
   // Keep a safety margin for this terminal rejection/report. Failed budget
   // checks read the indexed row too; they are not silently counted as zero.
   const rejected=reads(locked)
   const charged=await raw.prepare('UPDATE luna_cert_budget SET admin_reads=admin_reads+?2 WHERE round_id=?1 RETURNING *').bind(roundId,rejected+2).all<BudgetRow>()
   if(reads(charged)!==2||!charged.results[0])throw new Error('CERTIFICATION_ACCOUNTING_UNCERTAIN')
   latest=charged.results[0];local.admin+=rejected+2
   throw new Error('CERTIFICATION_TOTAL_READ_BUDGET_EXHAUSTED')
  }
  if(reads(locked)!==2)throw new Error('CERTIFICATION_ACCOUNTING_UNCERTAIN')
  local.admin+=2;latest=locked.results[0]
  // Unknown SQL response keeps the ceiling reserved. No blind SQL replay here.
  const results=single?[await statements[0].all()]:await raw.batch(statements)
  const actual=results.reduce((sum,result)=>sum+reads(result),0)
  const column={runtime:'runtime_reads',admin:'admin_reads',setup:'setup_reads'}[chargedCategory]
  const done=await raw.prepare(`UPDATE luna_cert_budget SET reserved_reads=reserved_reads-?3,${column}=${column}+?4,admin_reads=admin_reads+2,
   uncertain=CASE WHEN ?4>?5 THEN 1 ELSE uncertain END WHERE round_id=?1 AND fingerprint=?2 AND reserved_reads>=?3 RETURNING *`)
   .bind(roundId,fingerprint,reservation,actual,ceiling).all<BudgetRow>()
  if(reads(done)!==2||!done.results[0])throw new Error('CERTIFICATION_LEDGER_SETTLEMENT_UNCERTAIN')
  latest=done.results[0];local.admin+=2;local[chargedCategory]+=actual
  if(actual>ceiling)throw new Error('CERTIFICATION_QUERY_READ_BOUND_EXCEEDED')
  return results
 }
 function statement(prepared:D1PreparedStatement,chargedCategory:ReadCategory):D1PreparedStatement{
  return {bind:(...values:unknown[])=>statement(prepared.bind(...values),chargedCategory),__raw:prepared,
   async all(){return(await execute([prepared],true,chargedCategory))[0]},
   async run(){return(await execute([prepared],true,chargedCategory))[0]},
   async first(column?:string){const row=(await execute([prepared],true,chargedCategory))[0].results[0] as Record<string,unknown>|undefined;return column?row?.[column]??null:row??null},
   async raw(){throw new Error('CERTIFICATION_RAW_FORBIDDEN')},
  } as unknown as D1PreparedStatement
 }
 const db={prepare:(sql:string)=>statement(raw.prepare(sql),category),batch:(statements:D1PreparedStatement[])=>execute(statements.map(s=>(s as unknown as {__raw:D1PreparedStatement}).__raw),false,category),async exec(){throw new Error('CERTIFICATION_EXEC_FORBIDDEN')},async dump(){throw new Error('CERTIFICATION_DUMP_FORBIDDEN')}} as unknown as D1Database
 const admin=(sql:string)=>statement(raw.prepare(sql),'admin')
 return{db,category:(next:ReadCategory)=>{category=next},local,usage:()=>({...latest,totalReads:latest.runtime_reads+latest.admin_reads+latest.setup_reads}),
  async reserveModel(upper:number){
   if(!Number.isSafeInteger(upper)||upper<=0)throw new Error('CERTIFICATION_MODEL_RESERVATION_INVALID')
   const result=await admin(`UPDATE luna_cert_budget SET reserved_calls=reserved_calls+1,reserved_tokens=reserved_tokens+?3
    WHERE round_id=?1 AND fingerprint=?2 AND uncertain=0 AND calls+reserved_calls+1<=120
    AND input_tokens+output_tokens+reserved_tokens+?3<=250000 RETURNING round_id`).bind(roundId,fingerprint,upper).all()
   if(!result.results.length)throw new Error('CERTIFICATION_TOTAL_MODEL_BUDGET_EXHAUSTED')
  },
  async settleModel(upper:number,usage:{promptTokens:number;completionTokens:number}){
   if(![usage.promptTokens,usage.completionTokens].every(n=>Number.isSafeInteger(n)&&n>=0))throw new Error('CERTIFICATION_MODEL_METRICS_UNAVAILABLE')
   await admin(`UPDATE luna_cert_budget SET reserved_calls=reserved_calls-1,reserved_tokens=reserved_tokens-?3,calls=calls+1,
    input_tokens=input_tokens+?4,output_tokens=output_tokens+?5,uncertain=CASE WHEN ?4+?5>?3 THEN 1 ELSE uncertain END
    WHERE round_id=?1 AND fingerprint=?2 AND reserved_calls>=1 AND reserved_tokens>=?3`)
    .bind(roundId,fingerprint,upper,usage.promptTokens,usage.completionTokens).run()
   if(usage.promptTokens+usage.completionTokens>upper)throw new Error('CERTIFICATION_MODEL_RESERVATION_EXCEEDED')
  },
 }
}
