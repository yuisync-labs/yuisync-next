import { applyOperationalSnapshotToD1, OperationalWriterError } from './d1OperationalWriter'

const ROUTE='/internal/migration/operational'
const MAX_BODY_BYTES=8*1024*1024
const SHA=/^[a-f0-9]{64}$/

export type OperationalMigrationBindings={
  APP_ENV?:string
  DB?:D1Database
  EDGE_OPERATIONAL_MIGRATION_ENABLED?:string
  OPERATIONAL_MIGRATION_TOKEN?:string
}

async function digest(value:string):Promise<Uint8Array>{
  return new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))
}
async function safeEqual(left:string,right:string):Promise<boolean>{
  const [a,b]=await Promise.all([digest(left),digest(right)]); let diff=0
  for(let i=0;i<a.length;i+=1) diff|=a[i]^b[i]
  return diff===0
}
async function bodyBytes(request:Request):Promise<Uint8Array>{
  const length=Number(request.headers.get('content-length')||0)
  if(length>MAX_BODY_BYTES) throw new Error('BODY_TOO_LARGE')
  const bytes=new Uint8Array(await request.arrayBuffer())
  if(bytes.byteLength>MAX_BODY_BYTES) throw new Error('BODY_TOO_LARGE')
  return bytes
}

export async function handleOperationalMigrationRequest(request:Request,bindings:OperationalMigrationBindings):Promise<Response|null>{
  const url=new URL(request.url); if(url.pathname!==ROUTE) return null
  const enabled=bindings.EDGE_OPERATIONAL_MIGRATION_ENABLED==='true' && String(bindings.APP_ENV||'').toLowerCase()==='staging'
  if(!enabled) return Response.json({code:'NOT_FOUND'},{status:404})
  if(request.method!=='POST') return Response.json({code:'METHOD_NOT_ALLOWED'},{status:405})
  if(!bindings.DB || !bindings.OPERATIONAL_MIGRATION_TOKEN || bindings.OPERATIONAL_MIGRATION_TOKEN.length<32) return Response.json({code:'MIGRATION_NOT_CONFIGURED'},{status:503})
  const supplied=request.headers.get('x-yuisync-migration-token')||''
  if(!supplied || !(await safeEqual(supplied,bindings.OPERATIONAL_MIGRATION_TOKEN))) return Response.json({code:'UNAUTHORIZED'},{status:401})
  const expected=String(request.headers.get('x-yuisync-migration-snapshot-sha256')||'').toLowerCase()
  if(!SHA.test(expected)) return Response.json({code:'SNAPSHOT_CHECKSUM_REQUIRED'},{status:400})
  try{
    const bytes=await bodyBytes(request); const actual=Array.from(await digest(new TextDecoder().decode(bytes))).map((n)=>n.toString(16).padStart(2,'0')).join('')
    if(actual!==expected) return Response.json({code:'SNAPSHOT_CHECKSUM_MISMATCH'},{status:409})
    let snapshot:unknown
    try{ snapshot=JSON.parse(new TextDecoder().decode(bytes)) }catch{ return Response.json({code:'INVALID_JSON'},{status:400}) }
    const result=await applyOperationalSnapshotToD1({database:bindings.DB,snapshot})
    return Response.json({status:result.status,inserted_rows:result.insertedRows,batch_count:result.batchCount,row_counts:result.rowCounts},{status:200})
  }catch(error){
    if(error instanceof OperationalWriterError){
      const status=error.code==='INVALID_SNAPSHOT'?400:error.code==='DESTINATION_DIVERGED'?409:503
      return Response.json({code:error.code},{status})
    }
    if(error instanceof Error && error.message==='BODY_TOO_LARGE') return Response.json({code:'BODY_TOO_LARGE'},{status:413})
    return Response.json({code:'MIGRATION_UNAVAILABLE'},{status:503})
  }
}

export { ROUTE as OPERATIONAL_MIGRATION_ROUTE }
