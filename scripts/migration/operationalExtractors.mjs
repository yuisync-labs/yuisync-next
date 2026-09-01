import { createWranglerD1ReadOnlyRunner } from './foundationExtractors.mjs'
import { LEGACY_CANONICAL_PROJECTION, projectLegacyCanonicalSnapshot } from './legacyCanonicalProjection.mjs'

const byId = (module = true) => ({ module, order: 'id.asc' })
const singleton = { module: true, order: 'tenant_id.asc,module_id.asc' }

const SOURCE_TABLES = Object.freeze({
  products:byId(), petshop_services:byId(), stock_movements:byId(), settings:singleton, appointments:byId(),
  sales:byId(), sale_items:byId(false), sale_payment_splits:byId(false),
  chat_sessions:byId(), chat_messages:byId(false), fiscal_documents:byId(),
  subscription_plans:byId(), client_subscriptions:byId(), loyalty_settings:singleton, loyalty_points:byId(),
  commission_rules:byId(), cash_register:byId(), invoices:byId(), billing_settings:singleton, accounting_services:byId(),
  petshop_campaign_logs:byId(), petshop_growth_booking_settings:singleton, petshop_growth_booking_requests:byId(),
  petshop_growth_leads:byId(), petshop_growth_no_show_events:byId(), petshop_growth_no_show_policy:singleton,
  petshop_growth_report_cards:byId(), support_threads:byId(), support_messages:byId(false),
  tenant_ai_usage_monthly:{ module:true, order:'tenant_id.asc,module_id.asc,period_month.asc' },
})

const DESTINATION_TABLES = Object.freeze([
  'catalog_products','services','inventory_balances','inventory_movements',
  'module_operational_settings','module_settings_extensions','booking_hours','payment_method_settings',
  'appointments','appointment_services','transport_options','appointment_transport',
  'sales','sale_items','payments','payment_splits','chat_threads','chat_messages','fiscal_documents',
  'subscription_plans','client_subscriptions','subscription_benefit_allocations',
  'loyalty_settings','loyalty_points','commission_rules','cash_register','invoices','billing_settings','accounting_services',
  'petshop_campaign_logs','petshop_growth_booking_settings','petshop_growth_booking_requests','petshop_growth_leads',
  'petshop_growth_no_show_events','petshop_growth_no_show_policy','petshop_growth_report_cards',
  'support_threads','support_messages','tenant_ai_usage_monthly',
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

async function readSupabaseTable({ baseUrl, key, accessToken, table, config, scope, fetcher }) {
  const rows = []; const opaque = key.startsWith('sb_secret_')
  for (let page=0; page<MAX_PAGES; page+=1) {
    const url = new URL(`/rest/v1/${table}`, baseUrl)
    url.searchParams.set('select','*')
    url.searchParams.set('tenant_id',`eq.${scope.tenant_id}`)
    if (config.module) url.searchParams.set('module_id',`eq.${scope.module_id}`)
    url.searchParams.set('order',config.order || 'id.asc')
    const headers = { accept:'application/json', apikey:key, range:`${page*PAGE_SIZE}-${page*PAGE_SIZE+PAGE_SIZE-1}` }
    if (accessToken) headers.authorization = `Bearer ${accessToken}`
    else if (!opaque) headers.authorization = `Bearer ${key}`
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

export async function extractSupabaseOperationalSnapshot({ supabaseUrl, apiKey, adminApiKey, accessToken, scope: rawScope, fetcher=fetch } = {}) {
  const scope = scopeOf(rawScope)
  const key = String(apiKey || adminApiKey || '').trim()
  const token = String(accessToken || '').trim()
  if (!key || /\s/.test(key) || key.length > 8192) throw new OperationalExtractorError('INVALID_SUPABASE_API_KEY')
  if (token && (/\s/.test(token) || token.length > 16384)) throw new OperationalExtractorError('INVALID_SUPABASE_ACCESS_TOKEN')
  const baseUrl = supabaseBase(supabaseUrl)
  const tables = {}
  for (const [table,config] of Object.entries(SOURCE_TABLES)) {
    tables[table] = await readSupabaseTable({ baseUrl,key,accessToken:token,table,config,scope,fetcher })
  }
  return projectLegacyCanonicalSnapshot({ tables }, { tenantId:scope.tenant_id, moduleId:scope.module_id })
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
  return Object.freeze({
    projection:`${LEGACY_CANONICAL_PROJECTION.name}/${LEGACY_CANONICAL_PROJECTION.version}`,
    source:'d1',scope,collections,
    transient_policy:{ collections:['financial_effects','operation_checkpoints','operation_effects','effect_outbox'], strategy:'start_clean_after_freeze_and_drain' },
  })
}

export { SOURCE_TABLES, DESTINATION_TABLES }
