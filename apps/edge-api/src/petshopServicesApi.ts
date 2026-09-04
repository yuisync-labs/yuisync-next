import { getBetterAuthSession, type BetterAuthRuntimeBindings } from './auth/betterAuthRuntime'

type Bindings = BetterAuthRuntimeBindings & { DB?: D1Database }

type Scope = {
  tenantId: string
  moduleId: string
}

type ServiceRow = {
  id: string
  code: string
  name: string
  category: string | null
  description: string | null
  group_type: string
  default_price_cents: number
  default_duration_min: number
  commission_type: string
  commission_basis_points: number
  min_weight_kg: number | null
  max_weight_kg: number | null
  species_target: string | null
  sort_order: number
  icon: string | null
  source_product_id: string | null
  status: string
  created_at_ms: number
  updated_at_ms: number
}

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/
const MODULE = /^[a-z0-9][a-z0-9_-]{0,63}$/

function json(body: unknown, status = 200, headers?: HeadersInit): Response {
  return Response.json(body, {
    status,
    headers: {
      'cache-control': 'no-store',
      ...Object.fromEntries(new Headers(headers).entries()),
    },
  })
}

function text(value: unknown): string | null {
  const normalized = String(value ?? '').trim()
  return normalized || null
}

function optionalNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : Number.NaN
}

function hasModuleAccess(role: string, rawPermissions: string, moduleId: string): boolean {
  if (role === 'owner' || role === 'admin') return true
  try {
    const permissions = JSON.parse(rawPermissions || '{}') as Record<string, unknown>
    return permissions['*'] === true
      || permissions[moduleId] === true
      || Boolean(permissions[moduleId] && typeof permissions[moduleId] === 'object')
  } catch {
    return false
  }
}

async function resolveScope(request: Request, bindings: Bindings): Promise<{ scope?: Scope; error?: Response }> {
  if (!bindings.DB) return { error: json({ code: 'DATABASE_NOT_CONFIGURED' }, 503) }

  const tenantId = text(request.headers.get('x-tenant-id'))
  const moduleId = text(request.headers.get('x-module-id'))?.toLowerCase() || null
  if (!tenantId || !moduleId || !ID.test(tenantId) || !MODULE.test(moduleId)) {
    return { error: json({ code: 'INVALID_SCOPE' }, 400) }
  }

  const session = await getBetterAuthSession(request, bindings)
  const userId = text(session?.user?.id)
  if (!userId) return { error: json({ code: 'UNAUTHENTICATED' }, 401) }

  const principal = await bindings.DB
    .prepare("SELECT id FROM identity_principals WHERE provider='better-auth' AND subject=?1 AND status='active' LIMIT 1")
    .bind(userId)
    .first<{ id: string }>()
  if (!principal?.id) return { error: json({ code: 'FORBIDDEN' }, 403) }

  const membership = await bindings.DB
    .prepare("SELECT role,module_permissions_json FROM tenant_memberships WHERE tenant_id=?1 AND principal_id=?2 AND status='active' LIMIT 1")
    .bind(tenantId, principal.id)
    .first<{ role: string; module_permissions_json: string }>()
  if (!membership || !hasModuleAccess(membership.role, membership.module_permissions_json, moduleId)) {
    return { error: json({ code: 'FORBIDDEN' }, 403) }
  }

  return { scope: { tenantId, moduleId } }
}

function servicePayload(row: ServiceRow) {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    category: row.category,
    description: row.description,
    group_type: row.group_type,
    default_price: Number(row.default_price_cents || 0) / 100,
    default_duration_min: Number(row.default_duration_min || 60),
    commission_type: row.commission_type || 'percentage',
    commission_rate: Number(row.commission_basis_points || 0) / 100,
    min_weight_kg: row.min_weight_kg,
    max_weight_kg: row.max_weight_kg,
    species_target: row.species_target,
    sort_order: Number(row.sort_order || 999),
    icon: row.icon,
    source_product_id: row.source_product_id,
    active: row.status === 'active',
    created_at: new Date(row.created_at_ms).toISOString(),
    updated_at: new Date(row.updated_at_ms).toISOString(),
  }
}

async function patchServiceRules(request: Request, bindings: Bindings, serviceId: string): Promise<Response> {
  const resolved = await resolveScope(request, bindings)
  if (resolved.error) return resolved.error
  const { tenantId, moduleId } = resolved.scope!

  let body: Record<string, unknown>
  try {
    const parsed = await request.json()
    body = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {}
  } catch {
    return json({ code: 'INVALID_JSON' }, 400)
  }

  const current = await bindings.DB!.prepare(`
    SELECT id,group_type
    FROM services
    WHERE tenant_id=?1 AND module_id=?2 AND id=?3
    LIMIT 1
  `).bind(tenantId, moduleId, serviceId).first<{ id: string; group_type: string }>()
  if (!current) return json({ code: 'SERVICE_NOT_FOUND' }, 404)

  const commissionRate = Number(body.commission_rate)
  if (!Number.isFinite(commissionRate) || commissionRate < 0 || commissionRate > 100) {
    return json({ code: 'INVALID_COMMISSION_RATE' }, 400)
  }

  const bathGrooming = current.group_type === 'banho_tosa'
  const minWeight = bathGrooming ? optionalNumber(body.min_weight_kg) : null
  const maxWeight = bathGrooming ? optionalNumber(body.max_weight_kg) : null
  if (Number.isNaN(minWeight) || (minWeight !== null && minWeight < 0)) {
    return json({ code: 'INVALID_MIN_WEIGHT' }, 400)
  }
  if (Number.isNaN(maxWeight) || (maxWeight !== null && maxWeight < 0)) {
    return json({ code: 'INVALID_MAX_WEIGHT' }, 400)
  }
  if (minWeight !== null && maxWeight !== null && maxWeight < minWeight) {
    return json({ code: 'INVALID_WEIGHT_RANGE' }, 400)
  }

  const rawSpecies = text(body.species_target)?.toLowerCase() || null
  const speciesTarget = bathGrooming && rawSpecies && rawSpecies !== 'all' ? rawSpecies : null
  if (speciesTarget && speciesTarget !== 'dog' && speciesTarget !== 'cat') {
    return json({ code: 'INVALID_SPECIES_TARGET' }, 400)
  }

  const now = Date.now()
  await bindings.DB!.prepare(`
    UPDATE services
    SET commission_type='percentage',
        commission_basis_points=?4,
        min_weight_kg=?5,
        max_weight_kg=?6,
        species_target=?7,
        updated_at_ms=?8
    WHERE tenant_id=?1 AND module_id=?2 AND id=?3
  `).bind(
    tenantId,
    moduleId,
    serviceId,
    Math.round(commissionRate * 100),
    minWeight,
    maxWeight,
    speciesTarget,
    now,
  ).run()

  const updated = await bindings.DB!.prepare(`
    SELECT id,code,name,category,description,group_type,default_price_cents,default_duration_min,
           commission_type,commission_basis_points,min_weight_kg,max_weight_kg,species_target,
           sort_order,icon,source_product_id,status,created_at_ms,updated_at_ms
    FROM services
    WHERE tenant_id=?1 AND module_id=?2 AND id=?3
    LIMIT 1
  `).bind(tenantId, moduleId, serviceId).first<ServiceRow>()

  return json({ service: updated ? servicePayload(updated) : null })
}

export async function handlePetshopServicesApiRequest(
  request: Request,
  bindings: Bindings,
): Promise<Response | null> {
  const { pathname } = new URL(request.url)
  const collection = /^\/api\/petshop\/services\/?$/.test(pathname)
  const item = /^\/api\/petshop\/services\/([^/]+)\/?$/.exec(pathname)
  if (collection || item) {
    const serviceId = item ? decodeURIComponent(item[1]) : null
    if (serviceId && !ID.test(serviceId)) return json({ code: 'INVALID_SERVICE_ID' }, 400)
    const resolved = await resolveScope(request, bindings)
    if (resolved.error) return resolved.error
    const { tenantId, moduleId } = resolved.scope!
    if (request.method === 'GET') {
      const params = new URL(request.url).searchParams
      const limit = Math.max(1, Math.min(200, Number(params.get('limit') || 200)))
      const cursor = params.get('cursor') || ''
      const active = params.get('activeOnly') === 'true'
      const rows = await bindings.DB!.prepare(`SELECT * FROM services
        WHERE tenant_id=?1 AND module_id=?2 AND (?3 IS NULL OR id=?3)
          AND id>?4 AND (?5=0 OR status='active') ORDER BY id LIMIT ?6`)
        .bind(tenantId, moduleId, serviceId, cursor, active ? 1 : 0, limit + 1).all<ServiceRow>()
      if (serviceId) return rows.results[0] ? json({ service: servicePayload(rows.results[0]) }) : json({ code: 'SERVICE_NOT_FOUND' }, 404)
      return json({ services: rows.results.slice(0, limit).map(servicePayload), nextCursor: rows.results.length > limit ? rows.results[limit - 1].id : null })
    }
    if ((collection && request.method === 'POST') || (serviceId && request.method === 'PATCH')) {
      let body: Record<string, unknown>
      try {
        const value = await request.json()
        if (!value || typeof value !== 'object' || Array.isArray(value)) return json({ code: 'INVALID_SERVICE' }, 400)
        body = value as Record<string, unknown>
      } catch { return json({ code: 'INVALID_JSON' }, 400) }
      const allowed = new Set(['code','name','category','description','group_type','default_price','default_duration_min','commission_type','commission_rate','min_weight_kg','max_weight_kg','species_target','sort_order','icon','active'])
      if (Object.keys(body).some((key) => !allowed.has(key))) return json({ code: 'INVALID_SERVICE_FIELDS' }, 400)
      const current = serviceId ? await bindings.DB!.prepare('SELECT * FROM services WHERE tenant_id=?1 AND module_id=?2 AND id=?3').bind(tenantId,moduleId,serviceId).first<ServiceRow>() : null
      if (serviceId && !current) return json({ code: 'SERVICE_NOT_FOUND' }, 404)
      const merged = { ...(current ? servicePayload(current) : {}), ...body }
      const name = text(merged.name), code = text(merged.code)
      const price = Number(merged.default_price || 0), duration = Number(merged.default_duration_min || 60)
      const rate = Number(merged.commission_rate || 0), group = text(merged.group_type) || 'banho_tosa'
      const min = optionalNumber(merged.min_weight_kg), max = optionalNumber(merged.max_weight_kg)
      const species = text(merged.species_target), sort = Number(merged.sort_order ?? 999)
      if (!name || !code || !Number.isFinite(price) || price < 0 || !Number.isInteger(duration) || duration < 1 || duration > 1440
        || !Number.isFinite(rate) || rate < 0 || rate > 100 || !Number.isFinite(sort)
        || (min !== null && (!Number.isFinite(min) || min < 0)) || (max !== null && (!Number.isFinite(max) || max < 0))
        || (min !== null && max !== null && min > max) || (species && !['dog','cat','all'].includes(species))
        || !['banho_tosa','veterinaria','motoboy','outro'].includes(group)) return json({ code: 'INVALID_SERVICE' }, 400)
      const id = serviceId || crypto.randomUUID(), now = Date.now()
      await bindings.DB!.prepare(`INSERT INTO services(tenant_id,module_id,id,code,name,category,description,group_type,default_price_cents,default_duration_min,
        commission_type,commission_basis_points,min_weight_kg,max_weight_kg,species_target,sort_order,icon,source_product_id,status,created_at_ms,updated_at_ms)
        VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,'percentage',?11,?12,?13,?14,?15,?16,?17,?18,?19,?20)
        ON CONFLICT(tenant_id,module_id,id) DO UPDATE SET code=excluded.code,name=excluded.name,category=excluded.category,description=excluded.description,
        group_type=excluded.group_type,default_price_cents=excluded.default_price_cents,default_duration_min=excluded.default_duration_min,
        commission_type=excluded.commission_type,commission_basis_points=excluded.commission_basis_points,min_weight_kg=excluded.min_weight_kg,
        max_weight_kg=excluded.max_weight_kg,species_target=excluded.species_target,sort_order=excluded.sort_order,icon=excluded.icon,status=excluded.status,updated_at_ms=excluded.updated_at_ms`)
        .bind(tenantId,moduleId,id,code,name,text(merged.category),text(merged.description),group,Math.round(price*100),duration,Math.round(rate*100),min,max,species === 'all' ? null : species,sort,text(merged.icon),current?.source_product_id || null,merged.active === false ? 'inactive' : 'active',current?.created_at_ms || now,now).run()
      const saved = await bindings.DB!.prepare('SELECT * FROM services WHERE tenant_id=?1 AND module_id=?2 AND id=?3').bind(tenantId,moduleId,id).first<ServiceRow>()
      return json({ service: servicePayload(saved!) }, serviceId ? 200 : 201)
    }
    return json({ code: 'METHOD_NOT_ALLOWED' }, 405)
  }
  const match = /^\/api\/petshop\/services\/([^/]+)\/rules$/.exec(pathname)
  if (!match) return null

  const serviceId = decodeURIComponent(match[1])
  if (!ID.test(serviceId)) return json({ code: 'INVALID_SERVICE_ID' }, 400)
  if (request.method === 'PATCH') return patchServiceRules(request, bindings, serviceId)
  return json({ code: 'METHOD_NOT_ALLOWED' }, 405, { allow: 'PATCH' })
}
