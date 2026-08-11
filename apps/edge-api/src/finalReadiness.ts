import { getAuthDatabaseReadiness } from './auth/authDatabaseFeature'
import { CoordinationDurableObject } from './coordination/coordinationDurableObject'
import { hasCoordinationBinding, isEdgeCoordinationEnabled } from './coordination/coordinationFeature'
import { hasD1Binding, isEdgeDatabaseEnabled } from './databaseFeature'
import { resolveRequestId } from './requestContext'

export type FinalReadinessBindings={
  APP_ENV?:string;SERVICE_NAME?:string;RELEASE_CHANNEL?:string;
  EDGE_DATABASE_ENABLED?:string;DB?:D1Database;
  EDGE_COORDINATION_ENABLED?:string;COORDINATOR?:DurableObjectNamespace<CoordinationDurableObject>;
  EDGE_BETTER_AUTH_ENABLED?:string;AUTH_DB?:D1Database;BETTER_AUTH_SECRET?:string;
  EDGE_OPERATIONAL_MIGRATION_ENABLED?:string;EDGE_AUTH_MIGRATION_ENABLED?:string;
}

async function mainSchema(database:D1Database|undefined){
  if(!database)return{status:'not_configured',version:null}
  try{const row=await database.prepare("SELECT value FROM _yuisync_system_metadata WHERE key='schema_version'").first<{value:string}>();return{status:String(row?.value)==='22'?'ready':'wrong_version',version:row?.value??null}}
  catch{return{status:'unavailable',version:null}}
}
async function authSchema(database:D1Database|undefined){
  if(!database)return'not_configured'
  try{const result=await database.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name IN ('user','session','account','verification') ORDER BY name").all<{name:string}>();return result.results.map((r)=>r.name).sort().join(',')==='account,session,user,verification'?'ready':'incomplete'}catch{return'unavailable'}
}

export async function handleFinalReadiness(request:Request,bindings:FinalReadinessBindings):Promise<Response|null>{
  if(new URL(request.url).pathname!=='/ready'||request.method!=='GET')return null
  const requestId=resolveRequestId(request.headers.get('x-request-id')??undefined)
  const dbEnabled=isEdgeDatabaseEnabled(bindings.EDGE_DATABASE_ENABLED)
  const dbBinding=hasD1Binding(bindings.DB)
  const main=await mainSchema(dbBinding?bindings.DB:undefined)
  const authConfig=getAuthDatabaseReadiness(bindings as never)
  const authEnabled=bindings.EDGE_BETTER_AUTH_ENABLED==='true'
  const authCore=authEnabled?await authSchema(bindings.AUTH_DB):'not_configured'
  const coordinationEnabled=isEdgeCoordinationEnabled(bindings.EDGE_COORDINATION_ENABLED)
  const coordination=coordinationEnabled?(hasCoordinationBinding(bindings.COORDINATOR)?'ready':'not_configured'):'disabled'
  const migrationClosed=bindings.EDGE_OPERATIONAL_MIGRATION_ENABLED!=='true'&&bindings.EDGE_AUTH_MIGRATION_ENABLED!=='true'
  const ready=Boolean(bindings.APP_ENV&&bindings.SERVICE_NAME&&bindings.RELEASE_CHANNEL)
    &&dbEnabled&&dbBinding&&main.status==='ready'
    &&authEnabled&&authConfig==='configured'&&authCore==='ready'
    &&(!coordinationEnabled||coordination==='ready')&&migrationClosed
  return Response.json({
    service:bindings.SERVICE_NAME,environment:bindings.APP_ENV,release_channel:bindings.RELEASE_CHANNEL,request_id:requestId,status:ready?'ready':'not_ready',
    checks:{database:main.status,schema_version:main.version,auth_database:authConfig==='configured'&&authCore==='ready'?'configured':authCore,
      coordination,better_auth:authEnabled?'enabled':'disabled',migration_capabilities:migrationClosed?'closed':'open'},
  },{status:ready?200:503,headers:{'cache-control':'no-store','x-request-id':requestId,'x-content-type-options':'nosniff','referrer-policy':'no-referrer'}})
}