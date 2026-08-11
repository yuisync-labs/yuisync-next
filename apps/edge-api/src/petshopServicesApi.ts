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
  const match = /^\/api\/petshop\/services\/([^/]+)\/rules$/.exec(pathname)
  if (!match) return null

  const serviceId = decodeURIComponent(match[1])
  if (!ID.test(serviceId)) return json({ code: 'INVALID_SERVICE_ID' }, 400)
  if (request.method === 'PATCH') return patchServiceRules(request, bindings, serviceId)
  return json({ code: 'METHOD_NOT_ALLOWED' }, 405, { allow: 'PATCH' })
}
