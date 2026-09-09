import { getBetterAuthSession, type BetterAuthRuntimeBindings } from './auth/betterAuthRuntime'
import { isPlatformAdmin } from './platformAuthorization'

export type OperationAccess = 'operational' | 'administrative'
type Bindings = BetterAuthRuntimeBindings & { DB?: D1Database }
export type OperationMembership = { role: string; status: string; tenant_status: string; module_permissions_json: string | null }
type Principal = { id: string; email: string | null; status: string }
type TenantStatus = { status: string }

function permissionsFor(row: OperationMembership): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(row.module_permissions_json || '{}')
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null
  } catch {
    return null
  }
}

function roleFromPermission(permission: unknown): string | null {
  if (typeof permission === 'string') return permission
  if (!permission || typeof permission !== 'object' || Array.isArray(permission)) return null
  const role = (permission as Record<string, unknown>).role
  return typeof role === 'string' ? role : null
}

function recognizedModuleAdminRole(moduleId: string): string {
  return moduleId === 'petshop' ? 'admin_pet' : `admin_${moduleId}`
}

function recognizedModuleStaffRole(moduleId: string): string {
  return moduleId === 'petshop' ? 'funcionario_pet' : `funcionario_${moduleId}`
}

export function membershipAllows(row: OperationMembership, moduleId: string, access: OperationAccess): boolean {
  if (row.status !== 'active' || row.tenant_status !== 'active') return false
  if (row.role === 'owner' || row.role === 'admin') return true

  const permissions = permissionsFor(row)
  if (!permissions) return false
  const explicitPermission = permissions[moduleId]
  const wildcardPermission = permissions['*']
  const permissionRole = roleFromPermission(explicitPermission)
  const adminRole = recognizedModuleAdminRole(moduleId)
  const staffRole = recognizedModuleStaffRole(moduleId)

  // Administrative aliases are accepted only from the matching module entry or
  // from the membership role itself. Generic flags and wildcard role strings do
  // not acquire administrative meaning.
  if (row.role === adminRole || permissionRole === adminRole) return true
  if (access === 'administrative') return false

  return row.role === staffRole
    || permissionRole === staffRole
    || explicitPermission === true
    || wildcardPermission === true
}

export async function authorizeOperation(request: Request, bindings: Bindings, access: OperationAccess, getSession = getBetterAuthSession): Promise<Response | null> {
  const fail = (code: string, status: number) => Response.json({ code }, { status, headers: { 'cache-control': 'no-store' } })
  if (!bindings.DB) return fail('DATABASE_NOT_CONFIGURED', 503)
  const tenant = request.headers.get('x-tenant-id') || ''
  const moduleId = request.headers.get('x-module-id') || ''
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(tenant) || moduleId !== 'petshop') return fail('INVALID_SCOPE', 400)
  const session = await getSession(request, bindings)
  if (!session?.user?.id) return fail('UNAUTHENTICATED', 401)
  const membership = await bindings.DB.prepare(`
    SELECT m.role,m.status,m.module_permissions_json,t.status AS tenant_status
    FROM identity_principals p
    JOIN tenant_memberships m ON m.principal_id=p.id
    JOIN tenants t ON t.id=m.tenant_id
    WHERE p.provider='better-auth' AND p.subject=?1 AND p.status='active' AND m.tenant_id=?2 LIMIT 1
  `).bind(session.user.id, tenant).first<OperationMembership>()
  if (membership && membershipAllows(membership, moduleId, access)) return null

  const principal = await bindings.DB.prepare(`
    SELECT id,email,status FROM identity_principals
    WHERE provider='better-auth' AND subject=?1
    LIMIT 1
  `).bind(session.user.id).first<Principal>()
  if (!principal || principal.status !== 'active' || !(await isPlatformAdmin(bindings.DB, principal))) {
    return fail('FORBIDDEN', 403)
  }
  const targetTenant = await bindings.DB.prepare('SELECT status FROM tenants WHERE id=?1 LIMIT 1')
    .bind(tenant).first<TenantStatus>()
  return targetTenant?.status === 'active' ? null : fail('FORBIDDEN', 403)
}

const operationalReads = new Set(['clients', 'pets', 'products', 'petshop_services', 'settings', 'appointments', 'service_delivery_orders', 'sales', 'sale_items', 'sale_payment_splits', 'subscription_plans', 'client_subscriptions', 'cash_register', 'support_threads', 'support_messages', 'chat_sessions', 'chat_messages', 'quick_replies'])
const operationalWrites = new Set(['clients', 'pets', 'appointments', 'service_delivery_orders', 'sales', 'sale_items', 'sale_payment_splits', 'cash_register', 'support_threads', 'support_messages', 'chat_sessions', 'chat_messages'])
const operationalRpcs = new Set(['book_petshop_appointment_transaction', 'update_petshop_appointment_transaction', 'checkout_petshop_appointment_transaction', 'checkout_petshop_subscription_transaction', 'reconcile_petshop_completed_appointment_package'])

export function compatibilityAccess(path: string, body: Record<string, unknown>): OperationAccess {
  if (path === '/api/compat/rpc') return operationalRpcs.has(String(body.name)) ? 'operational' : 'administrative'
  const action = String(body.action || 'select')
  return (action === 'select' ? operationalReads : operationalWrites).has(String(body.table)) ? 'operational' : 'administrative'
}

// Run before dispatch: specialized compatibility handlers must obey the same policy.
export async function authorizePetshopRequest(request: Request, bindings: Bindings, getSession = getBetterAuthSession): Promise<Response | null> {
  const path = new URL(request.url).pathname
  if (path.startsWith('/api/compat/') && request.headers.get('x-module-id') === 'petshop') {
    let body: unknown
    try { body = await request.clone().json() } catch { return Response.json({ code: 'INVALID_JSON' }, { status: 400 }) }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return Response.json({ code: 'INVALID_JSON' }, { status: 400 })
    return authorizeOperation(request, bindings, compatibilityAccess(path, body as Record<string, unknown>), getSession)
  }
  if (!path.startsWith('/api/petshop/') && path !== '/api/app/inventory/adjust') return null
  // Let the specialized handler return its established validation response when
  // no scope was supplied; requests carrying a scope are centrally authorized.
  if (!request.headers.has('x-tenant-id') && !request.headers.has('x-module-id')) return null
  const read = request.method === 'GET'
  const operational = path === '/api/petshop/checkout'
    || /^\/api\/petshop\/(clients|pets)(\/|$)/.test(path)
    || /^\/api\/petshop\/appointments(?:\/[^/]+)?\/?$/.test(path)
    || (read && /^\/api\/petshop\/(services|plans|subscriptions)(\/|$)/.test(path))
  return authorizeOperation(request, bindings, operational ? 'operational' : 'administrative', getSession)
}
