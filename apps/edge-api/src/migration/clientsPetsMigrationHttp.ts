import { ClientsPetsWriterError, writeClientsPetsSnapshot } from './d1ClientsPetsWriter'

export type ClientsPetsMigrationBindings={APP_ENV?:string;DB?:D1Database;EDGE_OPERATIONAL_MIGRATION_ENABLED?:string;OPERATIONAL_MIGRATION_TOKEN?:string}
const ROUTE='/internal/migration/clients-pets'
const MAX_BODY=8*1024*1024
async function digest(value:Uint8Array|string){const bytes=typeof value==='string'?new TextEncoder().encode(value):new Uint8Array(value);const buffer=bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength) as ArrayBuffer;return new Uint8Array(await crypto.subtle.digest('SHA-256',buffer))}
async function safeEqual(a:string,b:string){const[x,y]=await Promise.all([digest(a),digest(b)]);let d=0;for(let i=0;i<x.length;i+=1)d|=x[i]^y[i];return d===0}
function hex(bytes:Uint8Array){return Array.from(bytes).map((v)=>v.toString(16).padStart(2,'0')).join('')}

export async function handleClientsPetsMigrationRequest(request:Request,bindings:ClientsPetsMigrationBindings):Promise<Response|null>{
  if(new URL(request.url).pathname!==ROUTE)return null
  if(bindings.EDGE_OPERATIONAL_MIGRATION_ENABLED!=='true'||String(bindings.APP_ENV||'').toLowerCase()!=='staging')return Response.json({code:'NOT_FOUND'},{status:404})
  if(request.method!=='POST')return Response.json({code:'METHOD_NOT_ALLOWED'},{status:405})
  if(!bindings.DB||!bindings.OPERATIONAL_MIGRATION_TOKEN||bindings.OPERATIONAL_MIGRATION_TOKEN.length<32)return Response.json({code:'MIGRATION_NOT_CONFIGURED'},{status:503})
  const token=request.headers.get('x-yuisync-migration-token')||'';if(!token||!(await safeEqual(token,bindings.OPERATIONAL_MIGRATION_TOKEN)))return Response.json({code:'UNAUTHORIZED'},{status:401})
  const expected=String(request.headers.get('x-yuisync-migration-snapshot-sha256')||'').toLowerCase();if(!/^[a-f0-9]{64}$/.test(expected))return Response.json({code:'SNAPSHOT_CHECKSUM_REQUIRED'},{status:400})
  const length=Number(request.headers.get('content-length')||0);if(length>MAX_BODY)return Response.json({code:'BODY_TOO_LARGE'},{status:413})
  const bytes=new Uint8Array(await request.arrayBuffer());if(bytes.byteLength>MAX_BODY)return Response.json({code:'BODY_TOO_LARGE'},{status:413})
  if(hex(await digest(bytes))!==expected)return Response.json({code:'SNAPSHOT_CHECKSUM_MISMATCH'},{status:409})
  let snapshot:unknown;try{snapshot=JSON.parse(new TextDecoder().decode(bytes))}catch{return Response.json({code:'INVALID_JSON'},{status:400})}
  try{const result=await writeClientsPetsSnapshot({database:bindings.DB,snapshot});return Response.json({status:result.status,client_count:result.clientCount,pet_count:result.petCount,group_count:result.groupCount})}
  catch(error){if(error instanceof ClientsPetsWriterError)return Response.json({code:error.code},{status:error.code==='INVALID_SNAPSHOT'?400:error.code==='CLIENT_GROUP_TOO_LARGE'?413:409});return Response.json({code:'MIGRATION_UNAVAILABLE'},{status:503})}
}
