// Used exclusively by the isolated staging adapter, not by production.
export type Metrics={calls:number;tokens:number;rowsRead:number;promptTokens:number;completionTokens:number}
export function certificationMeter(database:D1Database,limits:{calls:number;tokens:number;rowsRead:number}){
 const metrics:Metrics={calls:0,tokens:0,rowsRead:0,promptTokens:0,completionTokens:0}
 let unknown=false
 const reserveRows=(count=1)=>{if(metrics.rowsRead+count*512>limits.rowsRead)throw new Error('CERTIFICATION_READ_RESERVATION_EXHAUSTED')}
 const account=(result:D1Result)=>{
  const rows=result.meta?.rows_read
  if(!Number.isSafeInteger(rows)||rows<0){unknown=true;throw new Error('CERTIFICATION_READ_METRICS_UNAVAILABLE')}
  metrics.rowsRead+=rows
  if(rows>512)throw new Error('CERTIFICATION_QUERY_READ_BOUND_EXCEEDED')
  if(metrics.rowsRead>limits.rowsRead)throw new Error('CERTIFICATION_READ_BOUND_EXCEEDED')
  return result
 }
 function statement(raw:D1PreparedStatement):D1PreparedStatement{
  return {bind:(...values:unknown[])=>statement(raw.bind(...values)),
   async all(){reserveRows();return account(await raw.all())},
   async run(){reserveRows();return account(await raw.run())},
   async first(column?:string){reserveRows();const result=account(await raw.all());const row=result.results[0];return column?(row as Record<string,unknown>|undefined)?.[column]??null:row??null},
   async raw(){throw new Error('CERTIFICATION_RAW_UNSUPPORTED')},
   // Only the meter batch method may unwrap a statement.
   __raw:raw,
  } as unknown as D1PreparedStatement
 }
 const db={prepare:(sql:string)=>statement(database.prepare(sql)),async batch(statements:D1PreparedStatement[]){reserveRows(statements.length);return(await database.batch(statements.map(s=>(s as unknown as {__raw:D1PreparedStatement}).__raw))).map(account)},async exec(){throw new Error('CERTIFICATION_EXEC_UNSUPPORTED')},async dump(){throw new Error('CERTIFICATION_DUMP_FORBIDDEN')}} as unknown as D1Database
 return{db,metrics,unknown:()=>unknown,
  beforeModel(input:unknown){
   // UTF-8 byte length is a deliberately conservative prompt-token reservation,
   // plus message/tool framing and the provider's hard completion ceiling.
   const upper=new TextEncoder().encode(JSON.stringify(input)).length+4096+1200
   if(metrics.calls+1>limits.calls||metrics.tokens+upper>limits.tokens)throw new Error('CERTIFICATION_MODEL_RESERVATION_EXHAUSTED')
   metrics.calls++
  },
  afterModel(usage:{promptTokens:number;completionTokens:number}){
   if(![usage.promptTokens,usage.completionTokens].every(n=>Number.isSafeInteger(n)&&n>=0)){unknown=true;throw new Error('CERTIFICATION_MODEL_METRICS_UNAVAILABLE')}
   metrics.promptTokens+=usage.promptTokens;metrics.completionTokens+=usage.completionTokens;metrics.tokens=metrics.promptTokens+metrics.completionTokens
   if(metrics.tokens>limits.tokens)throw new Error('CERTIFICATION_TOKEN_BOUND_EXCEEDED')
  },
  modelUncertain(){unknown=true},
 }
}
