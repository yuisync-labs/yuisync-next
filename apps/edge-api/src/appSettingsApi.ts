import { getBetterAuthSession, type BetterAuthRuntimeBindings } from './auth/betterAuthRuntime'

type AppSettingsBindings = BetterAuthRuntimeBindings & { DB?: D1Database }
type SessionResolver = typeof getBetterAuthSession
export type AppSettingsDependencies = { getSession?: SessionResolver }

type MembershipRow = {
  role: string
  status: string
  module_permissions_json: string | null
  tenant_status: string
}

type PrincipalRow = { id: string; status: string }
type CanonicalSettingsRow = {
  store_name: string
  store_phone: string
  store_address: string
  store_neighborhood: string
  store_city: string
  bot_prompt: string
  version: number
  created_at_ms: number
  updated_at_ms: number
}

type ExtensionRow = { data_json: string; updated_at_ms: number }
type ModulePermission = true | string | Record<string, unknown>

type SettingsPatch = {
  business_name?: string
  business_address?: string
  business_phone?: string
  business_email?: string
  business_tax_id?: string
  logo_url?: string | null
  receipt_format?: '58' | '80' | 'a4'
  receipt_footer?: string
}

const ALLOWED_PATCH_FIELDS = new Set([
  'business_name',
  'business_address',
  'business_phone',
  'business_email',
  'business_tax_id',
  'logo_url',
  'receipt_format',
  'receipt_footer',
])

const FIELD_LIMITS: Record<Exclude<keyof SettingsPatch, 'logo_url' | 'receipt_format'>, number> = {
  business_name: 160,
  business_address: 240,
  business_phone: 80,
  business_email: 254,
  business_tax_id: 64,
  receipt_footer: 600,
}

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

function validModule(value: unknown): string | null {
  const normalized = String(value ?? '').trim().toLowerCase()
  return /^[a-z0-9][a-z0-9_-]{0,63}$/.test(normalized) ? normalized : null
}

function permissionsFromJson(raw: string | null | undefined): Record<string, ModulePermission> {
  try {
    const parsed = JSON.parse(raw || '{}')
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, ModulePermission>
      : {}
  } catch {
    return {}
  }
}

function permissionFor(membership: MembershipRow, moduleId: string): ModulePermission | undefined {
  const permissions = permissionsFromJson(membership.module_permissions_json)
  return permissions[moduleId] ?? permissions['*']
}

function hasModuleAccess(membership: MembershipRow, moduleId: string): boolean {
  if (membership.role === 'owner' || membership.role === 'admin') return true
  return Boolean(permissionFor(membership, moduleId))
}

function canAdminModule(membership: MembershipRow, moduleId: string): boolean {
  if (membership.role === 'owner' || membership.role === 'admin') return true
  const permission = permissionFor(membership, moduleId)
  if (typeof permission === 'string') return permission.startsWith('admin_')
  if (permission && typeof permission === 'object') {
    const role = typeof permission.role === 'string' ? permission.role : ''
    return permission.admin === true || role.startsWith('admin_')
  }
  return false
}

async function resolveScope(
  request: Request,
  bindings: AppSettingsBindings,
  dependencies: AppSettingsDependencies,
): Promise<
  | { ok: true; tenantId: string; moduleId: string; membership: MembershipRow }
  | { ok: false; response: Response }
> {
  if (!bindings.DB) return { ok: false, response: json({ code: 'DATABASE_NOT_CONFIGURED' }, 503) }
  const getSession = dependencies.getSession ?? getBetterAuthSession
  const session = await getSession(request, bindings)
  const subject = validId(session?.user?.id, 255)
  if (!session || !subject) return { ok: false, response: json({ code: 'UNAUTHENTICATED' }, 401) }

  const principal = await bindings.DB.prepare(`
    SELECT id, status
    FROM identity_principals
    WHERE provider='better-auth' AND subject=?1
    LIMIT 1
  `).bind(subject).first<PrincipalRow>()
  if (!principal || principal.status !== 'active') return { ok: false, response: json({ code: 'FORBIDDEN' }, 403) }

  const url = new URL(request.url)
  const tenantId = validId(url.searchParams.get('tenant_id'))
  const moduleId = validModule(url.searchParams.get('module_id'))
  if (!tenantId || !moduleId) return { ok: false, response: json({ code: 'INVALID_SCOPE' }, 400) }

  const membership = await bindings.DB.prepare(`
    SELECT m.role, m.status, m.module_permissions_json, t.status AS tenant_status
    FROM tenant_memberships m
    JOIN tenants t ON t.id=m.tenant_id
    WHERE m.tenant_id=?1 AND m.principal_id=?2
    LIMIT 1
  `).bind(tenantId, principal.id).first<MembershipRow>()

  if (
    !membership
    || membership.status !== 'active'
    || membership.tenant_status !== 'active'
    || !hasModuleAccess(membership, moduleId)
  ) {
    return { ok: false, response: json({ code: 'FORBIDDEN' }, 403) }
  }

  return { ok: true, tenantId, moduleId, membership }
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

function extensionString(extensions: Record<string, unknown>, key: string): string {
  return typeof extensions[key] === 'string' ? String(extensions[key]) : ''
}

function normalizeReceiptFormat(value: unknown): '58' | '80' | 'a4' {
  return value === '58' || value === 'a4' ? value : '80'
}

function settingsProjection(canonical: CanonicalSettingsRow, extensions: Record<string, unknown>) {
  const logoUrl = extensionString(extensions, 'logo_url') || extensionString(extensions, 'receipt_logo_data_url')
  const receiptFormat = normalizeReceiptFormat(extensions.receipt_format ?? extensions.printer_width)
  return {
    ...extensions,
    ...canonical,
    business_name: canonical.store_name || '',
    business_address: canonical.store_address || '',
    business_phone: canonical.store_phone || '',
    business_email: extensionString(extensions, 'business_email'),
    business_tax_id: extensionString(extensions, 'business_tax_id'),
    logo_url: logoUrl,
    receipt_format: receiptFormat,
    receipt_footer: extensionString(extensions, 'receipt_footer'),
    // Compatibilidade temporaria para leitores ainda nao migrados.
    store_name: canonical.store_name || '',
    store_address: canonical.store_address || '',
    store_phone: canonical.store_phone || '',
    receipt_logo_data_url: logoUrl,
    printer_width: receiptFormat === '58' ? '58' : '80',
  }
}

async function readSettings(database: D1Database, tenantId: string, moduleId: string) {
  const [canonical, extension] = await Promise.all([
    database.prepare(`
      SELECT store_name, store_phone, store_address, store_neighborhood, store_city,
             bot_prompt, version, created_at_ms, updated_at_ms
      FROM tenant_module_settings
      WHERE tenant_id=?1 AND module_id=?2
      LIMIT 1
    `).bind(tenantId, moduleId).first<CanonicalSettingsRow>(),
    database.prepare(`
      SELECT data_json, updated_at_ms
      FROM module_settings_extensions
      WHERE tenant_id=?1 AND module_id=?2
      LIMIT 1
    `).bind(tenantId, moduleId).first<ExtensionRow>(),
  ])
  if (!canonical) return null
  return settingsProjection(canonical, parseExtensions(extension))
}

function validateLogo(value: unknown): string | null | Response {
  if (value == null || value === '') return null
  if (typeof value !== 'string') return json({ code: 'INVALID_LOGO_URL' }, 400)
  const normalized = value.trim()
  if (!normalized || normalized.length > 210_000) return json({ code: 'INVALID_LOGO_URL' }, 400)
  const isDataImage = /^data:image\/(?:png|jpeg|webp);base64,[a-z0-9+/=\s]+$/i.test(normalized)
  const isHttps = /^https:\/\/[^\s]+$/i.test(normalized)
  const isRootRelative = /^\/(?!\/)[^\s]*$/.test(normalized)
  if (!isDataImage && !isHttps && !isRootRelative) return json({ code: 'INVALID_LOGO_URL' }, 400)
  if (!isDataImage && normalized.length > 2048) return json({ code: 'INVALID_LOGO_URL' }, 400)
  return normalized
}

function validatePatch(body: unknown): { patch: SettingsPatch } | { response: Response } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { response: json({ code: 'INVALID_JSON' }, 400) }
  }
  const entries = Object.entries(body as Record<string, unknown>)
  if (entries.length === 0) return { response: json({ code: 'EMPTY_PATCH' }, 400) }
  for (const [key] of entries) {
    if (!ALLOWED_PATCH_FIELDS.has(key)) {
      return { response: json({ code: 'UNSUPPORTED_SETTING_FIELD', field: key }, 400) }
    }
  }

  const patch: SettingsPatch = {}
  for (const [key, raw] of entries) {
    if (key === 'receipt_format') {
      if (raw !== '58' && raw !== '80' && raw !== 'a4') {
        return { response: json({ code: 'INVALID_RECEIPT_FORMAT' }, 400) }
      }
      patch.receipt_format = raw
      continue
    }
    if (key === 'logo_url') {
      const validated = validateLogo(raw)
      if (validated instanceof Response) return { response: validated }
      patch.logo_url = validated
      continue
    }
    if (typeof raw !== 'string') return { response: json({ code: 'INVALID_SETTING_VALUE', field: key }, 400) }
    const value = raw.trim()
    const max = FIELD_LIMITS[key as keyof typeof FIELD_LIMITS]
    if (value.length > max) return { response: json({ code: 'SETTING_TOO_LONG', field: key }, 400) }
    ;(patch as Record<string, string>)[key] = value
  }
  return { patch }
}

async function getSettings(request: Request, bindings: AppSettingsBindings, dependencies: AppSettingsDependencies): Promise<Response> {
  const scope = await resolveScope(request, bindings, dependencies)
  if (!scope.ok) return scope.response
  const settings = await readSettings(bindings.DB!, scope.tenantId, scope.moduleId)
  if (!settings) return json({ code: 'SETTINGS_NOT_FOUND' }, 404)
  return json({ tenant_id: scope.tenantId, module_id: scope.moduleId, settings })
}

async function patchSettings(request: Request, bindings: AppSettingsBindings, dependencies: AppSettingsDependencies): Promise<Response> {
  const scope = await resolveScope(request, bindings, dependencies)
  if (!scope.ok) return scope.response
  if (!canAdminModule(scope.membership, scope.moduleId)) return json({ code: 'FORBIDDEN' }, 403)

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return json({ code: 'INVALID_JSON' }, 400)
  }
  const validated = validatePatch(body)
  if ('response' in validated) return validated.response

  const database = bindings.DB!
  const canonical = await database.prepare(`
    SELECT store_name, store_phone, store_address, store_neighborhood, store_city,
           bot_prompt, version, created_at_ms, updated_at_ms
    FROM tenant_module_settings
    WHERE tenant_id=?1 AND module_id=?2
    LIMIT 1
  `).bind(scope.tenantId, scope.moduleId).first<CanonicalSettingsRow>()
  if (!canonical) return json({ code: 'SETTINGS_NOT_FOUND' }, 404)

  const extensionRow = await database.prepare(`
    SELECT data_json, updated_at_ms
    FROM module_settings_extensions
    WHERE tenant_id=?1 AND module_id=?2
    LIMIT 1
  `).bind(scope.tenantId, scope.moduleId).first<ExtensionRow>()
  const extensions = parseExtensions(extensionRow)
  const patch = validated.patch
  const now = Date.now()

  const nextCanonical = {
    store_name: patch.business_name ?? canonical.store_name,
    store_phone: patch.business_phone ?? canonical.store_phone,
    store_address: patch.business_address ?? canonical.store_address,
    store_neighborhood: canonical.store_neighborhood,
    store_city: canonical.store_city,
  }

  const extensionFields: Array<keyof SettingsPatch> = [
    'business_email', 'business_tax_id', 'logo_url', 'receipt_format', 'receipt_footer',
  ]
  let extensionsChanged = false
  for (const key of extensionFields) {
    if (!(key in patch)) continue
    extensionsChanged = true
    const value = patch[key]
    if (key === 'logo_url') {
      if (value) {
        extensions.logo_url = value
        extensions.receipt_logo_data_url = value
      } else {
        delete extensions.logo_url
        delete extensions.receipt_logo_data_url
      }
      continue
    }
    if (key === 'receipt_format') {
      extensions.receipt_format = value
      extensions.printer_width = value === '58' ? '58' : '80'
      continue
    }
    extensions[key] = value ?? ''
  }

  const canonicalChanged = 'business_name' in patch || 'business_phone' in patch || 'business_address' in patch
  const statements: D1PreparedStatement[] = []
  if (canonicalChanged) {
    statements.push(database.prepare(`
      UPDATE tenant_module_settings
      SET store_name=?3, store_phone=?4, store_address=?5, store_neighborhood=?6, store_city=?7,
          version=version+1, updated_at_ms=?8
      WHERE tenant_id=?1 AND module_id=?2
    `).bind(
      scope.tenantId,
      scope.moduleId,
      nextCanonical.store_name,
      nextCanonical.store_phone,
      nextCanonical.store_address,
      nextCanonical.store_neighborhood,
      nextCanonical.store_city,
      now,
    ))
  }
  if (extensionsChanged) {
    statements.push(database.prepare(`
      INSERT INTO module_settings_extensions(tenant_id,module_id,data_json,updated_at_ms)
      VALUES(?1,?2,?3,?4)
      ON CONFLICT(tenant_id,module_id) DO UPDATE SET data_json=excluded.data_json, updated_at_ms=excluded.updated_at_ms
    `).bind(scope.tenantId, scope.moduleId, JSON.stringify(extensions), now))
  }
  if (statements.length) await database.batch(statements)

  const saved = await readSettings(database, scope.tenantId, scope.moduleId)
  return json({ tenant_id: scope.tenantId, module_id: scope.moduleId, settings: saved })
}

export async function handleAppSettingsApiRequest(
  request: Request,
  bindings: AppSettingsBindings,
  dependencies: AppSettingsDependencies = {},
): Promise<Response | null> {
  const { pathname } = new URL(request.url)
  if (pathname !== '/api/app/settings') return null
  if (request.method === 'GET') return getSettings(request, bindings, dependencies)
  if (request.method === 'PATCH') return patchSettings(request, bindings, dependencies)
  return json({ code: 'METHOD_NOT_ALLOWED' }, 405, { allow: 'GET, PATCH' })
}
