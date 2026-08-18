import { getAuthDatabaseReadiness } from './auth/authDatabaseFeature'
import { CoordinationDurableObject } from './coordination/coordinationDurableObject'
import { hasCoordinationBinding, isEdgeCoordinationEnabled } from './coordination/coordinationFeature'
import { hasD1Binding, isEdgeDatabaseEnabled } from './databaseFeature'
import { resolveRequestId } from './requestContext'

const REQUIRED_MAIN_SCHEMA_VERSION = '28'

type MainSchemaCapability =
  | { key: string; kind: 'table' | 'index'; name: string }
  | { key: string; kind: 'column'; table: string; name: string }

const REQUIRED_MAIN_SCHEMA_CAPABILITIES: MainSchemaCapability[] = [
  // Operational integrity v25. These are the columns/indexes that keep appointment
  // billing, subscription benefits, sale origins and canonical weight boundaries explicit.
  { key: 'column:appointments.billing_intent_type', kind: 'column', table: 'appointments', name: 'billing_intent_type' },
  { key: 'column:appointments.billing_intent_subscription_id', kind: 'column', table: 'appointments', name: 'billing_intent_subscription_id' },
  { key: 'column:client_subscriptions.benefit_ledger_base_used_json', kind: 'column', table: 'client_subscriptions', name: 'benefit_ledger_base_used_json' },
  { key: 'column:sales.origin_type', kind: 'column', table: 'sales', name: 'origin_type' },
  { key: 'column:sales.origin_id', kind: 'column', table: 'sales', name: 'origin_id' },
  { key: 'index:sales_scope_origin_idx', kind: 'index', name: 'sales_scope_origin_idx' },
  { key: 'column:services.min_weight_grams', kind: 'column', table: 'services', name: 'min_weight_grams' },
  { key: 'column:services.max_weight_grams', kind: 'column', table: 'services', name: 'max_weight_grams' },
  { key: 'column:appointment_services.min_weight_grams', kind: 'column', table: 'appointment_services', name: 'min_weight_grams' },
  { key: 'column:appointment_services.max_weight_grams', kind: 'column', table: 'appointment_services', name: 'max_weight_grams' },

  // WhatsApp Cloud API v26-v28. Version metadata is insufficient if any one of
  // these tenant-scoped persistence/idempotency/status objects is missing.
  { key: 'table:whatsapp_waba_accounts', kind: 'table', name: 'whatsapp_waba_accounts' },
  { key: 'table:whatsapp_phone_connections', kind: 'table', name: 'whatsapp_phone_connections' },
  { key: 'table:whatsapp_ingress_receipts', kind: 'table', name: 'whatsapp_ingress_receipts' },
  { key: 'table:whatsapp_access_credentials', kind: 'table', name: 'whatsapp_access_credentials' },
  { key: 'table:whatsapp_outbound_messages', kind: 'table', name: 'whatsapp_outbound_messages' },
  { key: 'table:whatsapp_delivery_receipts', kind: 'table', name: 'whatsapp_delivery_receipts' },
  { key: 'index:whatsapp_waba_accounts_tenant_idx', kind: 'index', name: 'whatsapp_waba_accounts_tenant_idx' },
  { key: 'index:whatsapp_phone_connections_tenant_idx', kind: 'index', name: 'whatsapp_phone_connections_tenant_idx' },
  { key: 'index:whatsapp_ingress_receipts_phone_idx', kind: 'index', name: 'whatsapp_ingress_receipts_phone_idx' },
  { key: 'index:whatsapp_access_credentials_phone_idx', kind: 'index', name: 'whatsapp_access_credentials_phone_idx' },
  { key: 'index:whatsapp_outbound_internal_message_unique', kind: 'index', name: 'whatsapp_outbound_internal_message_unique' },
  { key: 'index:whatsapp_outbound_provider_message_unique', kind: 'index', name: 'whatsapp_outbound_provider_message_unique' },
  { key: 'index:whatsapp_outbound_phone_status_idx', kind: 'index', name: 'whatsapp_outbound_phone_status_idx' },
  { key: 'index:whatsapp_delivery_receipts_message_idx', kind: 'index', name: 'whatsapp_delivery_receipts_message_idx' },
  { key: 'column:whatsapp_access_credentials.token_ciphertext', kind: 'column', table: 'whatsapp_access_credentials', name: 'token_ciphertext' },
  { key: 'column:whatsapp_access_credentials.token_iv', kind: 'column', table: 'whatsapp_access_credentials', name: 'token_iv' },
  { key: 'column:whatsapp_access_credentials.key_version', kind: 'column', table: 'whatsapp_access_credentials', name: 'key_version' },
  { key: 'column:whatsapp_outbound_messages.idempotency_key', kind: 'column', table: 'whatsapp_outbound_messages', name: 'idempotency_key' },
  { key: 'column:whatsapp_outbound_messages.internal_message_id', kind: 'column', table: 'whatsapp_outbound_messages', name: 'internal_message_id' },
  { key: 'column:whatsapp_outbound_messages.provider_message_id', kind: 'column', table: 'whatsapp_outbound_messages', name: 'provider_message_id' },
  { key: 'column:whatsapp_outbound_messages.status', kind: 'column', table: 'whatsapp_outbound_messages', name: 'status' },
  { key: 'column:whatsapp_outbound_messages.last_provider_status_at_ms', kind: 'column', table: 'whatsapp_outbound_messages', name: 'last_provider_status_at_ms' },
]

export type FinalReadinessBindings={
  APP_ENV?:string;SERVICE_NAME?:string;RELEASE_CHANNEL?:string;
  EDGE_DATABASE_ENABLED?:string;DB?:D1Database;
  EDGE_COORDINATION_ENABLED?:string;COORDINATOR?:DurableObjectNamespace<CoordinationDurableObject>;
  EDGE_BETTER_AUTH_ENABLED?:string;AUTH_DB?:D1Database;BETTER_AUTH_SECRET?:string;
  EDGE_OPERATIONAL_MIGRATION_ENABLED?:string;EDGE_AUTH_MIGRATION_ENABLED?:string;
}

function schemaCapabilitySql(capability: MainSchemaCapability): string {
  if (capability.kind === 'column') {
    return `SELECT '${capability.key}' AS capability, EXISTS(SELECT 1 FROM pragma_table_info('${capability.table}') WHERE name='${capability.name}') AS present`
  }
  return `SELECT '${capability.key}' AS capability, EXISTS(SELECT 1 FROM sqlite_schema WHERE type='${capability.kind}' AND name='${capability.name}') AS present`
}

async function mainSchema(database:D1Database|undefined){
  if(!database)return{status:'not_configured',version:null,capabilities:'not_checked',missingCapabilities:[] as string[]}
  try{
    const row=await database.prepare("SELECT value FROM _yuisync_system_metadata WHERE key='schema_version'").first<{value:string}>()
    const version=row?.value??null
    if(String(version)!==REQUIRED_MAIN_SCHEMA_VERSION){
      return{status:'wrong_version',version,capabilities:'not_checked',missingCapabilities:[] as string[]}
    }

    const capabilityQuery=REQUIRED_MAIN_SCHEMA_CAPABILITIES.map(schemaCapabilitySql).join(' UNION ALL ')
    const result=await database.prepare(capabilityQuery).all<{capability:string;present:number}>()
    const observed=new Map(result.results.map((item)=>[item.capability,Number(item.present)]))
    const missingCapabilities=REQUIRED_MAIN_SCHEMA_CAPABILITIES
      .map((capability)=>capability.key)
      .filter((key)=>observed.get(key)!==1)

    return missingCapabilities.length===0
      ?{status:'ready',version,capabilities:'ready',missingCapabilities}
      :{status:'incomplete',version,capabilities:'incomplete',missingCapabilities}
  }catch{return{status:'unavailable',version:null,capabilities:'unavailable',missingCapabilities:[] as string[]}}
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
    &&dbEnabled&&dbBinding&&main.status==='ready'&&main.capabilities==='ready'
    &&authEnabled&&authConfig==='configured'&&authCore==='ready'
    &&(!coordinationEnabled||coordination==='ready')&&migrationClosed
  return Response.json({
    service:bindings.SERVICE_NAME,environment:bindings.APP_ENV,release_channel:bindings.RELEASE_CHANNEL,request_id:requestId,status:ready?'ready':'not_ready',
    checks:{database:main.status,schema_version:main.version,schema_capabilities:main.capabilities,auth_database:authConfig==='configured'&&authCore==='ready'?'configured':authCore,
      coordination,better_auth:authEnabled?'enabled':'disabled',migration_capabilities:migrationClosed?'closed':'open'},
    missing_schema_capabilities:main.missingCapabilities,
  },{status:ready?200:503,headers:{'cache-control':'no-store','x-request-id':requestId,'x-content-type-options':'nosniff','referrer-policy':'no-referrer'}})
}
