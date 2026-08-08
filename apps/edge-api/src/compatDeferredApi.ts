import { getBetterAuthSession } from './auth/betterAuthRuntime'
import type { CompatRuntimeBindings } from './compatApiRuntime.js'

type Bindings = CompatRuntimeBindings
type Scope = {
  tenantId: string
  moduleId: string
  principalId: string
  userId: string
  tenantAdmin: boolean
  globalAdmin: boolean
}

type TableConfig = {
  source: string
  readOnly?: boolean
  shared?: boolean
  global?: boolean
  columns: readonly string[]
  json?: readonly string[]
  bool?: readonly string[]
  fieldMap?: Record<string, string>
}

const ID = /^[A-Za-z0-9_:.@/+\-=]{1,200}$/
const MODULE = /^[a-z0-9_-]{1,80}$/
const COL = /^[a-z_][a-z0-9_]*$/i

const DEFERRED_TABLES: Readonly<Record<string, TableConfig>> = Object.freeze({
  fiscal_policy_versions: {
    source: 'fiscal_policy_versions',
    global: true,
    columns: ['id','module_id','version_label','status','effective_from_ms','notes','rules_json','created_by','created_at_ms','updated_at_ms'],
    fieldMap: { effective_from: 'effective_from_ms', rules: 'rules_json', created_at: 'created_at_ms', updated_at: 'updated_at_ms' },
    json: ['rules_json'],
  },
  petshop_growth_exec_daily: {
    source: 'petshop_growth_exec_daily',
    readOnly: true,
    columns: ['tenant_id','module_id','ref_date','total_sales','total_revenue','new_leads','leads_won','bookings_created','bookings_scheduled','no_show_count','report_cards_sent'],
  },
  petshop_growth_portal_access: {
    source: 'petshop_growth_portal_access',
    columns: ['id','tenant_id','module_id','client_id','portal_token','status','invited_at','last_access_at','expires_at','created_by','created_at','updated_at'],
  },
  platform_plan_catalog: {
    source: 'platform_plan_catalog',
    global: true,
    columns: ['id','name','subtitle','monthly_price','yearly_price','currency','features','limits','badge','highlighted','active','sort_order','metadata','created_by','created_at_ms','updated_at_ms','status','entitlements_json','price_cents'],
    json: ['features','limits','metadata'],
    bool: ['highlighted','active'],
    fieldMap: { created_at: 'created_at_ms', updated_at: 'updated_at_ms' },
  },
  profiles: {
    source: 'profiles',
    global: true,
    readOnly: true,
    columns: ['id','full_name','email','role','active','allowed_modules','module_permissions','avatar_url','created_at','updated_at'],
    json: ['allowed_modules','module_permissions'],
    bool: ['active'],
  },
  quick_replies: {
    source: 'quick_replies',
    shared: true,
    readOnly: true,
    columns: ['id','category','title','text','active','created_at'],
    bool: ['active'],
  },
  system_update_logs: {
    source: 'system_update_logs',
    global: true,
    columns: ['id','tenant_id','module_id','category','status','source','title','description','metadata','fingerprint','created_by','created_at'],
    json: ['metadata'],
  },
  tenant_governance_alerts: {
    source: 'tenant_governance_alerts',
    global: true,
    columns: ['id','tenant_id','module_id','alert_type','severity','status','title','description','payload','fingerprint','acknowledged_by','acknowledged_at','resolved_at','created_at','updated_at'],
    json: ['payload'],
  },
  tenant_onboarding: {
    source: 'tenant_onboarding',
    global: true,
    columns: ['tenant_id','module_id','status','stage','progress','checklist','owner_profile_id','updated_by','started_at','completed_at','updated_at'],
    json: ['checklist'],
  },
  tenant_subscriptions: {
    source: 'tenant_subscriptions',
    global: true,
    columns: ['tenant_id','module_id','id','plan_id','status','started_at_ms','expires_at_ms','data_json','updated_at_ms','billing_cycle','contracted_price','currency','trial_ends_at','current_period_start','next_billing_at','auto_charge_enabled','payment_provider','provider_customer_id','provider_subscription_id','notes','managed_by'],
    json: ['data_json'],
    bool: ['auto_charge_enabled'],
    fieldMap: { created_at: 'started_at_ms', updated_at: 'updated_at_ms' },
  },
  tenants: {
    source: 'tenants',
    global: true,
    readOnly: true,
    columns: ['id','slug','name','status','created_at_ms','updated_at_ms'],
    fieldMap: { active: 'status', created_at: 'created_at_ms', updated_at: 'updated_at_ms' },
  },
})

const DEFERRED_RPCS = new Set([
  'create_petshop_booking_request',
  'get_petshop_portal_snapshot',
  'queue_fiscal_document_for_sale',
  'sync_all_tenant_fiscal_profiles',
  'yui_refresh_governance_alerts',
])

function response(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: { 'cache-control': 'no-store' } })
}

function text(value: unknown): string {
  return value == null ? '' : String(value).trim()
}

function object(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, any>
    : {}
}

function parseJson(value: unknown, fallback: unknown) {
  if (value == null || value === '') return fallback
  if (typeof value === 'object') return value
  try { return JSON.parse(String(value)) } catch { return fallback }
}

function isoFromMs(value: unknown): string | null {
  const ms = Number(value)
  return Number.isFinite(ms) && ms > 0 ? new Date(ms).toISOString() : null
}

function epoch(value: unknown, fallback = Date.now()): number {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value)
  const ms = Date.parse(String(value || ''))
  return Number.isFinite(ms) ? ms : fallback
}

function uuid(): string {
  return crypto.randomUUID()
}

function boolInt(value: unknown): number {
  return value === true || value === 1 || value === '1' || value === 'true' ? 1 : 0
}

function jsonString(value: unknown, fallback: unknown): string {
  return JSON.stringify(value == null ? fallback : value)
}

async function resolveScope(
  request: Request,
  env: Bindings,
): Promise<{ scope?: Scope; error?: Response }> {
  if (!env.DB) return { error: response({ code: 'DATABASE_NOT_CONFIGURED' }, 503) }

  const tenantId = text(request.headers.get('x-tenant-id'))
  const moduleId = text(request.headers.get('x-module-id')).toLowerCase()
  if (!ID.test(tenantId) || !MODULE.test(moduleId)) {
    return { error: response({ code: 'INVALID_SCOPE' }, 400) }
  }

  const session = await getBetterAuthSession(request, env)
  const userId = text(session?.user?.id)
  if (!userId) return { error: response({ code: 'UNAUTHENTICATED' }, 401) }

  const principal = await env.DB
    .prepare("SELECT id,email FROM identity_principals WHERE provider='better-auth' AND subject=?1 AND status='active' LIMIT 1")
    .bind(userId)
    .first<{ id: string; email: string | null }>()
  if (!principal?.id) return { error: response({ code: 'FORBIDDEN' }, 403) }

  const membership = await env.DB
    .prepare("SELECT role,module_permissions_json FROM tenant_memberships WHERE tenant_id=?1 AND principal_id=?2 AND status='active' LIMIT 1")
    .bind(tenantId, principal.id)
    .first<{ role: string; module_permissions_json: string }>()
  if (!membership) return { error: response({ code: 'FORBIDDEN' }, 403) }

  const tenantAdmin = membership.role === 'owner' || membership.role === 'admin'
  let allowed = tenantAdmin
  try {
    const permissions = object(JSON.parse(membership.module_permissions_json || '{}'))
    allowed ||= permissions['*'] === true
      || permissions[moduleId] === true
      || Boolean(permissions[moduleId] && typeof permissions[moduleId] === 'object')
  } catch {}
  if (!allowed) return { error: response({ code: 'FORBIDDEN' }, 403) }

  let globalAdmin = false
  try {
    const profile = await env.DB
      .prepare("SELECT role FROM profiles WHERE active=1 AND (id=?1 OR (email IS NOT NULL AND lower(email)=lower(?2))) LIMIT 1")
      .bind(principal.id, principal.email || '')
      .first<{ role: string }>()
    globalAdmin = profile?.role === 'admin'
  } catch {}

  return {
    scope: {
      tenantId,
      moduleId,
      principalId: String(principal.id),
      userId,
      tenantAdmin,
      globalAdmin,
    },
  }
}

function mappedColumn(config: TableConfig, name: unknown): string {
  const requested = text(name)
  const mapped = config.fieldMap?.[requested] || requested
  if (!COL.test(mapped) || !config.columns.includes(mapped)) throw new Error('INVALID_COLUMN')
  return mapped
}

function filterValue(table: string, requested: string, column: string, value: unknown): unknown {
  if (table === 'tenants' && requested === 'active') {
    return value === false || value === 0 || value === 'false' ? 'inactive' : 'active'
  }
  if (column.endsWith('_ms')) return epoch(value)
  return value
}

function buildWhere(
  table: string,
  config: TableConfig,
  body: Record<string, any>,
  scope: Scope,
) {
  const clauses: string[] = []
  const values: unknown[] = []
  const scoped = !config.shared && (!config.global || !scope.globalAdmin)

  if (table === 'tenants' && !scope.globalAdmin) {
    clauses.push('id=?')
    values.push(scope.tenantId)
  } else {
    if (scoped && config.columns.includes('tenant_id')) {
      clauses.push('tenant_id=?')
      values.push(scope.tenantId)
    }
    if (scoped && config.columns.includes('module_id')) {
      clauses.push('module_id=?')
      values.push(scope.moduleId)
    }
  }

  for (const raw of Array.isArray(body.filters) ? body.filters : []) {
    const f = object(raw)
    const requested = text(f.column)
    const column = mappedColumn(config, requested)
    const value = filterValue(table, requested, column, f.value)

    if (f.op === 'eq') {
      clauses.push(`${column}=?`)
      values.push(value)
    } else if (f.op === 'neq') {
      clauses.push(`${column}<>?`)
      values.push(value)
    } else if (f.op === 'gt' || f.op === 'gte' || f.op === 'lt' || f.op === 'lte') {
      const op = ({ gt: '>', gte: '>=', lt: '<', lte: '<=' } as const)[f.op as 'gt'|'gte'|'lt'|'lte']
      clauses.push(`${column}${op}?`)
      values.push(value)
    } else if (f.op === 'in') {
      const list = Array.isArray(f.value) ? f.value : []
      if (!list.length) clauses.push('1=0')
      else {
        clauses.push(`${column} IN (${list.map(() => '?').join(',')})`)
        values.push(...list)
      }
    } else if (f.op === 'is' && f.value == null) {
      clauses.push(`${column} IS NULL`)
    } else if (f.op === 'ilike') {
      clauses.push(`lower(CAST(${column} AS TEXT)) LIKE lower(?)`)
      values.push(value)
    }
  }

  return { sql: clauses.length ? clauses.join(' AND ') : '1=1', values }
}

function normalizeRow(table: string, row: Record<string, any>) {
  const config = DEFERRED_TABLES[table]
  const out: Record<string, any> = { ...row }

  for (const field of config.json || []) {
    out[field.replace(/_json$/, '')] = parseJson(
      row[field],
      field.includes('features') || field.includes('modules') ? [] : {},
    )
  }
  for (const field of config.bool || []) out[field] = Boolean(row[field])

  if (table === 'fiscal_policy_versions') {
    out.effective_from = isoFromMs(row.effective_from_ms)
    out.rules = parseJson(row.rules_json, {})
    out.created_at = isoFromMs(row.created_at_ms)
    out.updated_at = isoFromMs(row.updated_at_ms)
  }

  if (table === 'platform_plan_catalog') {
    out.features = parseJson(row.features, [])
    out.limits = parseJson(row.limits, {})
    out.metadata = parseJson(row.metadata, {})
    out.created_at = isoFromMs(row.created_at_ms)
    out.updated_at = isoFromMs(row.updated_at_ms)
  }

  if (table === 'tenant_subscriptions') {
    const data = parseJson(row.data_json, {}) as Record<string, any>
    out.status = data.compat_status
      || ({ trial: 'trialing', cancelled: 'canceled' } as Record<string,string>)[row.status]
      || row.status
    out.created_at = isoFromMs(row.started_at_ms)
    out.updated_at = isoFromMs(row.updated_at_ms)
  }

  if (table === 'tenants') {
    out.active = row.status === 'active'
    out.created_at = isoFromMs(row.created_at_ms)
    out.updated_at = isoFromMs(row.updated_at_ms)
  }

  return out
}

async function selectRows(
  env: Bindings,
  table: string,
  config: TableConfig,
  body: Record<string, any>,
  scope: Scope,
) {
  const where = buildWhere(table, config, body, scope)
  let sql = `SELECT * FROM ${config.source} WHERE ${where.sql}`
  const orders = Array.isArray(body.orders) ? body.orders : []

  if (orders.length) {
    sql += ' ORDER BY ' + orders
      .map((raw: unknown) => {
        const order = object(raw)
        return `${mappedColumn(config, order.column)} ${order.ascending === false ? 'DESC' : 'ASC'}`
      })
      .join(',')
  }

  const range = object(body.range)
  const from = Number.isFinite(Number(range.from)) ? Math.max(0, Number(range.from)) : null
  const to = Number.isFinite(Number(range.to)) ? Math.max(0, Number(range.to)) : null
  const limit = from != null && to != null
    ? Math.max(0, to - from + 1)
    : Math.max(0, Number(body.limit || 0))

  if (limit > 0) {
    sql += ' LIMIT ?'
    where.values.push(limit)
    if (from != null) {
      sql += ' OFFSET ?'
      where.values.push(from)
    }
  }

  const result = await env.DB!
    .prepare(sql)
    .bind(...where.values)
    .all<Record<string, any>>()
  const rows = result.results.map((row) => normalizeRow(table, row))

  if (table === 'petshop_growth_portal_access' && rows.length) {
    for (const row of rows) {
      const client = await env.DB!
        .prepare('SELECT id,name,phone FROM clients WHERE tenant_id=?1 AND module_id=?2 AND id=?3 LIMIT 1')
        .bind(row.tenant_id, row.module_id, row.client_id)
        .first<{ id: string; name: string; phone: string | null }>()
      if (client) {
        const pet = await env.DB!
          .prepare("SELECT name FROM pets WHERE tenant_id=?1 AND module_id=?2 AND client_id=?3 AND status='active' ORDER BY created_at_ms,id LIMIT 1")
          .bind(row.tenant_id, row.module_id, row.client_id)
          .first<{ name: string }>()
        row.clients = {
          id: client.id,
          name: client.name,
          phone: client.phone,
          details: { pet_name: pet?.name || '' },
        }
      }
    }
  }

  const mode = text(body.mode)
  if (mode === 'single') {
    if (rows.length !== 1) {
      return response({ code: rows.length ? 'MULTIPLE_ROWS' : 'NOT_FOUND' }, rows.length ? 409 : 404)
    }
    return response({ data: rows[0], count: body.count ? rows.length : null })
  }
  if (mode === 'maybeSingle') {
    if (rows.length > 1) return response({ code: 'MULTIPLE_ROWS' }, 409)
    return response({ data: rows[0] || null, count: body.count ? rows.length : null })
  }
  return response({ data: rows, count: body.count ? rows.length : null })
}

function writableValue(
  config: TableConfig,
  key: string,
  value: unknown,
): [string, unknown] | null {
  const column = config.fieldMap?.[key] || key
  if (!COL.test(column) || !config.columns.includes(column)) return null
  if ((config.json || []).includes(column)) {
    return [column, jsonString(value, column.includes('features') || column.includes('modules') ? [] : {})]
  }
  if ((config.bool || []).includes(column)) return [column, boolInt(value)]
  if (column.endsWith('_ms')) return [column, epoch(value)]
  return [column, value]
}

function prepareRow(
  table: string,
  config: TableConfig,
  raw: unknown,
  scope: Scope,
) {
  const input = object(raw)
  const out: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(input)) {
    const pair = writableValue(config, key, value)
    if (pair) out[pair[0]] = pair[1]
  }

  if (!config.shared && config.columns.includes('tenant_id')) {
    out.tenant_id = scope.globalAdmin && text(input.tenant_id)
      ? text(input.tenant_id)
      : scope.tenantId
  }
  if (!config.shared && config.columns.includes('module_id')) {
    out.module_id = text(input.module_id) || scope.moduleId
  }

  const now = Date.now()
  const nowIso = new Date(now).toISOString()
  if (config.columns.includes('id') && !out.id) out.id = uuid()
  if (config.columns.includes('created_at') && !out.created_at) out.created_at = nowIso
  if (config.columns.includes('updated_at') && !out.updated_at) out.updated_at = nowIso
  if (config.columns.includes('created_at_ms') && !out.created_at_ms) out.created_at_ms = now
  if (config.columns.includes('updated_at_ms')) out.updated_at_ms = now

  if (table === 'platform_plan_catalog') {
    out.status = boolInt(input.active ?? true) ? 'active' : 'inactive'
    out.price_cents = Math.round(Number(input.monthly_price || 0) * 100)
    out.entitlements_json = jsonString(input.features, [])
  }

  if (table === 'tenant_subscriptions') {
    const compatStatus = text(input.status) || 'active'
    out.status = ({
      trialing: 'trial',
      canceled: 'cancelled',
      paused: 'active',
    } as Record<string,string>)[compatStatus] || compatStatus
    const old = parseJson(out.data_json, {}) as Record<string,any>
    out.data_json = JSON.stringify({ ...old, compat_status: compatStatus })
    if (!out.started_at_ms) out.started_at_ms = now
  }

  if (table === 'fiscal_policy_versions' && !out.effective_from_ms) {
    out.effective_from_ms = now
  }

  return out
}

async function insertRow(
  db: D1Database,
  source: string,
  row: Record<string, unknown>,
) {
  const keys = Object.keys(row)
  if (!keys.length) throw new Error('EMPTY_PAYLOAD')
  await db
    .prepare(`INSERT INTO ${source}(${keys.join(',')}) VALUES(${keys.map(() => '?').join(',')})`)
    .bind(...keys.map((key) => row[key]))
    .run()
}

async function mutateRows(
  env: Bindings,
  table: string,
  config: TableConfig,
  body: Record<string, any>,
  scope: Scope,
) {
  if (config.readOnly) return response({ code: 'WRITE_NOT_SUPPORTED' }, 405)

  const centralWrite = [
    'platform_plan_catalog',
    'fiscal_policy_versions',
    'tenant_governance_alerts',
  ].includes(table)
  if (centralWrite && !scope.globalAdmin) return response({ code: 'FORBIDDEN' }, 403)
  if (!scope.tenantAdmin && !scope.globalAdmin) return response({ code: 'FORBIDDEN' }, 403)

  const action = text(body.action)
  const where = buildWhere(table, config, body, scope)

  if (action === 'delete') {
    await env.DB!
      .prepare(`DELETE FROM ${config.source} WHERE ${where.sql}`)
      .bind(...where.values)
      .run()
    return response({ data: null })
  }

  const payloads = Array.isArray(body.payload) ? body.payload : [body.payload]

  if (action === 'update') {
    for (const raw of payloads) {
      const row = prepareRow(table, config, raw, scope)
      delete row.id
      delete row.tenant_id
      delete row.module_id
      delete row.created_at
      delete row.created_at_ms
      const keys = Object.keys(row)
      if (!keys.length) continue
      await env.DB!
        .prepare(`UPDATE ${config.source} SET ${keys.map((key) => `${key}=?`).join(',')} WHERE ${where.sql}`)
        .bind(...keys.map((key) => row[key]), ...where.values)
        .run()
    }
  } else if (action === 'insert') {
    for (const raw of payloads) {
      await insertRow(env.DB!, config.source, prepareRow(table, config, raw, scope))
    }
  } else if (action === 'upsert') {
    for (const raw of payloads) {
      const row = prepareRow(table, config, raw, scope)
      const conflict = text(body.conflict)

      if (table === 'tenant_subscriptions' || conflict === 'tenant_id,module_id') {
        const existing = await env.DB!
          .prepare(`SELECT id FROM ${config.source} WHERE tenant_id=?1 AND module_id=?2 LIMIT 1`)
          .bind(row.tenant_id, row.module_id)
          .first<{ id?: string }>()
        if (existing) {
          const keys = Object.keys(row).filter((key) => !['tenant_id','module_id','id','created_at','created_at_ms'].includes(key))
          await env.DB!
            .prepare(`UPDATE ${config.source} SET ${keys.map((key) => `${key}=?`).join(',')} WHERE tenant_id=? AND module_id=?`)
            .bind(...keys.map((key) => row[key]), row.tenant_id, row.module_id)
            .run()
        } else {
          await insertRow(env.DB!, config.source, row)
        }
      } else if (table === 'petshop_growth_portal_access') {
        const existing = await env.DB!
          .prepare(`SELECT id FROM ${config.source} WHERE tenant_id=?1 AND module_id=?2 AND client_id=?3 LIMIT 1`)
          .bind(row.tenant_id, row.module_id, row.client_id)
          .first<{ id: string }>()
        if (existing) {
          const keys = Object.keys(row).filter((key) => !['id','tenant_id','module_id','client_id','created_at'].includes(key))
          await env.DB!
            .prepare(`UPDATE ${config.source} SET ${keys.map((key) => `${key}=?`).join(',')} WHERE id=?`)
            .bind(...keys.map((key) => row[key]), existing.id)
            .run()
        } else {
          await insertRow(env.DB!, config.source, row)
        }
      } else {
        const id = text(row.id)
        const existing = id
          ? await env.DB!.prepare(`SELECT 1 ok FROM ${config.source} WHERE id=?1 LIMIT 1`).bind(id).first()
          : null
        if (existing) {
          const keys = Object.keys(row).filter((key) => !['id','created_at','created_at_ms'].includes(key))
          await env.DB!
            .prepare(`UPDATE ${config.source} SET ${keys.map((key) => `${key}=?`).join(',')} WHERE id=?`)
            .bind(...keys.map((key) => row[key]), id)
            .run()
        } else {
          await insertRow(env.DB!, config.source, row)
        }
      }
    }
  } else {
    return response({ code: 'INVALID_ACTION' }, 400)
  }

  if (body.returning) return selectRows(env, table, config, { ...body, action: 'select' }, scope)
  return response({ data: null })
}

async function deferredQuery(
  request: Request,
  env: Bindings,
  body: Record<string, any>,
) {
  const table = text(body.table)
  const config = DEFERRED_TABLES[table]
  if (!config) return null

  const auth = await resolveScope(request, env)
  if (auth.error) return auth.error
  const scope = auth.scope!

  if (table === 'profiles' && !scope.globalAdmin) {
    return response({ code: 'FORBIDDEN' }, 403)
  }

  if (text(body.action || 'select') === 'select') {
    try {
      return await selectRows(env, table, config, body, scope)
    } catch (error) {
      return response({
        code: 'COMPAT_QUERY_FAILED',
        message: error instanceof Error ? error.message : 'query failed',
      }, 400)
    }
  }

  try {
    return await mutateRows(env, table, config, body, scope)
  } catch (error) {
    return response({
      code: 'COMPAT_WRITE_FAILED',
      message: error instanceof Error ? error.message : 'write failed',
    }, 409)
  }
}

async function sha256Hex(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return [...new Uint8Array(bytes)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

async function createBooking(env: Bindings, args: Record<string, any>) {
  if (!env.DB) return response({ code: 'DATABASE_NOT_CONFIGURED' }, 503)

  const slug = text(args.p_slug)
  const customerName = text(args.p_customer_name)
  if (!slug || !customerName) return response({ code: 'INVALID_BOOKING_REQUEST' }, 400)

  const setting = await env.DB
    .prepare(`SELECT tenant_id,module_id,enabled FROM petshop_growth_booking_settings WHERE public_slug=?1 LIMIT 1`)
    .bind(slug)
    .first<{ tenant_id: string; module_id: string; enabled: number }>()
  if (!setting) {
    return response({ code: 'BOOKING_LINK_NOT_FOUND', message: 'Link de agendamento nao encontrado.' }, 404)
  }
  if (!setting.enabled) {
    return response({ code: 'BOOKING_DISABLED', message: 'Agendamento online indisponivel no momento.' }, 409)
  }

  const now = Date.now()
  const id = uuid()
  const needMotodog = boolInt(args.p_need_motodog)
  let fee = 0
  if (needMotodog) {
    const option = await env.DB
      .prepare(`SELECT fee_cents FROM transport_options WHERE tenant_id=?1 AND module_id=?2 AND status='active' AND pickup_required=1 ORDER BY sort_order,id LIMIT 1`)
      .bind(setting.tenant_id, setting.module_id)
      .first<{ fee_cents: number }>()
    fee = Number(option?.fee_cents || 0)
  }

  await env.DB
    .prepare(`INSERT INTO petshop_growth_booking_requests(
      tenant_id,module_id,id,channel,customer_name,pet_name,phone,service_interest,preferred_date,preferred_period,
      transport_mode,need_motodog,motodog_fee_cents,pickup_address,pickup_neighborhood,pickup_city,status,notes,created_at_ms,updated_at_ms
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .bind(
      setting.tenant_id,
      setting.module_id,
      id,
      text(args.p_channel) || 'site',
      customerName,
      text(args.p_pet_name) || null,
      text(args.p_phone) || null,
      text(args.p_service_interest) || null,
      text(args.p_preferred_date) || null,
      text(args.p_preferred_period) || null,
      text(args.p_transport_mode) || 'dropoff',
      needMotodog,
      fee,
      text(args.p_pickup_address) || null,
      text(args.p_pickup_neighborhood) || null,
      text(args.p_pickup_city) || null,
      'pending',
      text(args.p_notes) || null,
      now,
      now,
    )
    .run()

  return response({ data: id })
}

async function portalSnapshot(env: Bindings, args: Record<string, any>) {
  if (!env.DB) return response({ code: 'DATABASE_NOT_CONFIGURED' }, 503)

  const token = text(args.p_token)
  if (!token) return response({ code: 'PORTAL_NOT_FOUND' }, 404)

  const access = await env.DB
    .prepare(`SELECT * FROM petshop_growth_portal_access WHERE portal_token=?1 LIMIT 1`)
    .bind(token)
    .first<Record<string,any>>()
  if (!access) return response({ code: 'PORTAL_NOT_FOUND', message: 'Portal nao encontrado.' }, 404)
  if (access.status !== 'active') {
    return response({ code: 'PORTAL_DISABLED', message: 'Portal indisponivel no momento.' }, 409)
  }
  if (access.expires_at && Date.parse(access.expires_at) < Date.now()) {
    return response({ code: 'PORTAL_EXPIRED', message: 'Portal expirado.' }, 410)
  }

  const nowIso = new Date().toISOString()
  await env.DB
    .prepare(`UPDATE petshop_growth_portal_access SET last_access_at=?1,updated_at=?1 WHERE id=?2`)
    .bind(nowIso, access.id)
    .run()

  const client = await env.DB
    .prepare(`SELECT id,name,phone,email FROM clients WHERE tenant_id=?1 AND module_id=?2 AND id=?3 LIMIT 1`)
    .bind(access.tenant_id, access.module_id, access.client_id)
    .first<Record<string,any>>()
  const pet = await env.DB
    .prepare(`SELECT name FROM pets WHERE tenant_id=?1 AND module_id=?2 AND client_id=?3 AND status='active' ORDER BY created_at_ms,id LIMIT 1`)
    .bind(access.tenant_id, access.module_id, access.client_id)
    .first<{ name: string }>()

  const appointments = await env.DB
    .prepare(`SELECT id,scheduled_at_ms,status,service_group FROM appointments WHERE tenant_id=?1 AND module_id=?2 AND client_id=?3 AND scheduled_at_ms>=?4 AND status NOT IN ('cancelled','canceled') ORDER BY scheduled_at_ms LIMIT 5`)
    .bind(access.tenant_id, access.module_id, access.client_id, Date.now())
    .all<Record<string,any>>()

  const nextAppointments: Record<string, unknown>[] = []
  for (const appointment of appointments.results) {
    const service = await env.DB
      .prepare(`SELECT service_name FROM appointment_services WHERE tenant_id=?1 AND module_id=?2 AND appointment_id=?3 ORDER BY position LIMIT 1`)
      .bind(access.tenant_id, access.module_id, appointment.id)
      .first<{ service_name: string }>()
    nextAppointments.push({
      scheduled_at: isoFromMs(appointment.scheduled_at_ms),
      service_type: service?.service_name || appointment.service_group || '',
      status: appointment.status,
    })
  }

  const loyalty = await env.DB
    .prepare(`SELECT balance_after FROM loyalty_points WHERE tenant_id=?1 AND module_id=?2 AND client_id=?3 ORDER BY created_at_ms DESC,id DESC LIMIT 1`)
    .bind(access.tenant_id, access.module_id, access.client_id)
    .first<{ balance_after: number }>()

  return response({
    data: {
      tenant_id: access.tenant_id,
      module_id: access.module_id,
      client_id: access.client_id,
      owner_name: client?.name || '',
      pet_name: pet?.name || '',
      phone: client?.phone || '',
      email: client?.email || '',
      next_appointments: nextAppointments,
      loyalty_balance: Number(loyalty?.balance_after || 0),
    },
  })
}

async function queueFiscal(
  env: Bindings,
  scope: Scope,
  args: Record<string, any>,
) {
  const saleId = text(args.p_sale_id)
  if (!saleId) return response({ code: 'SALE_ID_REQUIRED' }, 400)

  const sale = await env.DB!
    .prepare(`SELECT id,total_cents,status FROM sales WHERE tenant_id=?1 AND module_id=?2 AND id=?3 LIMIT 1`)
    .bind(scope.tenantId, scope.moduleId, saleId)
    .first<Record<string,any>>()
  if (!sale) return response({ code: 'SALE_NOT_FOUND' }, 404)

  const operationKey = `fiscal:${saleId}`
  const existing = await env.DB!
    .prepare(`SELECT id FROM fiscal_documents WHERE tenant_id=?1 AND module_id=?2 AND operation_key=?3 LIMIT 1`)
    .bind(scope.tenantId, scope.moduleId, operationKey)
    .first<{ id: string }>()
  if (existing) return response({ data: existing.id })

  const now = Date.now()
  const id = uuid()
  const outboxId = uuid()
  const requestHash = await sha256Hex(`${scope.tenantId}:${scope.moduleId}:${saleId}:${sale.total_cents}`)
  const profile = await env.DB!
    .prepare(`SELECT emit_nfce,emit_nfe,emit_nfse FROM tenant_fiscal_profiles WHERE tenant_id=?1 AND module_id=?2 LIMIT 1`)
    .bind(scope.tenantId, scope.moduleId)
    .first<Record<string,any>>()
  const documentType = profile?.emit_nfce
    ? 'nfce'
    : profile?.emit_nfe
      ? 'nfe'
      : profile?.emit_nfse
        ? 'nfse'
        : 'nfce'

  await env.DB!.batch([
    env.DB!
      .prepare(`INSERT INTO fiscal_documents(tenant_id,module_id,id,sale_id,operation_key,document_type,status,request_hash,created_at_ms,updated_at_ms) VALUES(?,?,?,?,?,?,'queued',?,?,?)`)
      .bind(scope.tenantId, scope.moduleId, id, saleId, operationKey, documentType, requestHash, now, now),
    env.DB!
      .prepare(`INSERT INTO effect_outbox(tenant_id,module_id,id,operation_key,aggregate_type,aggregate_id,event_type,payload_json,status,attempt_count,available_at_ms,created_at_ms,updated_at_ms) VALUES(?,?,?,?,?,?,?,?,'pending',0,?,?,?)`)
      .bind(
        scope.tenantId,
        scope.moduleId,
        outboxId,
        operationKey,
        'fiscal_document',
        id,
        'fiscal.document.queued',
        JSON.stringify({ fiscal_document_id: id, sale_id: saleId }),
        now,
        now,
        now,
      ),
  ])

  return response({ data: id })
}

async function syncFiscalProfiles(
  env: Bindings,
  scope: Scope,
  args: Record<string, any>,
) {
  if (!scope.globalAdmin) return response({ code: 'FORBIDDEN' }, 403)

  const moduleId = text(args.p_module_id) || scope.moduleId
  const policy = await env.DB!
    .prepare(`SELECT id FROM fiscal_policy_versions WHERE module_id=?1 AND status='active' ORDER BY effective_from_ms DESC LIMIT 1`)
    .bind(moduleId)
    .first<{ id: string }>()
  if (!policy) return response({ data: 0 })

  const tenants = await env.DB!
    .prepare(`SELECT id FROM tenants WHERE status='active'`)
    .all<{ id: string }>()
  let count = 0
  const now = Date.now()

  for (const tenant of tenants.results) {
    await env.DB!
      .prepare(`INSERT OR IGNORE INTO tenant_fiscal_profiles(tenant_id,module_id,policy_version_id,mode,auto_update,nfe_environment,issue_series,next_invoice_number,emit_nfce,emit_nfe,emit_nfse,settings_json,updated_at_ms) VALUES(?,?,?,'manual',0,'homologacao',1,1,0,0,0,'{}',?)`)
      .bind(tenant.id, moduleId, policy.id, now)
      .run()
    await env.DB!
      .prepare(`UPDATE tenant_fiscal_profiles SET policy_version_id=?1,updated_at_ms=?2 WHERE tenant_id=?3 AND module_id=?4`)
      .bind(policy.id, now, tenant.id, moduleId)
      .run()
    count += 1
  }

  return response({ data: count })
}

async function upsertAlert(db: D1Database, input: Record<string,any>) {
  const existing = await db
    .prepare(`SELECT id FROM tenant_governance_alerts WHERE fingerprint=?1 LIMIT 1`)
    .bind(input.fingerprint)
    .first<{ id: string }>()
  const payload = JSON.stringify(input.payload || {})

  if (existing) {
    await db
      .prepare(`UPDATE tenant_governance_alerts SET severity=?1,status='open',title=?2,description=?3,payload=?4,resolved_at=NULL,updated_at=?5 WHERE id=?6`)
      .bind(input.severity, input.title, input.description, payload, input.nowIso, existing.id)
      .run()
  } else {
    await db
      .prepare(`INSERT INTO tenant_governance_alerts(id,tenant_id,module_id,alert_type,severity,status,title,description,payload,fingerprint,created_at,updated_at) VALUES(?,?,?,?,?,'open',?,?,?,?,?,?)`)
      .bind(
        uuid(),
        input.tenant_id,
        input.module_id,
        input.alert_type,
        input.severity,
        input.title,
        input.description,
        payload,
        input.fingerprint,
        input.nowIso,
        input.nowIso,
      )
      .run()
  }
}

async function refreshGovernance(
  env: Bindings,
  scope: Scope,
  args: Record<string, any>,
) {
  if (!scope.globalAdmin) return response({ code: 'FORBIDDEN' }, 403)

  const moduleId = text(args.p_module_id) || scope.moduleId
  const today = new Date().toISOString().slice(0, 10)
  const month = today.slice(0, 7)
  const nowIso = new Date().toISOString()
  const subscriptions = await env.DB!
    .prepare(`SELECT * FROM tenant_subscriptions WHERE module_id=?1`)
    .bind(moduleId)
    .all<Record<string,any>>()
  const activeFingerprints = new Set<string>()

  for (const subscription of subscriptions.results) {
    const data = parseJson(subscription.data_json, {}) as Record<string,any>
    const compatStatus = data.compat_status || subscription.status
    if (!['active','trial','trialing','past_due'].includes(compatStatus)) continue

    if (
      subscription.next_billing_at
      && subscription.next_billing_at <= new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10)
    ) {
      const fingerprint = `billing_due:${subscription.tenant_id}:${moduleId}:${subscription.next_billing_at}`
      activeFingerprints.add(fingerprint)
      const severity = subscription.next_billing_at < today ? 'critical' : 'warning'
      await upsertAlert(env.DB!, {
        tenant_id: subscription.tenant_id,
        module_id: moduleId,
        alert_type: 'billing_due',
        severity,
        title: severity === 'critical' ? 'Cobranca em atraso' : 'Cobranca proxima',
        description: `Assinatura ${subscription.plan_id} com proxima cobranca em ${subscription.next_billing_at}.`,
        payload: {
          next_billing_at: subscription.next_billing_at,
          status: compatStatus,
          plan_id: subscription.plan_id,
        },
        fingerprint,
        nowIso,
      })
    }

    const plan = await env.DB!
      .prepare(`SELECT limits FROM platform_plan_catalog WHERE id=?1 LIMIT 1`)
      .bind(subscription.plan_id)
      .first<{ limits: string }>()
    const limits = parseJson(plan?.limits, {}) as Record<string,any>
    const aiLimit = Number(limits.ai_messages || 0)
    if (limits.ai_enabled === true && aiLimit > 0) {
      const usage = await env.DB!
        .prepare(`SELECT request_count FROM tenant_ai_usage_monthly WHERE tenant_id=?1 AND module_id=?2 AND month_key=?3 LIMIT 1`)
        .bind(subscription.tenant_id, moduleId, month)
        .first<{ request_count: number }>()
      const used = Number(usage?.request_count || 0)
      if (used >= Math.max(1, Math.floor(aiLimit * 0.8))) {
        const fingerprint = `ai_quota:${subscription.tenant_id}:${moduleId}:${month}`
        activeFingerprints.add(fingerprint)
        const severity = used >= aiLimit
          ? 'critical'
          : used >= Math.floor(aiLimit * 0.9)
            ? 'high'
            : 'warning'
        await upsertAlert(env.DB!, {
          tenant_id: subscription.tenant_id,
          module_id: moduleId,
          alert_type: 'ai_quota',
          severity,
          title: 'Consumo de IA acima do limite seguro',
          description: `Tenant ${subscription.tenant_id} esta com uso de IA em ${used}/${aiLimit} no mes ${month}.`,
          payload: { messages_used: used, messages_limit: aiLimit, period_month: month },
          fingerprint,
          nowIso,
        })
      }
    }
  }

  const blocked = await env.DB!
    .prepare(`SELECT tenant_id,stage,progress FROM tenant_onboarding WHERE module_id=?1 AND status='blocked'`)
    .bind(moduleId)
    .all<Record<string,any>>()
  for (const item of blocked.results) {
    const fingerprint = `onboarding_blocked:${item.tenant_id}:${moduleId}`
    activeFingerprints.add(fingerprint)
    await upsertAlert(env.DB!, {
      tenant_id: item.tenant_id,
      module_id: moduleId,
      alert_type: 'onboarding_blocked',
      severity: 'high',
      title: 'Onboarding bloqueado',
      description: `Tenant ${item.tenant_id} esta com onboarding bloqueado na etapa ${item.stage}.`,
      payload: { stage: item.stage, progress: item.progress },
      fingerprint,
      nowIso,
    })
  }

  const open = await env.DB!
    .prepare(`SELECT id,fingerprint FROM tenant_governance_alerts WHERE module_id=?1 AND status='open'`)
    .bind(moduleId)
    .all<{ id: string; fingerprint: string }>()
  for (const item of open.results) {
    if (
      !activeFingerprints.has(item.fingerprint)
      && ['ai_quota:','billing_due:','onboarding_blocked:']
        .some((prefix) => item.fingerprint.startsWith(prefix))
    ) {
      await env.DB!
        .prepare(`UPDATE tenant_governance_alerts SET status='resolved',resolved_at=?1,updated_at=?1 WHERE id=?2`)
        .bind(nowIso, item.id)
        .run()
    }
  }

  return response({
    data: {
      module_id: moduleId,
      period_month: month,
      open_alerts: activeFingerprints.size,
    },
  })
}

async function deferredRpc(
  request: Request,
  env: Bindings,
  body: Record<string, any>,
) {
  const name = text(body.name)
  if (!DEFERRED_RPCS.has(name)) return null
  const args = object(body.args)

  if (name === 'create_petshop_booking_request') return createBooking(env, args)
  if (name === 'get_petshop_portal_snapshot') return portalSnapshot(env, args)

  const auth = await resolveScope(request, env)
  if (auth.error) return auth.error
  const scope = auth.scope!

  if (name === 'queue_fiscal_document_for_sale') return queueFiscal(env, scope, args)
  if (name === 'sync_all_tenant_fiscal_profiles') return syncFiscalProfiles(env, scope, args)
  if (name === 'yui_refresh_governance_alerts') return refreshGovernance(env, scope, args)
  return null
}

export async function handleDeferredCompatApiRequest(
  request: Request,
  env: Bindings,
): Promise<Response | null> {
  const path = new URL(request.url).pathname
  if (
    (path !== '/api/compat/query' && path !== '/api/compat/rpc')
    || request.method !== 'POST'
  ) return null

  let body: Record<string,any>
  try { body = object(await request.json()) }
  catch { return response({ code: 'INVALID_JSON' }, 400) }

  if (path === '/api/compat/query') return deferredQuery(request, env, body)
  return deferredRpc(request, env, body)
}

export const DEFERRED_COMPAT_TABLE_NAMES = Object.freeze(Object.keys(DEFERRED_TABLES))
export const DEFERRED_COMPAT_RPC_NAMES = Object.freeze([...DEFERRED_RPCS])
