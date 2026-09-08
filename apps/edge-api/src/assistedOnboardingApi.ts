import { getBetterAuthSession, type BetterAuthRuntimeBindings } from './auth/betterAuthRuntime'

type Bindings = BetterAuthRuntimeBindings & { DB?: D1Database }
type SessionResolver = typeof getBetterAuthSession
export type AssistedOnboardingDependencies = { getSession?: SessionResolver }

type PrincipalRow = { id: string; status: string }
type ScopeRow = {
  role: string
  status: string
  tenant_status: string
  tenant_name: string
  tenant_slug: string
}
type AdminRow = {
  principal_id: string
  display_name: string | null
  email: string | null
  role: string
}
type ExtensionRow = { data_json: string }
type CountRow = { count: number }
type StaffRow = { key: string; name: string; active: boolean }
type BusinessHours = Record<string, Array<{ open: string; close: string }>>

type ResolvedScope =
  | { ok: true; principalId: string; tenantId: string; tenantName: string; tenantSlug: string }
  | { ok: false; response: Response }

const OPERATIONAL_STAFF_TEMPLATE_KEY = '__petshop_operational_staff'
const COMMISSION_RESET_TEMPLATE_KEY = '__petshop_commission_reset_at'
const TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/

function json(body: unknown, status = 200, headers?: HeadersInit): Response {
  return Response.json(body, {
    status,
    headers: { 'cache-control': 'no-store', ...Object.fromEntries(new Headers(headers).entries()) },
  })
}

function validId(value: unknown, max = 160): string | null {
  const normalized = String(value ?? '').trim()
  return normalized && normalized.length <= max ? normalized : null
}

function parseExtensions(row: ExtensionRow | null): Record<string, unknown> {
  try {
    const parsed = JSON.parse(row?.data_json || '{}')
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {}
  } catch {
    return {}
  }
}

function normalizeKey(value: unknown, index: number): string {
  const normalized = String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
  return normalized || `colaborador-${index + 1}`
}

function normalizeStaff(value: unknown): StaffRow[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > 50) return null
  const result: StaffRow[] = []
  const seen = new Set<string>()
  for (let index = 0; index < value.length; index += 1) {
    const raw = value[index]
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
    const row = raw as Record<string, unknown>
    const name = String(row.name ?? row.full_name ?? '').trim()
    if (!name || name.length > 160) return null
    const key = normalizeKey(row.key ?? row.id ?? name, index)
    if (seen.has(key)) continue
    seen.add(key)
    result.push({ key, name, active: row.active !== false })
  }
  return result.length ? result : null
}

function staffFromExtensions(extensions: Record<string, unknown>): StaffRow[] {
  const templates = extensions.message_templates && typeof extensions.message_templates === 'object' && !Array.isArray(extensions.message_templates)
    ? extensions.message_templates as Record<string, unknown>
    : {}
  return normalizeStaff(extensions.petshop_operational_staff ?? templates[OPERATIONAL_STAFF_TEMPLATE_KEY]) || []
}

function normalizeBusinessHours(value: unknown): BusinessHours | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const source = value as Record<string, unknown>
  const result: BusinessHours = {}
  let openDays = 0
  for (let weekday = 1; weekday <= 7; weekday += 1) {
    const rows = source[String(weekday)]
    if (!Array.isArray(rows) || rows.length > 4) return null
    const normalizedRows: Array<{ open: string; close: string }> = []
    for (const raw of rows) {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
      const row = raw as Record<string, unknown>
      const open = String(row.open ?? '').trim()
      const close = String(row.close ?? '').trim()
      if (!TIME.test(open) || !TIME.test(close) || open >= close) return null
      normalizedRows.push({ open, close })
    }
    if (normalizedRows.length) openDays += 1
    result[String(weekday)] = normalizedRows
  }
  return openDays ? result : null
}

function hoursFromExtensions(extensions: Record<string, unknown>): BusinessHours | null {
  return normalizeBusinessHours(extensions.store_business_hours)
}

function positiveInteger(value: unknown, min: number, max: number): number | null {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : null
}

function commissionReset(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'string' || value.length > 64) return null
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null
}

async function resolveScope(
  request: Request,
  bindings: Bindings,
  dependencies: AssistedOnboardingDependencies,
): Promise<ResolvedScope> {
  if (!bindings.DB) return { ok: false, response: json({ code: 'DATABASE_NOT_CONFIGURED' }, 503) }
  const getSession = dependencies.getSession ?? getBetterAuthSession
  const session = await getSession(request, bindings)
  const subject = validId(session?.user?.id, 255)
  if (!session || !subject) return { ok: false, response: json({ code: 'UNAUTHENTICATED' }, 401) }

  const principal = await bindings.DB.prepare(`
    SELECT id,status FROM identity_principals
    WHERE provider='better-auth' AND subject=?1
    LIMIT 1
  `).bind(subject).first<PrincipalRow>()
  if (!principal || principal.status !== 'active') return { ok: false, response: json({ code: 'FORBIDDEN' }, 403) }

  const tenantId = validId(new URL(request.url).searchParams.get('tenant_id'))
  if (!tenantId) return { ok: false, response: json({ code: 'INVALID_SCOPE' }, 400) }
  const scope = await bindings.DB.prepare(`
    SELECT m.role,m.status,t.status AS tenant_status,t.name AS tenant_name,t.slug AS tenant_slug
    FROM tenant_memberships m
    JOIN tenants t ON t.id=m.tenant_id
    WHERE m.tenant_id=?1 AND m.principal_id=?2
    LIMIT 1
  `).bind(tenantId, principal.id).first<ScopeRow>()
  if (!scope || scope.status !== 'active' || scope.tenant_status !== 'active' || !['owner', 'admin'].includes(scope.role)) {
    return { ok: false, response: json({ code: 'FORBIDDEN' }, 403) }
  }
  return {
    ok: true,
    principalId: principal.id,
    tenantId,
    tenantName: scope.tenant_name,
    tenantSlug: scope.tenant_slug,
  }
}

async function readSnapshot(database: D1Database, scope: Extract<ResolvedScope, { ok: true }>) {
  const [extensionRow, adminsResult, serviceCountRow] = await Promise.all([
    database.prepare(`
      SELECT data_json FROM module_settings_extensions
      WHERE tenant_id=?1 AND module_id='petshop'
      LIMIT 1
    `).bind(scope.tenantId).first<ExtensionRow>(),
    database.prepare(`
      SELECT p.id AS principal_id,p.display_name,p.email,m.role
      FROM tenant_memberships m
      JOIN identity_principals p ON p.id=m.principal_id
      WHERE m.tenant_id=?1 AND m.status='active' AND p.status='active' AND m.role IN ('owner','admin')
      ORDER BY CASE WHEN m.role='owner' THEN 0 ELSE 1 END,COALESCE(NULLIF(TRIM(p.display_name),''),p.email,p.id)
    `).bind(scope.tenantId).all<AdminRow>(),
    database.prepare(`
      SELECT COUNT(*) AS count FROM services
      WHERE tenant_id=?1 AND module_id='petshop' AND status='active'
    `).bind(scope.tenantId).first<CountRow>(),
  ])
  const extensions = parseExtensions(extensionRow)
  const staff = staffFromExtensions(extensions)
  const hours = hoursFromExtensions(extensions)
  const slotInterval = positiveInteger(extensions.petbot_slot_interval_min, 5, 240)
  const leadTime = positiveInteger(extensions.petbot_booking_lead_time_min, 0, 10080)
  const capacity = positiveInteger(extensions.petbot_booking_capacity, 1, 50)
  const administrators = adminsResult.results || []
  const clientAdministrators = administrators.filter((admin) => admin.principal_id !== scope.principalId)
  const serviceCount = Number(serviceCountRow?.count || 0)
  const scheduleReady = Boolean(hours && slotInterval !== null && leadTime !== null && capacity !== null)
  const steps = {
    company: true,
    administrator: clientAdministrators.length > 0,
    team: staff.length > 0,
    catalog: serviceCount > 0,
    schedule: scheduleReady,
  }
  const pending = Object.entries(steps).filter(([, ready]) => !ready).map(([step]) => step)

  return {
    tenant: { id: scope.tenantId, name: scope.tenantName, slug: scope.tenantSlug },
    steps,
    pending,
    review_ready: pending.length === 0,
    administrators: clientAdministrators.map((admin) => ({
      id: admin.principal_id,
      name: admin.display_name || admin.email || '',
      email: admin.email || '',
      role: admin.role,
    })),
    team: staff,
    catalog: { active_service_count: serviceCount },
    schedule: {
      business_hours: hours,
      slot_interval_min: slotInterval,
      booking_lead_time_min: leadTime,
      booking_capacity: capacity,
    },
    safeguards: {
      saas_subscription_created_automatically: false,
      whatsapp_functional: false,
      whatsapp_status: 'not_verified_by_assisted_onboarding',
    },
  }
}

async function patchOnboarding(
  request: Request,
  bindings: Bindings,
  dependencies: AssistedOnboardingDependencies,
): Promise<Response> {
  const scope = await resolveScope(request, bindings, dependencies)
  if (!scope.ok) return scope.response
  let body: Record<string, unknown>
  try {
    const parsed = await request.json()
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return json({ code: 'INVALID_JSON' }, 400)
    body = parsed as Record<string, unknown>
  } catch {
    return json({ code: 'INVALID_JSON' }, 400)
  }

  if (body.step !== 'team' && body.step !== 'schedule') return json({ code: 'INVALID_ONBOARDING_STEP' }, 400)
  const extensionRow = await bindings.DB!.prepare(`
    SELECT data_json FROM module_settings_extensions
    WHERE tenant_id=?1 AND module_id='petshop'
    LIMIT 1
  `).bind(scope.tenantId).first<ExtensionRow>()
  const extensions = parseExtensions(extensionRow)

  if (body.step === 'team') {
    if (Object.keys(body).some((key) => !['step', 'staff', 'commission_reset_at'].includes(key))) return json({ code: 'INVALID_ONBOARDING_FIELDS' }, 400)
    const staff = normalizeStaff(body.staff)
    if (!staff) return json({ code: 'INVALID_OPERATIONAL_STAFF' }, 400)
    extensions.petshop_operational_staff = staff
    const templates = extensions.message_templates && typeof extensions.message_templates === 'object' && !Array.isArray(extensions.message_templates)
      ? { ...(extensions.message_templates as Record<string, unknown>) }
      : {}
    templates[OPERATIONAL_STAFF_TEMPLATE_KEY] = staff
    if ('commission_reset_at' in body) {
      const resetAt = commissionReset(body.commission_reset_at)
      if (!resetAt) return json({ code: 'INVALID_COMMISSION_RESET_AT' }, 400)
      templates[COMMISSION_RESET_TEMPLATE_KEY] = resetAt
    }
    extensions.message_templates = templates
  } else {
    if (Object.keys(body).some((key) => !['step', 'business_hours', 'slot_interval_min', 'booking_lead_time_min', 'booking_capacity'].includes(key))) {
      return json({ code: 'INVALID_ONBOARDING_FIELDS' }, 400)
    }
    const hours = normalizeBusinessHours(body.business_hours)
    const slotInterval = positiveInteger(body.slot_interval_min, 5, 240)
    const leadTime = positiveInteger(body.booking_lead_time_min, 0, 10080)
    const capacity = positiveInteger(body.booking_capacity, 1, 50)
    if (!hours || slotInterval === null || leadTime === null || capacity === null) {
      return json({ code: 'INVALID_SCHEDULE_RULES' }, 400)
    }
    extensions.store_business_hours = hours
    extensions.petbot_business_hours = hours
    extensions.petbot_slot_interval_min = String(slotInterval)
    extensions.petbot_booking_lead_time_min = String(leadTime)
    extensions.petbot_booking_capacity = String(capacity)
  }

  const now = Date.now()
  await bindings.DB!.prepare(`
    INSERT INTO module_settings_extensions(tenant_id,module_id,data_json,updated_at_ms)
    VALUES(?1,'petshop',?2,?3)
    ON CONFLICT(tenant_id,module_id) DO UPDATE SET data_json=excluded.data_json,updated_at_ms=excluded.updated_at_ms
  `).bind(scope.tenantId, JSON.stringify(extensions), now).run()
  return json(await readSnapshot(bindings.DB!, scope))
}

export async function handleAssistedOnboardingApiRequest(
  request: Request,
  bindings: Bindings,
  dependencies: AssistedOnboardingDependencies = {},
): Promise<Response | null> {
  const { pathname } = new URL(request.url)
  if (pathname !== '/api/app/onboarding') return null
  if (request.method === 'GET') {
    const scope = await resolveScope(request, bindings, dependencies)
    if (!scope.ok) return scope.response
    return json(await readSnapshot(bindings.DB!, scope))
  }
  if (request.method === 'PATCH') return patchOnboarding(request, bindings, dependencies)
  return json({ code: 'METHOD_NOT_ALLOWED' }, 405, { allow: 'GET, PATCH' })
}
