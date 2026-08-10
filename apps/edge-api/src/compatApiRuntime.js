import { getBetterAuthSession } from './auth/betterAuthRuntime'

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/
const MODULE = /^[a-z0-9][a-z0-9_-]{0,63}$/
const COLUMN = /^[A-Za-z_][A-Za-z0-9_]*$/
const MAX_ROWS = 1000

const TABLES = Object.freeze({
  clients: { read: 'compat_clients', write: 'clients-pets' },
  pets: { read: 'compat_pets', write: 'pets' },
  products: { read: 'compat_products', write: 'products' },
  petshop_services: { read: 'compat_petshop_services', write: 'services' },
  settings: { read: 'tenant_module_settings', write: 'settings' },
  appointments: { read: 'compat_appointments', write: 'appointments' },
  service_delivery_orders: { read: 'compat_service_delivery_orders', write: 'service_delivery_orders' },
  sales: { read: 'compat_sales', write: 'sales' },
  sale_items: { read: 'compat_sale_items', write: 'sale_items' },
  sale_payment_splits: { read: 'compat_sale_payment_splits', write: 'payments' },
  chat_sessions: { read: 'compat_chat_sessions', write: 'chat_threads' },
  chat_messages: { read: 'compat_chat_messages', write: 'chat_messages' },
  fiscal_documents: { read: 'fiscal_documents', readOnly: true },
  subscription_plans: { read: 'compat_subscription_plans', write: 'subscription_plans' },
  client_subscriptions: { read: 'compat_client_subscriptions', write: 'client_subscriptions' },
  loyalty_settings: { read: 'loyalty_settings', write: 'loyalty_settings', singleton: true },
  loyalty_points: { read: 'loyalty_points', write: 'loyalty_points' },
  commission_rules: { read: 'commission_rules', write: 'commission_rules' },
  cash_register: { read: 'compat_cash_register', write: 'cash_register' },
  invoices: { read: 'compat_invoices', write: 'invoices' },
  billing_settings: { read: 'billing_settings', write: 'billing_settings', singleton: true },
  accounting_services: { read: 'accounting_services', write: 'accounting_services' },
  tenant_fiscal_profiles: { read: 'tenant_fiscal_profiles', write: 'tenant_fiscal_profiles', singleton: true },
  fiscal_audit_logs: { read: 'fiscal_audit_logs', write: 'fiscal_audit_logs' },
  petshop_growth_booking_settings: { read: 'petshop_growth_booking_settings', write: 'petshop_growth_booking_settings', singleton: true },
  petshop_growth_leads: { read: 'petshop_growth_leads', write: 'petshop_growth_leads' },
  petshop_growth_booking_requests: { read: 'petshop_growth_booking_requests', write: 'petshop_growth_booking_requests' },
  petshop_growth_no_show_policy: { read: 'petshop_growth_no_show_policy', write: 'petshop_growth_no_show_policy', singleton: true },
  petshop_growth_no_show_events: { read: 'petshop_growth_no_show_events', write: 'petshop_growth_no_show_events' },
  petshop_campaign_logs: { read: 'petshop_campaign_logs', write: 'petshop_campaign_logs' },
  petshop_growth_report_cards: { read: 'petshop_growth_report_cards', write: 'petshop_growth_report_cards' },
  support_threads: { read: 'support_threads', write: 'support_threads' },
  support_messages: { read: 'support_messages', write: 'support_messages' },
  tenant_platform_subscriptions: { read: 'tenant_platform_subscriptions', write: 'tenant_platform_subscriptions' },
  tenant_ai_usage_monthly: { read: 'tenant_ai_usage_monthly', write: 'tenant_ai_usage_monthly', singleton: true },
  niches: { read: 'compat_niches', write: 'ai_niches', global: true },
  companies: { read: 'compat_companies', write: 'ai_companies' },
  prompt_versions: { read: 'compat_prompt_versions', write: 'ai_prompt_versions' },
  ai_training_documents: { read: 'compat_ai_training_documents', write: 'ai_training_documents' },
  ai_playground_runs: { read: 'compat_ai_playground_runs', write: 'ai_playground_runs' },
})

const ALLOWED_RPCS = new Set([
  'calculate_petshop_operational_commissions',
  'calculate_petshop_commissions_v2',
  'calculate_commissions',
])

function json(body, status = 200) {
  return Response.json(body, { status, headers: { 'cache-control': 'no-store' } })
}
function obj(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {} }
function str(value) { const v = value == null ? '' : String(value).trim(); return v || null }
function num(value, fallback = 0) { const n = Number(value); return Number.isFinite(n) ? n : Number(fallback) || 0 }
function cents(value) { return Math.round(num(value) * 100) }
function milli(value) { return Math.round(num(value) * 1000) }
function flag(value) { return value === true || value === 1 || value === '1' ? 1 : 0 }
function epoch(value, fallback = Date.now()) {
  if (value == null || value === '') return fallback
  if (typeof value === 'number' && Number.isFinite(value)) return value
  const parsed = Date.parse(String(value))
  return Number.isFinite(parsed) ? parsed : fallback
}
function nullableEpoch(value) {
  if (value == null || value === '') return null
  const parsed = typeof value === 'number' ? value : Date.parse(String(value))
  return Number.isFinite(parsed) ? parsed : null
}
function iso(value) { const n = Number(value); return Number.isFinite(n) ? new Date(n).toISOString() : null }
function jsonString(value, fallback = {}) {
  if (typeof value === 'string') { try { JSON.parse(value); return value } catch { return JSON.stringify(fallback) } }
  try { return JSON.stringify(value ?? fallback) } catch { return JSON.stringify(fallback) }
}
function jsonValue(value, fallback = {}) { if (typeof value !== 'string') return value ?? fallback; try { return JSON.parse(value) } catch { return fallback } }
function scalar(value) {
  if (value == null) return null
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0
  if (typeof value === 'boolean') return value ? 1 : 0
  if (typeof value === 'object') return jsonString(value)
  return String(value)
}
function legacyStatus(value, kind) {
  const v = String(value ?? '').trim().toLowerCase()
  if (kind === 'appointment') return ({ agendado:'scheduled', confirmado:'confirmed', em_andamento:'in_progress', concluido:'completed', cancelado:'cancelled', bloqueado:'blocked', disponivel:'available' })[v] || v || 'scheduled'
  if (kind === 'sale') return ({ pendente:'pending', confirmado:'confirmed', concluido:'completed', cancelado:'cancelled', reembolsado:'refunded' })[v] || v || 'pending'
  return v || 'active'
}
function fulfillment(value) { const v=String(value ?? '').toLowerCase(); return ({ balcao:'counter', entrega:'delivery', servico:'service' })[v] || (['counter','delivery','service'].includes(v)?v:'counter') }
function paymentMethod(value) { const v=String(value ?? '').toLowerCase(); if (v.includes('pix')) return 'pix'; if (v.includes('dinheiro')||v==='cash') return 'cash'; return 'card' }

async function resolveScope(request, env) {
  if (!env.DB) return { error: json({ code: 'DATABASE_NOT_CONFIGURED' }, 503) }
  const tenantId = String(request.headers.get('x-tenant-id') || '').trim()
  const moduleId = String(request.headers.get('x-module-id') || '').trim().toLowerCase()
  if (!ID.test(tenantId) || !MODULE.test(moduleId)) return { error: json({ code: 'INVALID_SCOPE' }, 400) }
  const session = await getBetterAuthSession(request, env)
  const userId = str(session?.user?.id)
  if (!userId) return { error: json({ code: 'UNAUTHENTICATED' }, 401) }
  const principal = await env.DB.prepare("SELECT id FROM identity_principals WHERE provider='better-auth' AND subject=?1 AND status='active' LIMIT 1").bind(userId).first()
  if (!principal?.id) return { error: json({ code: 'FORBIDDEN' }, 403) }
  const membership = await env.DB.prepare("SELECT role,module_permissions_json FROM tenant_memberships WHERE tenant_id=?1 AND principal_id=?2 AND status='active' LIMIT 1").bind(tenantId, principal.id).first()
  if (!membership) return { error: json({ code: 'FORBIDDEN' }, 403) }
  let allowed = membership.role === 'owner' || membership.role === 'admin'
  try {
    const p = obj(JSON.parse(membership.module_permissions_json || '{}'))
    allowed ||= p['*'] === true || p[moduleId] === true || (p[moduleId] && typeof p[moduleId] === 'object')
  } catch {}
  if (!allowed) return { error: json({ code: 'FORBIDDEN' }, 403) }
  return { scope: { tenantId, moduleId, principalId: String(principal.id), userId } }
}

function filters(raw) { return Array.isArray(raw) ? raw.filter((x)=>x && typeof x === 'object') : [] }
function orders(raw) { return Array.isArray(raw) ? raw.filter((x)=>x && typeof x === 'object') : [] }
function checkScopeFilters(list, scope) {
  for (const f of list) {
    if (f.op !== 'eq' || (f.column !== 'tenant_id' && f.column !== 'module_id')) continue
    const expected = f.column === 'tenant_id' ? scope.tenantId : scope.moduleId
    if (String(f.value ?? '') !== expected) throw new Error('SCOPE_MISMATCH')
  }
}
function simpleClause(column, op, value, values) {
  if (!COLUMN.test(column)) throw new Error('INVALID_FILTER')
  if (op === 'is' && value == null) return `${column} IS NULL`
  const sql = ({ eq:'=', neq:'<>', gt:'>', gte:'>=', lt:'<', lte:'<=', ilike:'LIKE' })[op]
  if (!sql) throw new Error('INVALID_FILTER')
  if (op === 'ilike') { values.push(String(value ?? '').toLowerCase()); return `LOWER(CAST(${column} AS TEXT)) LIKE ?` }
  values.push(scalar(value)); return `${column} ${sql} ?`
}
function whereClause(list, scope, global = false) {
  checkScopeFilters(list, scope)
  const clauses = global ? [] : ['tenant_id = ?', 'module_id = ?']
  const values = global ? [] : [scope.tenantId, scope.moduleId]
  for (const f of list) {
    const op=String(f.op||''), column=String(f.column||'')
    if (!global && (column === 'tenant_id' || column === 'module_id')) continue
    if (global && (column === 'tenant_id' || column === 'module_id')) continue
    if (op === 'or') {
      const local=[]
      for (const part of String(f.expression||'').split(',').map((v)=>v.trim()).filter(Boolean)) {
        const match=/^([A-Za-z_][A-Za-z0-9_]*)\.(eq|neq|gt|gte|lt|lte|ilike|is)\.(.*)$/.exec(part)
        if (!match) throw new Error('INVALID_FILTER')
        local.push(simpleClause(match[1], match[2], match[3] === 'null' ? null : match[3], values))
      }
      if (local.length) clauses.push(`(${local.join(' OR ')})`)
      continue
    }
    if (!COLUMN.test(column)) throw new Error('INVALID_FILTER')
    if (op === 'in') {
      const items=Array.isArray(f.value)?f.value.slice(0,MAX_ROWS):[]
      if (!items.length) clauses.push('1=0')
      else { clauses.push(`${column} IN (${items.map(()=>'?').join(',')})`); values.push(...items.map(scalar)) }
      continue
    }
    if (op === 'contains') { clauses.push(`instr(CAST(${column} AS TEXT), ?) > 0`); values.push(typeof f.value === 'string' ? f.value : jsonString(f.value, null)); continue }
    if (op === 'not') {
      if (f.operator === 'is' && f.value == null) { clauses.push(`${column} IS NOT NULL`); continue }
      clauses.push(`NOT (${simpleClause(column,String(f.operator||''),f.value,values)})`); continue
    }
    clauses.push(simpleClause(column,op,f.value,values))
  }
  return { sql: clauses.length ? clauses.join(' AND ') : '1=1', values }
}
function orderClause(list) {
  const parts=[]
  for (const o of list.slice(0,5)) { const c=String(o.column||''); if(!COLUMN.test(c)) throw new Error('INVALID_ORDER'); parts.push(`${c} ${o.ascending===false?'DESC':'ASC'}`) }
  return parts.length?` ORDER BY ${parts.join(', ')}`:''
}
function page(body) {
  const r=obj(body.range)
  if (Object.keys(r).length) { const from=Math.max(0,Math.trunc(num(r.from))); const to=Math.max(from,Math.trunc(num(r.to,from))); return {limit:Math.min(MAX_ROWS,to-from+1),offset:from} }
  return {limit:Math.min(MAX_ROWS,Math.max(1,Math.trunc(num(body.limit,200)))),offset:0}
}

function normalize(table, row) {
  const r={...row}
  for (const key of ['details','bot_metadata','service_items','subscription_benefits','services','services_used','tags','metadata','parsed_intent','raw_response']) if (key in r) r[key]=jsonValue(r[key], ['service_items','services','tags'].includes(key)?[]:{})
  if (table==='loyalty_settings') return {tenant_id:r.tenant_id,module_id:r.module_id,enabled:Boolean(r.enabled),points_per_real:num(r.points_per_currency),redemption_rate:num(r.redemption_rate_cents)/100,...obj(jsonValue(r.data_json,{})),updated_at:iso(r.updated_at_ms)}
  if (table==='loyalty_points') return {...r,points:num(r.points_delta),created_at:iso(r.created_at_ms)}
  if (table==='commission_rules') return {...r,...obj(jsonValue(r.data_json,{})),rate:num(r.rate_basis_points)/100,fixed_amount:num(r.fixed_cents)/100,active:r.status==='active',updated_at:iso(r.updated_at_ms)}
  if (table==='billing_settings') return {...obj(jsonValue(r.data_json,{})),tenant_id:r.tenant_id,module_id:r.module_id,updated_at:iso(r.updated_at_ms)}
  if (table==='accounting_services') return {...r,amount:num(r.amount_cents)/100,active:r.status==='active',data:jsonValue(r.data_json,{}),created_at:iso(r.created_at_ms),updated_at:iso(r.updated_at_ms)}
  if (table==='tenant_fiscal_profiles') return {...r,auto_update:Boolean(r.auto_update),emit_nfce:Boolean(r.emit_nfce),emit_nfe:Boolean(r.emit_nfe),emit_nfse:Boolean(r.emit_nfse),settings:jsonValue(r.settings_json,{}),updated_at:iso(r.updated_at_ms)}
  if (table==='fiscal_audit_logs') return {...r,metadata:jsonValue(r.metadata_json,{}),created_at:iso(r.created_at_ms)}
  if (table==='petshop_growth_booking_settings') return {...r,enabled:Boolean(r.enabled),allow_whatsapp_fallback:Boolean(r.allow_whatsapp_fallback),updated_at:iso(r.updated_at_ms)}
  if (table==='petshop_growth_booking_requests') return {...r,need_motodog:Boolean(r.need_motodog),motodog_fee:num(r.motodog_fee_cents)/100,created_at:iso(r.created_at_ms),updated_at:iso(r.updated_at_ms)}
  if (table==='petshop_growth_leads') return {...r,next_followup_at:iso(r.next_followup_at_ms),last_contact_at:iso(r.last_contact_at_ms),created_at:iso(r.created_at_ms),updated_at:iso(r.updated_at_ms)}
  if (table==='petshop_growth_no_show_policy') return {...r,require_prepayment:Boolean(r.require_prepayment),prepayment_amount:num(r.prepayment_cents)/100,updated_at:iso(r.updated_at_ms)}
  if (table==='petshop_growth_no_show_events') return {...r,fee_amount:num(r.fee_cents)/100,created_at:iso(r.created_at_ms)}
  if (table==='petshop_campaign_logs') return {...r,...obj(jsonValue(r.payload_json,{})),created_at:iso(r.created_at_ms)}
  if (table==='petshop_growth_report_cards') return {...r,metrics:jsonValue(r.metrics_json,{}),created_at:iso(r.created_at_ms),updated_at:iso(r.updated_at_ms)}
  if (table==='support_threads') return {...r,last_message_at:iso(r.last_message_at_ms),created_at:iso(r.created_at_ms),updated_at:iso(r.updated_at_ms)}
  if (table==='support_messages') return {...r,created_at:iso(r.created_at_ms)}
  if (table==='tenant_platform_subscriptions') return {...r,data:jsonValue(r.data_json,{}),started_at:iso(r.started_at_ms),expires_at:iso(r.expires_at_ms),updated_at:iso(r.updated_at_ms)}
  if (table==='tenant_ai_usage_monthly') return {...r,updated_at:iso(r.updated_at_ms)}
  return r
}

async function readSettings(db, scope) {
  const core=await db.prepare('SELECT * FROM tenant_module_settings WHERE tenant_id=?1 AND module_id=?2 LIMIT 1').bind(scope.tenantId,scope.moduleId).first()
  if(!core)return[]
  const ext=await db.prepare('SELECT data_json FROM module_settings_extensions WHERE tenant_id=?1 AND module_id=?2 LIMIT 1').bind(scope.tenantId,scope.moduleId).first()
  return [{...obj(jsonValue(ext?.data_json,{})),...core,created_at:iso(core.created_at_ms),updated_at:iso(core.updated_at_ms)}]
}

async function selectRows(db, table, config, body, scope) {
  if (table==='settings') { const rows=await readSettings(db,scope); return {rows,count:rows.length} }
  const w=whereClause(filters(body.filters),scope,config.global===true)
  const order=orderClause(orders(body.orders)), p=page(body)
  const result=await db.prepare(`SELECT * FROM ${config.read} WHERE ${w.sql}${order} LIMIT ? OFFSET ?`).bind(...w.values,p.limit,p.offset).all()
  const count=await db.prepare(`SELECT COUNT(*) AS count FROM ${config.read} WHERE ${w.sql}`).bind(...w.values).first()
  const rows=result.results.map((row)=>normalize(table,row))
  await enrich(db,table,String(body.columns||'*'),rows,scope)
  return {rows,count:Number(count?.count||0)}
}
async function enrich(db,table,columns,rows,scope) {
  if(!rows.length)return
  if(/(?:^|,)\s*clients\s*\(/.test(columns)) {
    const ids=[...new Set(rows.map((r)=>str(r.client_id)).filter(Boolean))]
    if(ids.length){const q=ids.map(()=>'?').join(',');const res=await db.prepare(`SELECT * FROM compat_clients WHERE tenant_id=? AND module_id=? AND id IN (${q})`).bind(scope.tenantId,scope.moduleId,...ids).all();const map=new Map(res.results.map((r)=>[String(r.id),normalize('clients',r)]));for(const r of rows)r.clients=map.get(String(r.client_id||''))||null}
  }
  if(table==='client_subscriptions'&&/subscription_plans\s*\(/.test(columns)) {
    const ids=[...new Set(rows.map((r)=>str(r.plan_id)).filter(Boolean))]
    if(ids.length){const q=ids.map(()=>'?').join(',');const res=await db.prepare(`SELECT * FROM compat_subscription_plans WHERE tenant_id=? AND module_id=? AND id IN (${q})`).bind(scope.tenantId,scope.moduleId,...ids).all();const map=new Map(res.results.map((r)=>[String(r.id),normalize('subscription_plans',r)]));for(const r of rows)r.subscription_plans=map.get(String(r.plan_id||''))||null}
  }
  if(table==='service_delivery_orders'&&/sales\s*\(/.test(columns)) {
    const ids=[...new Set(rows.map((r)=>str(r.sale_id)).filter(Boolean))]
    if(ids.length){const q=ids.map(()=>'?').join(',');const res=await db.prepare(`SELECT * FROM compat_sales WHERE tenant_id=? AND module_id=? AND id IN (${q})`).bind(scope.tenantId,scope.moduleId,...ids).all();const map=new Map(res.results.map((r)=>[String(r.id),normalize('sales',r)]));for(const r of rows)r.sales=map.get(String(r.sale_id||''))||null}
  }
}

async function mutateSettings(db, raw, scope) {
  const now=Date.now(), coreKeys=new Set(['store_name','store_phone','store_address','store_neighborhood','store_city','bot_prompt']), core={}, extra={}
  for(const [k,v] of Object.entries(raw)){if(['tenant_id','module_id','created_at','updated_at'].includes(k))continue;(coreKeys.has(k)?core:extra)[k]=v}
  const current=await db.prepare('SELECT data_json FROM module_settings_extensions WHERE tenant_id=?1 AND module_id=?2').bind(scope.tenantId,scope.moduleId).first()
  const merged={...obj(jsonValue(current?.data_json,{})),...extra}, statements=[]
  if(Object.keys(core).length){const keys=Object.keys(core);statements.push(db.prepare(`UPDATE tenant_module_settings SET ${keys.map((k)=>`${k}=?`).join(',')},version=version+1,updated_at_ms=? WHERE tenant_id=? AND module_id=?`).bind(...keys.map((k)=>scalar(core[k])),now,scope.tenantId,scope.moduleId))}
  statements.push(db.prepare('INSERT INTO module_settings_extensions(tenant_id,module_id,data_json,version,updated_at_ms) VALUES(?1,?2,?3,1,?4) ON CONFLICT(tenant_id,module_id) DO UPDATE SET data_json=excluded.data_json,version=module_settings_extensions.version+1,updated_at_ms=excluded.updated_at_ms').bind(scope.tenantId,scope.moduleId,JSON.stringify(merged),now))
  await db.batch(statements)
}

async function mutateClients(db, action, body, scope) {
  const fs=filters(body.filters);checkScopeFilters(fs,scope);const idFilter=fs.find((f)=>f.op==='eq'&&f.column==='id')
  if(action==='delete'){const petId=str(idFilter?.value);if(!petId)throw new Error('WRITE_REQUIRES_ID');await db.prepare("UPDATE pets SET status='inactive',updated_at_ms=? WHERE tenant_id=? AND module_id=? AND id=?").bind(Date.now(),scope.tenantId,scope.moduleId,petId).run();return}
  const rows=Array.isArray(body.payload)?body.payload.map(obj):[obj(body.payload)]
  for(const raw of rows){const now=Date.now(),petId=str(idFilter?.value)||str(raw.id)||crypto.randomUUID();const old=await db.prepare('SELECT client_id FROM pets WHERE tenant_id=?1 AND module_id=?2 AND id=?3').bind(scope.tenantId,scope.moduleId,petId).first();const d=obj(raw.details);const clientId=str(d.tutor_group_id)||old?.client_id||str(raw.client_id)||crypto.randomUUID();await db.batch([
    db.prepare("INSERT INTO clients(tenant_id,module_id,id,name,document,phone,email,birth_date,address,address_number,address_complement,address_reference,neighborhood,city,postal_code,notes,status,created_at_ms,updated_at_ms) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(tenant_id,module_id,id) DO UPDATE SET name=excluded.name,document=excluded.document,phone=excluded.phone,email=excluded.email,birth_date=excluded.birth_date,address=excluded.address,address_number=excluded.address_number,address_complement=excluded.address_complement,address_reference=excluded.address_reference,neighborhood=excluded.neighborhood,city=excluded.city,postal_code=excluded.postal_code,notes=excluded.notes,status=excluded.status,updated_at_ms=excluded.updated_at_ms").bind(scope.tenantId,scope.moduleId,clientId,str(raw.name)||'Cliente',str(raw.document),str(raw.phone),str(raw.email),str(d.tutor_birth_date),str(raw.address),str(d.address_number),str(d.address_complement),str(d.address_reference),str(raw.neighborhood),str(raw.city),str(d.zip_code),str(raw.notes),raw.active===false?'inactive':'active',epoch(raw.created_at,now),now),
    db.prepare("INSERT INTO pets(tenant_id,module_id,id,client_id,name,species,breed,birth_date,weight_kg,color,notes,status,created_at_ms,updated_at_ms) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(tenant_id,module_id,id) DO UPDATE SET client_id=excluded.client_id,name=excluded.name,species=excluded.species,breed=excluded.breed,birth_date=excluded.birth_date,weight_kg=excluded.weight_kg,color=excluded.color,notes=excluded.notes,status=excluded.status,updated_at_ms=excluded.updated_at_ms").bind(scope.tenantId,scope.moduleId,petId,clientId,str(d.pet_name)||str(raw.pet_name)||'',str(d.species)||str(raw.species)||'other',str(d.breed)||str(raw.breed),str(d.birth_date)||str(raw.birth_date),d.weight_kg==null?raw.weight_kg==null?null:num(raw.weight_kg):num(d.weight_kg),str(d.color)||str(raw.color),str(d.pet_notes)||str(raw.notes),raw.active===false?'inactive':'active',epoch(raw.created_at,now),now),
  ])}
}

async function mutateProducts(db, action, body, scope) {
  const fs=filters(body.filters);checkScopeFilters(fs,scope);const idFilter=fs.find((f)=>f.op==='eq'&&f.column==='id');if(action==='delete'){const id=str(idFilter?.value);if(!id)throw new Error('WRITE_REQUIRES_ID');await db.prepare("UPDATE catalog_products SET status='inactive',updated_at_ms=? WHERE tenant_id=? AND module_id=? AND id=?").bind(Date.now(),scope.tenantId,scope.moduleId,id).run();return}
  const rows=Array.isArray(body.payload)?body.payload.map(obj):[obj(body.payload)]
  for(const raw of rows){const now=Date.now(),id=str(idFilter?.value)||str(raw.id)||crypto.randomUUID();const old=await db.prepare('SELECT * FROM compat_products WHERE tenant_id=?1 AND module_id=?2 AND id=?3').bind(scope.tenantId,scope.moduleId,id).first();const m={...old,...raw};await db.batch([
    db.prepare("INSERT INTO catalog_products(tenant_id,module_id,id,name,barcode,category,description,price_cents,cost_cents,species_target,upsell_product_id,image_url,bot_metadata_json,status,created_at_ms,updated_at_ms) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(tenant_id,module_id,id) DO UPDATE SET name=excluded.name,barcode=excluded.barcode,category=excluded.category,description=excluded.description,price_cents=excluded.price_cents,cost_cents=excluded.cost_cents,species_target=excluded.species_target,upsell_product_id=excluded.upsell_product_id,image_url=excluded.image_url,bot_metadata_json=excluded.bot_metadata_json,status=excluded.status,updated_at_ms=excluded.updated_at_ms").bind(scope.tenantId,scope.moduleId,id,str(m.name)||'',str(m.barcode),str(m.category),str(m.description),cents(m.price),cents(m.cost_price),str(m.species_target),str(m.upsell_product_id),str(m.image_url),jsonString(m.bot_metadata,{}),m.active===false?'inactive':'active',epoch(m.created_at,now),now),
    db.prepare('INSERT INTO inventory_balances(tenant_id,module_id,product_id,on_hand_milliunits,reorder_milliunits,updated_at_ms) VALUES(?,?,?,?,?,?) ON CONFLICT(tenant_id,module_id,product_id) DO UPDATE SET on_hand_milliunits=excluded.on_hand_milliunits,reorder_milliunits=excluded.reorder_milliunits,updated_at_ms=excluded.updated_at_ms').bind(scope.tenantId,scope.moduleId,id,milli(m.stock_quantity),milli(m.min_stock),now),
  ])}
}

async function mutateServices(db, action, body, scope) {
  const fs=filters(body.filters);checkScopeFilters(fs,scope);const idFilter=fs.find((f)=>f.op==='eq'&&f.column==='id');if(action==='delete'){const id=str(idFilter?.value);if(!id)throw new Error('WRITE_REQUIRES_ID');await db.prepare("UPDATE services SET status='inactive',updated_at_ms=? WHERE tenant_id=? AND module_id=? AND id=?").bind(Date.now(),scope.tenantId,scope.moduleId,id).run();return}
  const rows=Array.isArray(body.payload)?body.payload.map(obj):[obj(body.payload)]
  for(const raw of rows){const now=Date.now(),id=str(idFilter?.value)||str(raw.id)||crypto.randomUUID();const old=await db.prepare('SELECT * FROM compat_petshop_services WHERE tenant_id=?1 AND module_id=?2 AND id=?3').bind(scope.tenantId,scope.moduleId,id).first();const m={...old,...raw};await db.prepare("INSERT INTO services(tenant_id,module_id,id,code,name,category,description,group_type,default_price_cents,default_duration_min,commission_type,commission_basis_points,sort_order,icon,source_product_id,status,created_at_ms,updated_at_ms) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(tenant_id,module_id,id) DO UPDATE SET code=excluded.code,name=excluded.name,category=excluded.category,description=excluded.description,group_type=excluded.group_type,default_price_cents=excluded.default_price_cents,default_duration_min=excluded.default_duration_min,commission_type=excluded.commission_type,commission_basis_points=excluded.commission_basis_points,sort_order=excluded.sort_order,icon=excluded.icon,source_product_id=excluded.source_product_id,status=excluded.status,updated_at_ms=excluded.updated_at_ms").bind(scope.tenantId,scope.moduleId,id,str(m.code)||id,str(m.name)||'',str(m.category),str(m.description),str(m.group_type)||'outro',cents(m.default_price),Math.max(15,Math.round(num(m.default_duration_min,60))),str(m.commission_type)||'percentage',Math.max(0,Math.min(10000,Math.round(num(m.commission_rate)*100))),Math.round(num(m.sort_order,999)),str(m.icon),str(m.source_product_id),m.active===false?'inactive':'active',epoch(m.created_at,now),now).run()}
}

async function mutateAppointments(db, action, body, scope) {
  const fs=filters(body.filters);checkScopeFilters(fs,scope);const idFilter=fs.find((f)=>f.op==='eq'&&f.column==='id'),id=str(idFilter?.value)
  if(action==='delete'){if(!id)throw new Error('WRITE_REQUIRES_ID');await db.prepare("UPDATE appointments SET status='cancelled',version=version+1,updated_at_ms=? WHERE tenant_id=? AND module_id=? AND id=?").bind(Date.now(),scope.tenantId,scope.moduleId,id).run();return}
  const rows=Array.isArray(body.payload)?body.payload.map(obj):[obj(body.payload)]
  for(const raw of rows){const now=Date.now(),appointmentId=id||str(raw.id)||crypto.randomUUID();const old=await db.prepare('SELECT * FROM compat_appointments WHERE tenant_id=?1 AND module_id=?2 AND id=?3').bind(scope.tenantId,scope.moduleId,appointmentId).first();const m={...old,...raw};const petId=str(m.pet_id)||str(m.client_id);let clientId=str(m.client_id);if(petId){const pet=await db.prepare('SELECT client_id FROM pets WHERE tenant_id=?1 AND module_id=?2 AND id=?3').bind(scope.tenantId,scope.moduleId,petId).first();clientId=pet?.client_id||clientId}if(!clientId||!petId)throw new Error('APPOINTMENT_PARTY_REQUIRED');const items=Array.isArray(m.service_items)?m.service_items:jsonValue(m.service_items,[]);const primary=items[0]||{};const duration=Math.max(15,Math.round(num(m.duration_min||primary.duration_min,60)));const subtotal=cents(m.price??m.subtotal);await db.prepare("INSERT INTO appointments(tenant_id,module_id,id,client_id,pet_id,scheduled_at_ms,duration_min,service_group,status,source,subtotal_cents,transport_fee_cents,notes,version,created_at_ms,updated_at_ms) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?) ON CONFLICT(tenant_id,module_id,id) DO UPDATE SET client_id=excluded.client_id,pet_id=excluded.pet_id,scheduled_at_ms=excluded.scheduled_at_ms,duration_min=excluded.duration_min,service_group=excluded.service_group,status=excluded.status,source=excluded.source,subtotal_cents=excluded.subtotal_cents,notes=excluded.notes,version=appointments.version+1,updated_at_ms=excluded.updated_at_ms").bind(scope.tenantId,scope.moduleId,appointmentId,clientId,petId,epoch(m.scheduled_at),duration,str(m.service_group)||str(primary.group_type)||'outro',legacyStatus(m.status,'appointment'),str(m.source)||'manual',Math.max(0,subtotal),Math.max(0,cents(m.delivery_fee??m.transport_fee)),str(m.notes),epoch(m.created_at,now),now).run();if(items.length){await db.prepare('DELETE FROM appointment_services WHERE tenant_id=?1 AND module_id=?2 AND appointment_id=?3').bind(scope.tenantId,scope.moduleId,appointmentId).run();const statements=items.slice(0,20).map((item,index)=>{const serviceId=str(item.service_id)||str(item.id);if(!serviceId)throw new Error('SERVICE_REQUIRED');return db.prepare('INSERT INTO appointment_services(tenant_id,module_id,appointment_id,position,service_id,service_code,service_name,service_group,unit_price_cents,duration_min,benefit_used) VALUES(?,?,?,?,?,?,?,?,?,?,?)').bind(scope.tenantId,scope.moduleId,appointmentId,index,serviceId,str(item.code)||serviceId,str(item.name)||str(m.service_type)||'Servico',str(item.group_type)||str(m.service_group)||'outro',Math.max(0,cents(item.unit_price??m.price)),Math.max(15,Math.round(num(item.duration_min,duration))),flag(item.benefit_used))});await db.batch(statements)}}
}

function canonical(table, raw, scope) {
  const id=str(raw.id)||crypto.randomUUID(), now=Date.now(), base={tenant_id:scope.tenantId,module_id:scope.moduleId}
  if(table==='pets')return{...base,id,client_id:str(raw.client_id),name:str(raw.pet_name??raw.name)||'',species:str(raw.species)||'other',breed:str(raw.breed),birth_date:str(raw.birth_date),weight_kg:raw.weight_kg==null?null:num(raw.weight_kg),color:str(raw.color),notes:str(raw.notes),status:raw.active===false?'inactive':'active',created_at_ms:epoch(raw.created_at,now),updated_at_ms:now}
  if(table==='sales')return{...base,id,operation_key:str(raw.operation_key)||`compat:${id}`,client_id:str(raw.client_id),appointment_id:str(raw.appointment_id),source:['manual','pos','whatsapp','import'].includes(String(raw.source))?String(raw.source):'manual',fulfillment_type:fulfillment(raw.fulfillment_type),subtotal_cents:Math.max(0,cents(raw.subtotal??raw.total_price)),discount_cents:Math.max(0,cents(raw.discount)),transport_fee_cents:Math.max(0,cents(raw.delivery_fee)),total_cents:Math.max(0,cents(raw.total_price??raw.total)),status:legacyStatus(raw.status,'sale'),notes:str(raw.notes),created_at_ms:epoch(raw.created_at,now),updated_at_ms:now}
  if(table==='sale_items')return{...base,sale_id:str(raw.sale_id),position:Math.max(0,Math.round(num(raw.position))),item_type:str(raw.product_id)?'product':'service',product_id:str(raw.product_id),service_id:str(raw.service_id),item_name:str(raw.item_name??raw.name)||'Item',quantity_milliunits:Math.max(1,milli(raw.quantity||1)),unit_price_cents:Math.max(0,cents(raw.unit_price)),subtotal_cents:Math.max(0,cents(raw.subtotal??num(raw.quantity||1)*num(raw.unit_price))),upsell:flag(raw.upsell)}
  if(table==='sale_payment_splits')return{...base,id:str(raw.payment_id)||id,sale_id:str(raw.sale_id),operation_key:str(raw.operation_key)||`compat:${str(raw.sale_id)||'sale'}:${id}`,method:paymentMethod(raw.payment_method),amount_cents:Math.max(1,cents(raw.amount)),status:str(raw.status)||'received',provider:null,provider_reference:null,received_at_ms:epoch(raw.created_at,now),created_at_ms:epoch(raw.created_at,now),updated_at_ms:now}
  if(table==='service_delivery_orders')return{...base,id,sale_id:str(raw.sale_id),appointment_id:str(raw.appointment_id),client_id:str(raw.client_id),session_id:str(raw.session_id),source:str(raw.source)||'manual',order_type:str(raw.order_type)||'servico',status:str(raw.status)||'pendente',scheduled_for_ms:nullableEpoch(raw.scheduled_for),contact_phone:str(raw.contact_phone),payment_status:str(raw.payment_status),notes:str(raw.notes),delivery_address:str(raw.delivery_address),delivery_neighborhood:str(raw.delivery_neighborhood),delivery_city:str(raw.delivery_city),delivery_reference:str(raw.delivery_reference),transport_mode:str(raw.transport_mode),transport_label:str(raw.transport_label),assigned_staff_key:str(raw.assigned_staff_key),assigned_staff_name:str(raw.assigned_staff_name),delivery_value_cents:Math.max(0,cents(raw.delivery_value)),created_at_ms:epoch(raw.created_at,now),updated_at_ms:now}
  if(table==='chat_sessions')return{...base,id,channel:str(raw.channel)||'whatsapp',external_thread_id:str(raw.phone??raw.external_thread_id),client_id:str(raw.client_id),pet_id:str(raw.pet_id),status:raw.status==='human'?'handoff':str(raw.status)||'open',last_message_at_ms:nullableEpoch(raw.last_message_at),created_at_ms:epoch(raw.created_at,now),updated_at_ms:now}
  if(table==='chat_messages'){const role=str(raw.role)||'system',actor=role==='user'?'customer':role==='human_agent'?'human':role==='assistant'?'assistant':'system';return{...base,id,thread_id:str(raw.session_id??raw.thread_id),external_message_id:str(raw.external_message_id),direction:actor==='customer'?'inbound':'outbound',actor_type:actor,content_text:str(raw.content)||'',content_json:raw.content_json==null?null:jsonString(raw.content_json,{}),created_at_ms:epoch(raw.created_at,now)}}
  if(table==='subscription_plans')return{...base,id,name:str(raw.name)||'',price_cents:Math.max(0,cents(raw.price)),billing_cycle:str(raw.billing_cycle)||'monthly',services_json:jsonString(raw.services,[]),status:raw.active===false?'inactive':'active',created_at_ms:epoch(raw.created_at,now),updated_at_ms:now}
  if(table==='client_subscriptions')return{...base,id,plan_id:str(raw.plan_id),client_id:str(raw.client_id),status:str(raw.status)||'pending_payment',started_at_ms:epoch(raw.started_at,now),next_billing_date:str(raw.next_billing_date),services_used_json:jsonString(raw.services_used,{}),cancelled_at_ms:nullableEpoch(raw.cancelled_at),created_at_ms:epoch(raw.created_at,now),updated_at_ms:now}
  if(table==='loyalty_settings')return{...base,enabled:raw.enabled===false?0:1,points_per_currency:Math.max(0,Math.round(num(raw.points_per_real,1))),redemption_rate_cents:Math.max(0,cents(raw.redemption_rate)),data_json:jsonString({points_per_service:num(raw.points_per_service,10),expiry_days:num(raw.expiry_days,365)},{}),updated_at_ms:now}
  if(table==='loyalty_points')return{...base,id,client_id:str(raw.client_id),points_delta:Math.round(num(raw.points)),balance_after:Math.max(0,Math.round(num(raw.balance_after,num(raw.points)))),reason:str(raw.reason),reference_type:str(raw.reference_type),reference_id:str(raw.reference_id),created_at_ms:epoch(raw.created_at,now)}
  if(table==='commission_rules')return{...base,id,staff_key:str(raw.staff_key??raw.profile_id),service_code:str(raw.service_code),rule_type:str(raw.rule_type)||(num(raw.fixed_amount)>0?'fixed':'percentage'),rate_basis_points:Math.max(0,Math.min(10000,Math.round(num(raw.rate??raw.percentage)*100))),fixed_cents:Math.max(0,cents(raw.fixed_amount)),status:raw.active===false?'inactive':'active',data_json:jsonString({scope:raw.scope,product_id:raw.product_id,category:raw.category,created_at:raw.created_at},{}),updated_at_ms:now}
  if(table==='cash_register')return{...base,id,opened_by:str(raw.opened_by),closed_by:str(raw.closed_by),opening_balance_cents:cents(raw.opening_balance),closing_balance_cents:raw.closing_balance==null?null:cents(raw.closing_balance),expected_balance_cents:raw.expected_balance==null?null:cents(raw.expected_balance),difference_cents:raw.difference==null?null:cents(raw.difference),opened_at_ms:epoch(raw.opened_at,now),closed_at_ms:nullableEpoch(raw.closed_at),notes:str(raw.notes)}
  if(table==='invoices')return{...base,id,sale_id:str(raw.sale_id),client_id:str(raw.client_id),amount_cents:Math.max(0,cents(raw.amount)),status:str(raw.status)||'pending',due_date:str(raw.due_date),paid_at_ms:nullableEpoch(raw.paid_at),customer_phone:str(raw.customer_phone),notes:str(raw.notes),invoice_nfe_url:str(raw.invoice_nfe_url),created_at_ms:epoch(raw.created_at,now),updated_at_ms:now}
  if(table==='billing_settings')return{...base,data_json:jsonString(raw,{}),updated_at_ms:now}
  if(table==='accounting_services')return{...base,id,name:str(raw.name)||'',amount_cents:Math.max(0,cents(raw.amount)),status:raw.active===false?'inactive':'active',data_json:jsonString(raw.data,{}),created_at_ms:epoch(raw.created_at,now),updated_at_ms:now}
  if(table==='tenant_fiscal_profiles')return{...base,policy_version_id:str(raw.policy_version_id),mode:str(raw.mode)||'manual',auto_update:flag(raw.auto_update),nfe_environment:str(raw.nfe_environment)||'homologacao',fiscal_regime:str(raw.fiscal_regime),issue_series:Math.max(1,Math.round(num(raw.issue_series,1))),next_invoice_number:Math.max(1,Math.round(num(raw.next_invoice_number,1))),emit_nfce:flag(raw.emit_nfce),emit_nfe:flag(raw.emit_nfe),emit_nfse:flag(raw.emit_nfse),settings_json:jsonString(raw.settings,{}),updated_at_ms:now}
  if(table==='fiscal_audit_logs')return{...base,id,invoice_id:str(raw.invoice_id),severity:str(raw.severity)||'info',code:str(raw.code)||'compat',message:str(raw.message)||'',metadata_json:jsonString(raw.metadata,{}),created_at_ms:epoch(raw.created_at,now)}
  if(table==='petshop_growth_booking_settings')return{...base,enabled:raw.enabled===false?0:1,public_slug:str(raw.public_slug)||`agenda-${scope.tenantId.slice(0,8)}`,allow_whatsapp_fallback:raw.allow_whatsapp_fallback===false?0:1,lead_expiration_hours:Math.max(1,Math.round(num(raw.lead_expiration_hours,6))),intake_message:str(raw.intake_message),updated_at_ms:now}
  if(table==='petshop_growth_booking_requests')return{...base,id,client_id:str(raw.client_id),lead_id:str(raw.lead_id),channel:str(raw.channel)||'manual',customer_name:str(raw.customer_name)||'',pet_name:str(raw.pet_name),phone:str(raw.phone),service_interest:str(raw.service_interest),preferred_date:str(raw.preferred_date),preferred_period:str(raw.preferred_period),transport_mode:str(raw.transport_mode)||'dropoff',need_motodog:flag(raw.need_motodog),motodog_fee_cents:Math.max(0,cents(raw.motodog_fee)),pickup_address:str(raw.pickup_address),pickup_neighborhood:str(raw.pickup_neighborhood),pickup_city:str(raw.pickup_city),status:str(raw.status)||'pending',notes:str(raw.notes),created_at_ms:epoch(raw.created_at,now),updated_at_ms:now}
  if(table==='petshop_growth_leads')return{...base,id,client_id:str(raw.client_id),source:str(raw.source)||'manual',stage:str(raw.stage)||'new',priority:str(raw.priority)||'normal',owner_name:str(raw.owner_name)||'',pet_name:str(raw.pet_name),phone:str(raw.phone),interest:str(raw.interest),notes:str(raw.notes),next_followup_at_ms:nullableEpoch(raw.next_followup_at),last_contact_at_ms:nullableEpoch(raw.last_contact_at),converted_sale_id:str(raw.converted_sale_id),created_at_ms:epoch(raw.created_at,now),updated_at_ms:now}
  if(table==='petshop_growth_no_show_policy')return{...base,require_prepayment:flag(raw.require_prepayment),prepayment_cents:Math.max(0,cents(raw.prepayment_amount)),grace_minutes:Math.max(0,Math.round(num(raw.grace_minutes,15))),max_strikes:Math.max(1,Math.round(num(raw.max_strikes,2))),auto_block_days:Math.max(0,Math.round(num(raw.auto_block_days,30))),reminder_minutes_before:Math.max(0,Math.round(num(raw.reminder_minutes_before,90))),updated_at_ms:now}
  if(table==='petshop_growth_no_show_events')return{...base,id,appointment_id:str(raw.appointment_id),client_id:str(raw.client_id),event_type:str(raw.event_type)||'no_show',fee_cents:Math.max(0,cents(raw.fee_amount)),notes:str(raw.notes),created_at_ms:epoch(raw.created_at,now)}
  if(table==='petshop_campaign_logs')return{...base,id,campaign_type:str(raw.campaign_type),client_id:str(raw.client_id),channel:str(raw.channel),status:str(raw.status),payload_json:jsonString({audience_name:raw.audience_name,message:raw.message,sent_at:raw.sent_at},{}),created_at_ms:epoch(raw.created_at??raw.sent_at,now)}
  if(table==='petshop_growth_report_cards')return{...base,id,period_key:str(raw.period_key)||new Date(now).toISOString().slice(0,7),metrics_json:jsonString(raw.metrics,{}),created_at_ms:epoch(raw.created_at,now),updated_at_ms:now}
  if(table==='support_threads')return{...base,id,requester_profile_id:str(raw.requester_profile_id)||scope.principalId,status:str(raw.status)||'pending',priority:str(raw.priority)||'normal',source:str(raw.source)||'widget',subject:str(raw.subject),last_message_at_ms:nullableEpoch(raw.last_message_at),created_at_ms:epoch(raw.created_at,now),updated_at_ms:now}
  if(table==='support_messages')return{...base,id,thread_id:str(raw.thread_id),sender_profile_id:str(raw.sender_profile_id),sender_type:str(raw.sender_type)||'user',body:str(raw.body??raw.message)||'',created_at_ms:epoch(raw.created_at,now)}
  if(table==='tenant_platform_subscriptions')return{...base,id,plan_id:str(raw.plan_id),status:str(raw.status)||'active',started_at_ms:epoch(raw.started_at,now),expires_at_ms:nullableEpoch(raw.expires_at),data_json:jsonString(raw.data,{}),updated_at_ms:now}
  if(table==='tenant_ai_usage_monthly')return{...base,month_key:str(raw.month_key)||new Date(now).toISOString().slice(0,7),request_count:Math.max(0,Math.round(num(raw.request_count))),token_count:Math.max(0,Math.round(num(raw.token_count))),updated_at_ms:now}
  if(table==='niches')return{id, name:str(raw.name)||'',base_prompt:str(raw.base_prompt)||'',created_at_ms:epoch(raw.created_at,now),updated_at_ms:now}
  if(table==='companies')return{...base,id,niche_id:str(raw.niche_id),name:str(raw.name)||'',system_prompt:str(raw.system_prompt)||'',bot_name:str(raw.bot_name)||'Yui',temperature_milli:Math.max(0,Math.min(2000,Math.round(num(raw.temperature,.5)*1000))),model_name:str(raw.model_name)||'gpt-4o-mini',welcome_message:str(raw.welcome_message),kb_namespace:str(raw.kb_namespace),status:raw.is_active===false?'inactive':'active',schedule_free_status:str(raw.schedule_free_status)||'available',schedule_booked_status:str(raw.schedule_booked_status)||'booked',created_at_ms:epoch(raw.created_at,now),updated_at_ms:now}
  if(table==='prompt_versions')return{...base,id,company_id:str(raw.company_id),layer:str(raw.layer)||'company',content:str(raw.content)||'',version:Math.max(1,Math.round(num(raw.version,1))),is_active:raw.is_active===false?0:1,changed_by:str(raw.changed_by),change_note:str(raw.change_note),created_at_ms:epoch(raw.created_at,now)}
  if(table==='ai_training_documents')return{...base,id,company_id:str(raw.company_id),title:str(raw.title)||'Documento',object_key:str(raw.storage_path??raw.object_key),mime_type:str(raw.mime_type),file_size:raw.file_size==null?null:Math.max(0,Math.round(num(raw.file_size))),content_text:str(raw.content_text),tags_json:jsonString(raw.tags,[]),status:str(raw.status)||'active',metadata_json:jsonString(raw.metadata,{}),uploaded_by:str(raw.uploaded_by),created_at_ms:epoch(raw.created_at,now),updated_at_ms:now}
  if(table==='ai_playground_runs')return{...base,id,company_id:str(raw.company_id),created_by:str(raw.created_by),customer_phone:str(raw.customer_phone)||'',input_message:str(raw.input_message)||'',parsed_intent_json:jsonString(raw.parsed_intent,{}),action:str(raw.action),reply:str(raw.reply),raw_response_json:jsonString(raw.raw_response,{}),created_at_ms:epoch(raw.created_at,now)}
  return {...base,...raw,id}
}

function columnsOf(record){return Object.entries(record).filter(([k])=>COLUMN.test(k))}
async function genericMutation(db, table, config, action, body, scope) {
  if(config.readOnly||!config.write)throw new Error('WRITE_NOT_SUPPORTED')
  const fs=filters(body.filters), w=whereClause(fs,scope,config.global===true)
  if(action==='delete'){if(config.global){const idf=fs.find((f)=>f.op==='eq'&&f.column==='id');if(!idf)throw new Error('WRITE_REQUIRES_ID');await db.prepare(`DELETE FROM ${config.write} WHERE id=?`).bind(scalar(idf.value)).run()}else await db.prepare(`DELETE FROM ${config.write} WHERE ${w.sql}`).bind(...w.values).run();return}
  const rows=Array.isArray(body.payload)?body.payload.map(obj):[obj(body.payload)]
  if(action==='update'){
    if(!config.singleton&&!fs.some((f)=>f.op==='eq'&&f.column==='id'))throw new Error('WRITE_REQUIRES_ID')
    const incoming=rows[0]||{}, currentId=str(fs.find((f)=>f.op==='eq'&&f.column==='id')?.value), merged=currentId?{...(await selectCurrent(db,table,config,currentId,scope)),...incoming}:incoming, record=canonical(table,merged,scope)
    delete record.tenant_id;delete record.module_id;delete record.id
    const entries=columnsOf(record).filter(([k])=>!['created_at_ms','opened_at_ms','started_at_ms'].includes(k)||Object.keys(incoming).some((source)=>source===k||`${source}_ms`===k||`${source}_at_ms`===k))
    if(!entries.length)return
    await db.prepare(`UPDATE ${config.write} SET ${entries.map(([k])=>`${k}=?`).join(',')} WHERE ${w.sql}`).bind(...entries.map(([,v])=>scalar(v)),...w.values).run();return
  }
  for(const raw of rows){const record=canonical(table,raw,scope),entries=columnsOf(record),cols=entries.map(([k])=>k),marks=entries.map(()=>'?').join(',');let sql=`INSERT INTO ${config.write}(${cols.join(',')}) VALUES(${marks})`;if(action==='upsert'){const requested=String(body.conflict||'').split(',').map((v)=>v.trim()).filter((v)=>COLUMN.test(v));const conflict=[...(config.global?[]:['tenant_id','module_id']),...requested];if(!config.singleton&&'id'in record&&!conflict.includes('id'))conflict.push('id');const update=cols.filter((c)=>!conflict.includes(c));if(conflict.length&&update.length)sql+=` ON CONFLICT(${conflict.join(',')}) DO UPDATE SET ${update.map((c)=>`${c}=excluded.${c}`).join(',')}`}await db.prepare(sql).bind(...entries.map(([,v])=>scalar(v))).run()}
}
async function selectCurrent(db,table,config,id,scope){if(config.global)return await db.prepare(`SELECT * FROM ${config.read} WHERE id=? LIMIT 1`).bind(id).first()||{};return await db.prepare(`SELECT * FROM ${config.read} WHERE tenant_id=? AND module_id=? AND id=? LIMIT 1`).bind(scope.tenantId,scope.moduleId,id).first()||{}}

async function mutate(db, table, config, action, body, scope) {
  if(table==='settings')return mutateSettings(db,obj(body.payload),scope)
  if(table==='clients')return mutateClients(db,action,body,scope)
  if(table==='products')return mutateProducts(db,action,body,scope)
  if(table==='petshop_services')return mutateServices(db,action,body,scope)
  if(table==='appointments')return mutateAppointments(db,action,body,scope)
  return genericMutation(db,table,config,action,body,scope)
}

async function query(request, env) {
  const auth=await resolveScope(request,env);if(auth.error)return auth.error
  let body;try{body=await request.json()}catch{return json({code:'INVALID_JSON'},400)}
  const table=String(body.table||''),config=TABLES[table];if(!config)return json({code:'COMPAT_TABLE_NOT_ALLOWED',table},400)
  const action=String(body.action||'select').toLowerCase();if(!['select','insert','update','upsert','delete'].includes(action))return json({code:'INVALID_ACTION'},400)
  try{
    if(action!=='select')await mutate(env.DB,table,config,action,body,auth.scope)
    const selected=await selectRows(env.DB,table,config,body,auth.scope),mode=String(body.mode||'many')
    if(mode==='single'){if(selected.rows.length!==1)return json({code:'ROW_NOT_SINGLE',count:selected.count},406);return json({data:selected.rows[0],count:selected.count})}
    if(mode==='maybeSingle'){if(selected.rows.length>1)return json({code:'ROW_NOT_SINGLE',count:selected.count},406);return json({data:selected.rows[0]||null,count:selected.count})}
    return json({data:selected.rows,count:selected.count})
  }catch(error){const code=error instanceof Error?error.message:'COMPAT_QUERY_FAILED';if(['SCOPE_MISMATCH','INVALID_FILTER','INVALID_ORDER','WRITE_REQUIRES_ID','WRITE_NOT_SUPPORTED','APPOINTMENT_PARTY_REQUIRED','SERVICE_REQUIRED'].includes(code))return json({code},400);console.error('compat.query.failed',{table,action,code});return json({code:'COMPAT_QUERY_FAILED'},500)}
}

async function rpc(request, env) {
  const auth=await resolveScope(request,env);if(auth.error)return auth.error
  let body;try{body=await request.json()}catch{return json({code:'INVALID_JSON'},400)}
  const name=String(body.name||'');if(!ALLOWED_RPCS.has(name))return json({code:'COMPAT_RPC_NOT_ALLOWED',name},400)
  const args=obj(body.args);if(str(args.p_tenant_id)&&str(args.p_tenant_id)!==auth.scope.tenantId)return json({code:'SCOPE_MISMATCH'},400);if(str(args.p_module_id)&&str(args.p_module_id).toLowerCase()!==auth.scope.moduleId)return json({code:'SCOPE_MISMATCH'},400)
  const start=nullableEpoch(args.p_start)||0,end=nullableEpoch(args.p_end)||Date.now()
  const result=await env.DB.prepare(`SELECT COALESCE(responsible_staff_key,groomer_id,employee_id,'unassigned') AS staff_key,COALESCE(responsible_staff_name,responsible_staff_key,groomer_id,employee_id,'Nao atribuido') AS collaborator_name,COUNT(*) AS service_count,SUM(CASE WHEN service_group='banho_tosa' THEN 1 ELSE 0 END) AS grooming_count,SUM(CASE WHEN service_group<>'banho_tosa' OR service_group IS NULL THEN 1 ELSE 0 END) AS other_service_count,SUM(subtotal_cents)/100.0 AS service_revenue,SUM(CASE WHEN service_group='banho_tosa' THEN subtotal_cents ELSE 0 END)/100.0 AS grooming_revenue,SUM(CASE WHEN service_group<>'banho_tosa' OR service_group IS NULL THEN subtotal_cents ELSE 0 END)/100.0 AS other_service_revenue,0.0 AS grooming_commission,0.0 AS other_service_commission,0.0 AS total_commission,0 AS sales_count,0 AS motoboy_count,0.0 AS sales_revenue,0.0 AS motoboy_revenue,0.0 AS sales_commission,0.0 AS motoboy_commission FROM appointments WHERE tenant_id=?1 AND module_id=?2 AND status='completed' AND scheduled_at_ms BETWEEN ?3 AND ?4 GROUP BY 1,2 ORDER BY service_revenue DESC,collaborator_name`).bind(auth.scope.tenantId,auth.scope.moduleId,start,end).all()
  return json({data:result.results})
}

export async function handleCompatApiRequest(request, env) {
  const path=new URL(request.url).pathname
  if(path==='/api/compat/query'&&request.method==='POST')return query(request,env)
  if(path==='/api/compat/rpc'&&request.method==='POST')return rpc(request,env)
  if(path.startsWith('/api/compat/'))return json({code:'NOT_FOUND'},404)
  return null
}
export const COMPAT_TABLE_NAMES=Object.freeze(Object.keys(TABLES))
