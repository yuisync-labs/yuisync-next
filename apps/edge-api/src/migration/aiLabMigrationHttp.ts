import { AiLabMigrationWriterError, applyAiLabSnapshotToD1 } from './d1AiLabMigrationWriter'

const ROUTE='/internal/migration/ai-lab'
const MAX_BODY_BYTES=8*1024*1024
const SHA=/^[a-f0-9]{64}$/

export type AiLabMigrationBindings={APP_ENV?:string;DB?:D1Database;EDGE_OPERATIONAL_MIGRATION_ENABLED?:string;OPERATIONAL_MIGRATION_TOKEN?:string}

async function hashText(value:string):Promise<string>{
  const buffer=new TextEncoder().encode(value).buffer as ArrayBuffer
  const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',buffer))
  return Array.from(digest).map((value)=>value.toString(16).padStart(2,'0')).join('')
}
async function safeEqual(left:string,right:string):Promise<boolean>{
  const [a,b]=await Promise.all([hashText(left),hashText(right)])
  if(a.length!==b.length)return false
  let diff=0;for(let index=0;index<a.length;index+=1)diff|=a.charCodeAt(index)^b.charCodeAt(index)
  return diff===0
}

export async function handleAiLabMigrationRequest(request:Request,bindings:AiLabMigrationBindings):Promise<Response|null>{
  if(new URL(request.url).pathname!==ROUTE)return null
  if(bindings.EDGE_OPERATIONAL_MIGRATION_ENABLED!=='true'||String(bindings.APP_ENV||'').toLowerCase()!=='staging')return Response.json({code:'NOT_FOUND'},{status:404})
  if(request.method!=='POST')return Response.json({code:'METHOD_NOT_ALLOWED'},{status:405})
  if(!bindings.DB||!bindings.OPERATIONAL_MIGRATION_TOKEN||bindings.OPERATIONAL_MIGRATION_TOKEN.length<32)return Response.json({code:'MIGRATION_NOT_CONFIGURED'},{status:503})
  const supplied=request.headers.get('x-yuisync-migration-token')||''
  if(!supplied||!(await safeEqual(supplied,bindings.OPERATIONAL_MIGRATION_TOKEN)))return Response.json({code:'UNAUTHORIZED'},{status:401})
  const expected=String(request.headers.get('x-yuisync-migration-snapshot-sha256')||'').trim().toLowerCase()
  if(!SHA.test(expected))return Response.json({code:'SNAPSHOT_CHECKSUM_REQUIRED'},{status:400})
  const declaredLength=Number(request.headers.get('content-length')||0)
  if(declaredLength>MAX_BODY_BYTES)return Response.json({code:'BODY_TOO_LARGE'},{status:413})
  const text=await request.text()
  if(new TextEncoder().encode(text).byteLength>MAX_BODY_BYTES)return Response.json({code:'BODY_TOO_LARGE'},{status:413})
  if(await hashText(text)!==expected)return Response.json({code:'SNAPSHOT_CHECKSUM_MISMATCH'},{status:409})
  let snapshot:unknown
  try{snapshot=JSON.parse(text)}catch{return Response.json({code:'INVALID_JSON'},{status:400})}
  try{
    const result=await applyAiLabSnapshotToD1({database:bindings.DB,snapshot})
    return Response.json({status:result.status,inserted_rows:result.insertedRows,batch_count:result.batchCount,row_counts:result.rowCounts})
  }catch(error){
    if(error instanceof AiLabMigrationWriterError)return Response.json({code:error.code},{status:error.code==='INVALID_SNAPSHOT'?400:error.code==='DESTINATION_DIVERGED'?409:503})
    return Response.json({code:'MIGRATION_UNAVAILABLE'},{status:503})
  }
}
export { ROUTE as AI_LAB_MIGRATION_ROUTE }
