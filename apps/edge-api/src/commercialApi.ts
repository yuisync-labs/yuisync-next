import { getBetterAuthSession, type BetterAuthRuntimeBindings } from './auth/betterAuthRuntime'
import {
  readUsage,
  resolveCommercialEntitlement,
  resolveCommercialPlan,
  YUI_AI_OUTBOUND_USAGE_KEY,
} from './commercialControlPlane'

type Bindings = BetterAuthRuntimeBindings & { DB?: D1Database }

type PlanCatalogRow = {
  plan_id: string
  plan_name: string
  plan_version_id: string
  currency: string
  monthly_price_cents: number
}

type EntitlementKeyRow = { entitlement_key: string }

type MembershipRow = { role: string; membership_status: string; tenant_status: string }

function json(body: unknown, status = 200, headers?: HeadersInit): Response {
  const finalHeaders = new Headers(headers)
  finalHeaders.set('cache-control', 'no-store')
  return Response.json(body, { status, headers: finalHeaders })
}

function clean(value: unknown, max = 160): string {
  const normalized = String(value ?? '').trim()
  return normalized && normalized.length <= max ? normalized : ''
}

async function authorizeTenant(
  request: Request,
  bindings: Bindings,
  tenantId: string,
): Promise<Response | null> {
  if (!bindings.DB || !bindings.AUTH_DB) return json({ code: 'DATABASE_NOT_CONFIGURED' }, 503)
  const session = await getBetterAuthSession(request, bindings)
  const subject = clean(session?.user?.id, 255)
  if (!subject) return json({ code: 'UNAUTHENTICATED' }, 401)
  const membership = await bindings.DB.prepare(`
    SELECT m.role,m.status AS membership_status,t.status AS tenant_status
    FROM identity_principals p
    JOIN tenant_memberships m ON m.principal_id=p.id AND m.tenant_id=?2
    JOIN tenants t ON t.id=m.tenant_id
    WHERE p.provider='better-auth' AND p.subject=?1 AND p.status='active'
    LIMIT 1
  `).bind(subject, tenantId).first<MembershipRow>()
  if (!membership || membership.membership_status !== 'active' || membership.tenant_status !== 'active') {
    return json({ code: 'FORBIDDEN' }, 403)
  }
  return null
}

async function catalog(bindings: Bindings): Promise<Response> {
  if (!bindings.DB) return json({ code: 'DATABASE_NOT_CONFIGURED' }, 503)
  const result = await bindings.DB.prepare(`
    SELECT p.id AS plan_id,p.name AS plan_name,v.id AS plan_version_id,v.currency,v.monthly_price_cents
    FROM saas_plans p
    JOIN saas_plan_versions v ON v.plan_id=p.id
    WHERE p.status='active' AND v.status='active'
      AND v.effective_from_ms=(
        SELECT MAX(v2.effective_from_ms)
        FROM saas_plan_versions v2
        WHERE v2.plan_id=p.id AND v2.status='active' AND v2.effective_from_ms<=?1
      )
    ORDER BY v.monthly_price_cents,p.id
  `).bind(Date.now()).all<PlanCatalogRow>()

  return json({
    currency: 'BRL',
    plans: (result.results || []).map((row) => ({
      id: row.plan_id,
      name: row.plan_name,
      version_id: row.plan_version_id,
      monthly_price_cents: row.monthly_price_cents,
    })),
  })
}

async function subscription(request: Request, bindings: Bindings): Promise<Response> {
  if (!bindings.DB) return json({ code: 'DATABASE_NOT_CONFIGURED' }, 503)
  const tenantId = clean(new URL(request.url).searchParams.get('tenant_id') || request.headers.get('x-tenant-id'))
  if (!tenantId) return json({ code: 'TENANT_REQUIRED' }, 400)
  const authError = await authorizeTenant(request, bindings, tenantId)
  if (authError) return authError

  const plan = await resolveCommercialPlan(bindings.DB, tenantId)
  const keys = await bindings.DB.prepare(`
    SELECT entitlement_key
    FROM saas_plan_entitlements
    WHERE plan_version_id=?1
    UNION
    SELECT entitlement_key
    FROM tenant_entitlement_overrides
    WHERE tenant_id=?2 AND (effective_until_ms IS NULL OR effective_until_ms>?3)
    ORDER BY entitlement_key
  `).bind(plan.planVersionId, tenantId, Date.now()).all<EntitlementKeyRow>()

  const entitlements = await Promise.all((keys.results || []).map(async ({ entitlement_key }) => {
    const entitlement = await resolveCommercialEntitlement(bindings.DB!, tenantId, entitlement_key)
    return {
      key: entitlement.key,
      enabled: entitlement.enabled,
      quota: entitlement.quota,
      overridden: entitlement.overridden,
    }
  }))

  const yui = await readUsage(bindings.DB, tenantId, YUI_AI_OUTBOUND_USAGE_KEY)

  return json({
    tenant_id: tenantId,
    subscription: {
      plan_id: plan.planId,
      plan_name: plan.planName,
      plan_version_id: plan.planVersionId,
      monthly_price_cents: plan.monthlyPriceCents,
      currency: plan.currency,
      status: plan.subscriptionStatus,
      current_period_start_ms: plan.periodStartMs,
      current_period_end_ms: plan.periodEndMs,
      compatibility_mode: plan.fallback,
    },
    entitlements,
    usage: {
      yui_ai_outbound_messages: {
        included: yui.included,
        consumed: yui.consumed,
        remaining: yui.remaining,
        period_start_ms: yui.periodStartMs,
        period_end_ms: yui.periodEndMs,
      },
    },
  })
}

export async function handleCommercialApiRequest(
  request: Request,
  bindings: Bindings,
): Promise<Response | null> {
  const { pathname } = new URL(request.url)
  if (!pathname.startsWith('/api/commercial/')) return null
  if (pathname === '/api/commercial/plans') {
    if (request.method === 'GET') return catalog(bindings)
    return json({ code: 'METHOD_NOT_ALLOWED' }, 405, { allow: 'GET' })
  }
  if (pathname === '/api/commercial/subscription') {
    if (request.method === 'GET') return subscription(request, bindings)
    return json({ code: 'METHOD_NOT_ALLOWED' }, 405, { allow: 'GET' })
  }
  return json({ code: 'NOT_FOUND' }, 404)
}
