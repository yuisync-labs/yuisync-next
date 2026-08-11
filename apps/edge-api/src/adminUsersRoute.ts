import {
  handleAdminUsersApiRequest,
  type AdminUsersApiDependencies,
} from './adminUsersApi'
import { getBetterAuthSession, type BetterAuthRuntimeBindings } from './auth/betterAuthRuntime'

type AdminUsersRouteBindings = BetterAuthRuntimeBindings & {
  DB?: D1Database
  AUTH_DB?: D1Database
}

type PrincipalRow = {
  id: string
  status: string
}

type TargetMembershipSummary = {
  tenant_count: number
  has_global_admin_role: number
}

const USER_EDIT_ROUTE = /^\/api\/admin\/users\/([^/]+)$/

function forbidden(): Response {
  return Response.json({
    error: {
      code: 'FORBIDDEN',
      message: 'Voce nao possui permissao para esta operacao.',
    },
  }, {
    status: 403,
    headers: { 'cache-control': 'no-store' },
  })
}

async function protectSharedCredentialEdit(
  request: Request,
  bindings: AdminUsersRouteBindings,
  dependencies: AdminUsersApiDependencies,
): Promise<Response | null> {
  if (request.method !== 'PATCH' || !bindings.DB) return null

  const match = USER_EDIT_ROUTE.exec(new URL(request.url).pathname)
  if (!match) return null

  const getSession = dependencies.getSession || getBetterAuthSession
  const session = await getSession(request, bindings)
  const subject = String(session?.user?.id || '').trim()
  if (!subject) return null

  const actor = await bindings.DB.prepare(`
    SELECT id,status
    FROM identity_principals
    WHERE provider='better-auth' AND subject=?1
    LIMIT 1
  `).bind(subject).first<PrincipalRow>()
  if (!actor || actor.status !== 'active') return null

  const actorIsGlobalAdmin = Boolean(await bindings.DB.prepare(`
    SELECT 1
    FROM tenant_memberships m
    JOIN tenants t ON t.id=m.tenant_id
    WHERE m.principal_id=?1
      AND m.role='admin'
      AND m.status='active'
      AND t.status='active'
    LIMIT 1
  `).bind(actor.id).first())
  if (actorIsGlobalAdmin) return null

  let principalId: string
  try {
    principalId = decodeURIComponent(match[1]).trim()
  } catch {
    return null
  }
  if (!principalId) return null

  const target = await bindings.DB.prepare(`
    SELECT id
    FROM identity_principals
    WHERE id=?1 AND provider='better-auth'
    LIMIT 1
  `).bind(principalId).first<{ id: string }>()
  if (!target) return null

  const summary = await bindings.DB.prepare(`
    SELECT
      COUNT(DISTINCT tenant_id) AS tenant_count,
      MAX(CASE WHEN role='admin' THEN 1 ELSE 0 END) AS has_global_admin_role
    FROM tenant_memberships
    WHERE principal_id=?1
  `).bind(principalId).first<TargetMembershipSummary>()

  if (Number(summary?.tenant_count || 0) > 1 || Number(summary?.has_global_admin_role || 0) === 1) {
    return forbidden()
  }

  return null
}

export async function handleAdminUsersRoute(
  request: Request,
  bindings: AdminUsersRouteBindings,
  dependencies: AdminUsersApiDependencies = {},
): Promise<Response | null> {
  const guardResponse = await protectSharedCredentialEdit(request, bindings, dependencies)
  if (guardResponse) return guardResponse
  return handleAdminUsersApiRequest(request, bindings, dependencies)
}
