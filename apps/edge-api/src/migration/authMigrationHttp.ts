import { getAuthDatabaseReadiness } from '../auth/authDatabaseFeature'
import { applyAuthMigration, AuthMigrationError } from './d1AuthMigrationWriter'

export type AuthMigrationBindings={
  APP_ENV?:string; DB?:D1Database; AUTH_DB?:D1Database; EDGE_BETTER_AUTH_ENABLED?:string; BETTER_AUTH_SECRET?:string;
  EDGE_AUTH_MIGRATION_ENABLED?:string; AUTH_MIGRATION_TOKEN?:string
}
const ROUTE='/internal/migration/auth'
const MAX_BODY=2*1024*1024
async function sha(value:Uint8Array|string){const bytes=typeof value==='string'?new TextEncoder().encode(value):new Uint8Array(value);const buffer=bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength) as ArrayBuffer;return new Uint8Array(await crypto.subtle.digest('SHA-256',buffer))}
async function equal(a:string,b:string){const [x,y]=await Promise.all([sha(a),sha(b)]);let d=0;for(let i=0;i<x.length;i+=1)d|=x[i]^y[i];return d===0}
function hex(bytes:Uint8Array){return Array.from(bytes).map((v)=>v.toString(16).padStart(2,'0')).join('')}

export async function handleAuthMigrationRequest(request:Request,bindings:AuthMigrationBindings):Promise<Response|null>{
  const {pathname}=new URL(request.url);if(pathname!==ROUTE)return null
  if(bindings.EDGE_AUTH_MIGRATION_ENABLED!=='true'||String(bindings.APP_ENV||'').toLowerCase()!=='staging')return Response.json({code:'NOT_FOUND'},{status:404})
  if(request.method!=='POST')return Response.json({code:'METHOD_NOT_ALLOWED'},{status:405})
  if(!bindings.DB||!bindings.AUTH_DB||getAuthDatabaseReadiness(bindings)!=='configured'||!bindings.AUTH_MIGRATION_TOKEN||bindings.AUTH_MIGRATION_TOKEN.length<32)return Response.json({code:'AUTH_MIGRATION_NOT_CONFIGURED'},{status:503})
  const token=request.headers.get('x-yuisync-auth-migration-token')||'';if(!token||!(await equal(token,bindings.AUTH_MIGRATION_TOKEN)))return Response.json({code:'UNAUTHORIZED'},{status:401})
  const expected=String(request.headers.get('x-yuisync-migration-snapshot-sha256')||'').trim().toLowerCase();if(!/^[a-f0-9]{64}$/.test(expected))return Response.json({code:'SNAPSHOT_CHECKSUM_REQUIRED'},{status:400})
  const length=Number(request.headers.get('content-length')||0);if(length>MAX_BODY)return Response.json({code:'BODY_TOO_LARGE'},{status:413})
  const bytes=new Uint8Array(await request.arrayBuffer());if(bytes.byteLength>MAX_BODY)return Response.json({code:'BODY_TOO_LARGE'},{status:413})
  if(hex(await sha(bytes))!==expected)return Response.json({code:'SNAPSHOT_CHECKSUM_MISMATCH'},{status:409})
  let snapshot:unknown;try{snapshot=JSON.parse(new TextDecoder().decode(bytes))}catch{return Response.json({code:'INVALID_JSON'},{status:400})}
  try{const result=await applyAuthMigration({authDatabase:bindings.AUTH_DB,database:bindings.DB,snapshot});return Response.json({status:result.status,user_count:result.userCount,membership_count:result.membershipCount,sessions_migrated:0})}
  catch(error){if(error instanceof AuthMigrationError)return Response.json({code:error.code},{status:error.code==='INVALID_SNAPSHOT'?400:error.code==='AUTH_DIVERGED'?409:503});return Response.json({code:'AUTH_MIGRATION_UNAVAILABLE'},{status:503})}
}
export { ROUTE as AUTH_MIGRATION_ROUTE }
