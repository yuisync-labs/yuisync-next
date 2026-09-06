import { getAuthDatabaseReadiness } from './auth/authDatabaseFeature'
import { recoveryEmailConfigured } from './auth/passwordRecoveryEmail'
import { CoordinationDurableObject } from './coordination/coordinationDurableObject'
import { hasCoordinationBinding, isEdgeCoordinationEnabled } from './coordination/coordinationFeature'
import { hasD1Binding, isEdgeDatabaseEnabled } from './databaseFeature'
import { resolveRequestId } from './requestContext'

const REQUIRED_MAIN_SCHEMA_VERSION = '30'

type MainSchemaObject = { key: string; kind: 'table' | 'index' | 'trigger'; name: string }
type MainSchemaColumnGroup = { table: string; columns: string[] }

const REQUIRED_MAIN_SCHEMA_OBJECTS: MainSchemaObject[] = [
  // Operational integrity v25.
  { key: 'index:sales_scope_origin_idx', kind: 'index', name: 'sales_scope_origin_idx' },

  // Package ledger projection/repair v29.
  { key: 'trigger:client_subscription_base_usage_capacity_guard', kind: 'trigger', name: 'client_subscription_base_usage_capacity_guard' },
  { key: 'trigger:client_subscription_usage_projection_from_base', kind: 'trigger', name: 'client_subscription_usage_projection_from_base' },
  { key: 'trigger:subscription_usage_projection_after_allocation_insert', kind: 'trigger', name: 'subscription_usage_projection_after_allocation_insert' },
  { key: 'trigger:subscription_usage_projection_after_allocation_update', kind: 'trigger', name: 'subscription_usage_projection_after_allocation_update' },
  { key: 'trigger:subscription_usage_projection_after_allocation_delete', kind: 'trigger', name: 'subscription_usage_projection_after_allocation_delete' },
  { key: 'trigger:package_allocation_from_late_service_consumption', kind: 'trigger', name: 'package_allocation_from_late_service_consumption' },

  // Active-tab integration v30.
  { key: 'trigger:cash_register_single_open_insert_guard', kind: 'trigger', name: 'cash_register_single_open_insert_guard' },
  { key: 'trigger:cash_register_single_open_reopen_guard', kind: 'trigger', name: 'cash_register_single_open_reopen_guard' },

  // WhatsApp Cloud API v26-v28.
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
]

const REQUIRED_MAIN_SCHEMA_COLUMNS: MainSchemaColumnGroup[] = [
  // Operational integrity v25: explicit billing/allocation semantics and canonical units.
  { table: 'appointments', columns: ['billing_intent_type', 'billing_intent_subscription_id'] },
  { table: 'client_subscriptions', columns: ['benefit_ledger_base_used_json'] },
  { table: 'sales', columns: ['origin_type', 'origin_id'] },
  { table: 'services', columns: ['min_weight_grams', 'max_weight_grams'] },
  { table: 'appointment_services', columns: ['min_weight_grams', 'max_weight_grams'] },

  // Active-tab integration v30: dashboard chat state that must survive D1 round-trips.
  { table: 'chat_threads', columns: ['customer_name', 'intent', 'assigned_staff_key', 'csat_score', 'closed_at_ms', 'context_json'] },

  // WhatsApp v27-v28: encrypted credentials and outbound reconciliation/idempotency.
  { table: 'whatsapp_access_credentials', columns: ['token_ciphertext', 'token_iv', 'key_version'] },
  { table: 'whatsapp_outbound_messages', columns: ['idempotency_key', 'internal_message_id', 'provider_message_id', 'status', 'last_provider_status_at_ms'] },
]

export type FinalReadinessBindings={
  APP_ENV?:string;SERVICE_NAME?:string;RELEASE_CHANNEL?:string;
  EDGE_DATABASE_ENABLED?:string;DB?:D1Database;
  EDGE_COORDINATION_ENABLED?:string;COORDINATOR?:DurableObjectNamespace<CoordinationDurableObject>;
  EDGE_BETTER_AUTH_ENABLED?:string;AUTH_DB?:D1Database;BETTER_AUTH_SECRET?:string;
  EDGE_OPERATIONAL_MIGRATION_ENABLED?:string;EDGE_AUTH_MIGRATION_ENABLED?:string;
  AUTH_EMAIL_API_KEY?:string;AUTH_EMAIL_FROM?:string;
}

function sqlLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`
}

async function missingMainSchemaCapabilities(database: D1Database): Promise<string[]> {
  const objectNames=REQUIRED_MAIN_SCHEMA_OBJECTS.map((item)=>sqlLiteral(item.name)).join(',')
  const objectRows=await database
    .prepare(`SELECT type,name FROM sqlite_schema WHERE type IN ('table','index','trigger') AND name IN (${objectNames})`)
    .all<{type:string;name:string}>()
  const presentObjects=new Set(objectRows.results.map((item)=>`${item.type}:${item.name}`))
  const missing=REQUIRED_MAIN_SCHEMA_OBJECTS
    .filter((item)=>!presentObjects.has(`${item.kind}:${item.name}`))
    .map((item)=>item.key)

  // D1 supports classic PRAGMA table_info reliably. Keep the list fixed and validated
  // at build time instead of interpolating any request/user-controlled identifier.
  for(const group of REQUIRED_MAIN_SCHEMA_COLUMNS){
    if(!/^[a-z0-9_]+$/i.test(group.table))throw new Error('Invalid readiness schema identifier')
    const columnRows=await database.prepare(`PRAGMA table_info(${group.table})`).all<{name:string}>()
    const presentColumns=new Set(columnRows.results.map((item)=>item.name))
    for(const column of group.columns){
      if(!presentColumns.has(column))missing.push(`column:${group.table}.${column}`)
    }
  }

  return missing
}

async function mainSchema(database:D1Database|undefined){
  if(!database)return{status:'not_configured',version:null,capabilities:'not_checked',missingCapabilities:[] as string[]}
  try{
    const row=await database.prepare("SELECT value FROM _yuisync_system_metadata WHERE key='schema_version'").first<{value:string}>()
    const version=row?.value??null
    if(String(version)!==REQUIRED_MAIN_SCHEMA_VERSION){
      return{status:'wrong_version',version,capabilities:'not_checked',missingCapabilities:[] as string[]}
    }

    const missingCapabilities=await missingMainSchemaCapabilities(database)
    return missingCapabilities.length===0
      ?{status:'ready',version,capabilities:'ready',missingCapabilities}
      :{status:'incomplete',version,capabilities:'incomplete',missingCapabilities}
  }catch{return{status:'unavailable',version:null,capabilities:'unavailable',missingCapabilities:[] as string[]}}
}
async function authSchema(database:D1Database|undefined){
  if(!database)return'not_configured'
  try{const result=await database.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name IN ('user','session','account','verification','rateLimit') ORDER BY name").all<{name:string}>();return result.results.map((r)=>r.name).sort().join(',')==='account,rateLimit,session,user,verification'?'ready':'incomplete'}catch{return'unavailable'}
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
      coordination,better_auth:authEnabled?'enabled':'disabled',migration_capabilities:migrationClosed?'closed':'open',password_recovery:recoveryEmailConfigured(bindings)?'configured':'not_configured'},
    missing_schema_capabilities:main.missingCapabilities,
  },{status:ready?200:503,headers:{'cache-control':'no-store','x-request-id':requestId,'x-content-type-options':'nosniff','referrer-policy':'no-referrer'}})
}
