import { createWranglerD1ReadOnlyRunner } from './foundationExtractors.mjs'
import { OPERATIONAL_PROJECTION, projectOperationalSnapshot } from './phase8OperationalProjection.mjs'

const SOURCE_TABLES = Object.freeze([
  'products','petshop_services','stock_movements','settings','appointments','service_delivery_orders',
  'sales','sale_items','sale_payment_splits','chat_sessions','chat_messages','fiscal_documents',
])
const DESTINATION_TABLES = Object.freeze([
  'catalog_products','services','inventory_balances','inventory_movements','module_operational_settings','booking_hours',
  'payment_method_settings','appointments','appointment_services','transport_options','appointment_transport',
  'sales','sale_items','payments','payment_splits','chat_threads','chat_messages','fiscal_documents',
])
const PAGE_SIZE = 500
const MAX_PAGES = 400

export class OperationalExtractorError extends Error {
  constructor(code, message = 'Operational extraction failed.') { super(message); this.name='OperationalExtractorError'; this.code=code }
}

function scopeOf(raw = {}) {
  const tenant_id = String(raw.tenant_id || '').trim()
  const module_id = String(raw.module_id || '').trim().toLowerCase()
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(tenant_id)) throw new OperationalExtractorError('INVALID_TENANT_ID')
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(module_id)) throw new OperationalExtractorError('INVALID_MODULE_ID')
  return { tenant_id, module_id }
}

function supabaseBase(value) {
  let url
  try { url = new URL(String(value || '').trim()) } catch { throw new OperationalExtractorError('INVALID_SUPABASE_URL') }
  const local = ['localhost','127.0.0.1','[::1]'].includes(url.hostname)
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) throw new OperationalExtractorError('INVALID_SUPABASE_URL')
  url.pathname='/'; url.search=''; url.hash=''; return url
}

async function readSupabaseTable({ baseUrl, key, table, scope, fetcher }) {
  const rows = []; const opaque = key.startsWith('sb_secret_')
  for (let page=0; page<MAX_PAGES; page+=1) {
    const url = new URL(`/rest/v1/${table}`, baseUrl)
    url.searchParams.set('select','*')
    url.searchParams.set('tenant_id',`eq.${scope.tenant_id}`)
    url.searchParams.set('module_id',`eq.${scope.module_id}`)
    url.searchParams.set('order','id.asc')
    const headers = { accept:'application/json', apikey:key, range:`${page*PAGE_SIZE}-${page*PAGE_SIZE+PAGE_SIZE-1}` }
    if (!opaque) headers.authorization = `Bearer ${key}`
    let response
    try { response = await fetcher(url,{ method:'GET',headers,redirect:'error' }) } catch { throw new OperationalExtractorError('SUPABASE_UNAVAILABLE') }
    if (!response.ok) throw new OperationalExtractorError('SUPABASE_READ_FAILED', `Supabase ${table} read failed with HTTP ${response.status}.`)
    let chunk
    try { chunk = await response.json() } catch { throw new OperationalExtractorError('SUPABASE_RESPONSE_INVALID') }
    if (!Array.isArray(chunk)) throw new OperationalExtractorError('SUPABASE_RESPONSE_INVALID')
    rows.push(...chunk)
    if (chunk.length < PAGE_SIZE) return rows
  }
  throw new OperationalExtractorError('SUPABASE_PAGINATION_LIMIT_EXCEEDED')
}

export async function extractSupabaseOperationalSnapshot({ supabaseUrl, adminApiKey, scope: rawScope, fetcher=fetch } = {}) {
  const scope = scopeOf(rawScope)
  const key = String(adminApiKey || '').trim()
  if (!key || /\s/.test(key) || key.length > 8192) throw new OperationalExtractorError('INVALID_SUPABASE_ADMIN_KEY')
  const baseUrl = supabaseBase(supabaseUrl)
  const tables = {}
  for (const table of SOURCE_TABLES) tables[table] = await readSupabaseTable({ baseUrl,key,table,scope,fetcher })
  return projectOperationalSnapshot({ tables }, { tenantId:scope.tenant_id, moduleId:scope.module_id })
}

function sqlLiteral(value) { return `'${String(value).replaceAll("'","''")}'` }
export function buildD1OperationalQueries(rawScope) {
  const scope = scopeOf(rawScope); const tenant=sqlLiteral(scope.tenant_id); const module=sqlLiteral(scope.module_id)
  return Object.freeze(Object.fromEntries(DESTINATION_TABLES.map((table) => [table,
    `SELECT * FROM ${table} WHERE tenant_id = ${tenant} AND module_id = ${module} ORDER BY 1,2,3`
  ])))
}

export async function extractD1OperationalSnapshot({ scope: rawScope, runner=createWranglerD1ReadOnlyRunner() } = {}) {
  const scope = scopeOf(rawScope); const queries=buildD1OperationalQueries(scope); const collections={}
  for (const table of DESTINATION_TABLES) collections[table] = await runner(queries[table])
  return Object.freeze({ projection:`${OPERATIONAL_PROJECTION.name}/${OPERATIONAL_PROJECTION.version}`, source:'d1', scope, collections,
    transient_policy:{ collections:['financial_effects','operation_checkpoints','operation_effects','effect_outbox'], strategy:'start_clean_after_freeze_and_drain' } })
}

export { SOURCE_TABLES, DESTINATION_TABLES }
