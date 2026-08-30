import { getBetterAuthSession, type BetterAuthRuntimeBindings } from './auth/betterAuthRuntime'
import { appendAppointmentOperationalAudit } from './appointmentOperationalAudit'

type Bindings = BetterAuthRuntimeBindings & { DB?: D1Database }
type Scope = { tenantId: string; moduleId: string; principalId: string }
type AppointmentRow = {
  id: string
  status: string
  responsible_staff_key: string | null
  responsible_staff_name: string | null
  version: number
  updated_at_ms: number
}

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/
const json = (body: unknown, status = 200, headers?: HeadersInit) => Response.json(body, {
  status,
  headers: {
    'cache-control': 'no-store',
    ...Object.fromEntries(new Headers(headers).entries()),
  },
})
const text = (value: unknown) => String(value ?? '').trim()

function hasAdministrativeAccess(role: string, rawPermissions: string | null, moduleId: string): boolean {
  if (role === 'owner' || role === 'admin') return true
  try {
    const permissions = JSON.parse(rawPermissions || '{}') as Record<string, unknown>
    const value = permissions[moduleId] ?? permissions['*']
    if (value === true) return true
    if (typeof value === 'string') return ['admin', 'admin_pet', 'owner'].includes(value)
    if (value && typeof value === 'object') {
      return ['admin', 'admin_pet', 'owner'].includes(text((value as Record<string, unknown>).role))
    }
  } catch {
    return false
  }
  return false
}

async function resolveScope(request: Request, bindings: Bindings): Promise<{ scope?: Scope; error?: Response }> {
  if (!bindings.DB) return { error: json({ code: 'DATABASE_NOT_CONFIGURED' }, 503) }

  const tenantId = text(request.headers.get('x-tenant-id'))
  const moduleId = text(request.headers.get('x-module-id')).toLowerCase()
  if (!ID.test(tenantId) || moduleId !== 'petshop') {
    return { error: json({ code: 'INVALID_SCOPE' }, 400) }
  }

  const session = await getBetterAuthSession(request, bindings)
  const userId = text(session?.user?.id)
  if (!userId) return { error: json({ code: 'UNAUTHENTICATED' }, 401) }

  const membership = await bindings.DB.prepare(`
    SELECT p.id AS principal_id,m.role,m.module_permissions_json
    FROM identity_principals p
    JOIN tenant_memberships m ON m.principal_id=p.id
    WHERE p.provider='better-auth' AND p.subject=?1 AND p.status='active'
      AND m.tenant_id=?2 AND m.status='active'
    LIMIT 1
  `).bind(userId, tenantId).first<{
    principal_id: string
    role: string
    module_permissions_json: string | null
  }>()

  if (!membership || !hasAdministrativeAccess(membership.role, membership.module_permissions_json, moduleId)) {
    return { error: json({ code: 'RESPONSIBLE_ASSIGNMENT_FORBIDDEN' }, 403) }
  }
  return { scope: { tenantId, moduleId, principalId: membership.principal_id } }
}

async function assignResponsible(
  request: Request,
  bindings: Bindings,
  appointmentId: string,
): Promise<Response> {
  const resolved = await resolveScope(request, bindings)
  if (resolved.error) return resolved.error
  const scope = resolved.scope!

  let body: Record<string, unknown>
  try {
    const parsed = await request.json()
    body = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {}
  } catch {
    return json({ code: 'INVALID_JSON' }, 400)
  }

  const staffKey = text(body.responsible_staff_key)
  const staffName = text(body.responsible_staff_name)
  if (!staffKey || staffKey.length > 160 || !staffName || staffName.length > 160) {
    return json({ code: 'INVALID_RESPONSIBLE_STAFF' }, 400)
  }

  const db = bindings.DB!
  const current = await db.prepare(`
    SELECT id,status,responsible_staff_key,responsible_staff_name,version,updated_at_ms
    FROM appointments
    WHERE tenant_id=?1 AND module_id=?2 AND id=?3
    LIMIT 1
  `).bind(scope.tenantId, scope.moduleId, appointmentId).first<AppointmentRow>()

  if (!current) return json({ code: 'APPOINTMENT_NOT_FOUND' }, 404)
  if (current.status !== 'completed') {
    return json({ code: 'APPOINTMENT_NOT_COMPLETED', status: current.status }, 409)
  }
  if (text(current.responsible_staff_key)) {
    return json({ code: 'APPOINTMENT_RESPONSIBLE_ALREADY_ASSIGNED' }, 409)
  }

  const now = Date.now()
  const result = await db.prepare(`
    UPDATE appointments
    SET responsible_staff_key=?5,
        responsible_staff_name=?6,
        version=version+1,
        updated_at_ms=?7
    WHERE tenant_id=?1 AND module_id=?2 AND id=?3 AND version=?4
      AND status='completed'
      AND (responsible_staff_key IS NULL OR trim(responsible_staff_key)='')
  `).bind(
    scope.tenantId,
    scope.moduleId,
    appointmentId,
    current.version,
    staffKey,
    staffName,
    now,
  ).run()

  if (Number(result.meta.changes || 0) !== 1) {
    return json({ code: 'APPOINTMENT_RESPONSIBLE_CONCURRENT_CHANGE' }, 409)
  }

  const updated = await db.prepare(`
    SELECT id,status,responsible_staff_key,responsible_staff_name,version,updated_at_ms
    FROM appointments
    WHERE tenant_id=?1 AND module_id=?2 AND id=?3
    LIMIT 1
  `).bind(scope.tenantId, scope.moduleId, appointmentId).first<AppointmentRow>()

  if (!updated) return json({ code: 'APPOINTMENT_RESPONSIBLE_ASSIGNMENT_FAILED' }, 500)

  await appendAppointmentOperationalAudit(bindings, {
    tenantId: scope.tenantId,
    moduleId: scope.moduleId,
    appointmentId,
    eventType: 'appointment.responsible_assigned',
    transitionVersion: updated.version,
    title: 'Responsável atribuído ao atendimento',
    metadata: {
      responsible_staff_key: staffKey,
      responsible_staff_name: staffName,
      assigned_by_principal_id: scope.principalId,
    },
  })

  return json({ appointment: updated })
}

export async function handleAppointmentResponsibleAssignmentApi(
  request: Request,
  bindings: Bindings,
): Promise<Response | null> {
  const { pathname } = new URL(request.url)
  const match = /^\/api\/petshop\/appointments\/([^/]+)\/responsible\/?$/.exec(pathname)
  if (!match) return null

  const appointmentId = decodeURIComponent(match[1])
  if (!ID.test(appointmentId)) return json({ code: 'INVALID_APPOINTMENT' }, 400)
  if (request.method === 'PATCH') return assignResponsible(request, bindings, appointmentId)
  return json({ code: 'METHOD_NOT_ALLOWED' }, 405, { allow: 'PATCH' })
}
