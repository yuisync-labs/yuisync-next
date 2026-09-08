import { getBetterAuthSession, type BetterAuthRuntimeBindings } from './auth/betterAuthRuntime'
import { extensionMergeStatement } from './moduleSettingsExtensions'
import { membershipAllows, type OperationAccess, type OperationMembership } from './operationAuthorization'

type AppSettingsBindings = BetterAuthRuntimeBindings & { DB?: D1Database }
type SessionResolver = typeof getBetterAuthSession
export type AppSettingsDependencies = { getSession?: SessionResolver }

type MembershipRow = OperationMembership
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

async function resolveScope(
  request: Request,
  bindings: AppSettingsBindings,
  dependencies: AppSettingsDependencies,
  access: OperationAccess,
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

  if (!membership || !membershipAllows(membership, moduleId, access)) {
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
  const scope = await resolveScope(request, bindings, dependencies, 'operational')
  if (!scope.ok) return scope.response
  const settings = await readSettings(bindings.DB!, scope.tenantId, scope.moduleId)
  if (!settings) return json({ code: 'SETTINGS_NOT_FOUND' }, 404)
  return json({ tenant_id: scope.tenantId, module_id: scope.moduleId, settings })
}

async function patchSettings(request: Request, bindings: AppSettingsBindings, dependencies: AppSettingsDependencies): Promise<Response> {
  const scope = await resolveScope(request, bindings, dependencies, 'administrative')
  if (!scope.ok) return scope.response

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return json({ code: 'INVALID_JSON' }, 400)
  }
  const validated = validatePatch(body)
  if ('response' in validated) return validated.response

  const database = bindings.DB!
  const current = await readSettings(database, scope.tenantId, scope.moduleId)
  if (!current) return json({ code: 'SETTINGS_NOT_FOUND' }, 404)

  const patch = validated.patch
  const now = Date.now()
  const statements: D1PreparedStatement[] = []
  const canonicalChanged = 'business_name' in patch || 'business_phone' in patch || 'business_address' in patch
  if (canonicalChanged) {
    statements.push(database.prepare(`
      UPDATE tenant_module_settings
      SET store_name=CASE WHEN ?3=1 THEN ?4 ELSE store_name END,
          store_phone=CASE WHEN ?5=1 THEN ?6 ELSE store_phone END,
          store_address=CASE WHEN ?7=1 THEN ?8 ELSE store_address END,
          version=version+1,
          updated_at_ms=?9
      WHERE tenant_id=?1 AND module_id=?2
    `).bind(
      scope.tenantId,
      scope.moduleId,
      'business_name' in patch ? 1 : 0,
      patch.business_name ?? '',
      'business_phone' in patch ? 1 : 0,
      patch.business_phone ?? '',
      'business_address' in patch ? 1 : 0,
      patch.business_address ?? '',
      now,
    ))
  }

  const extensionPatch: Record<string, unknown> = {}
  if ('business_email' in patch) extensionPatch.business_email = patch.business_email ?? ''
  if ('business_tax_id' in patch) extensionPatch.business_tax_id = patch.business_tax_id ?? ''
  if ('receipt_footer' in patch) extensionPatch.receipt_footer = patch.receipt_footer ?? ''
  if ('logo_url' in patch) {
    extensionPatch.logo_url = patch.logo_url || null
    extensionPatch.receipt_logo_data_url = patch.logo_url || null
  }
  if ('receipt_format' in patch) {
    extensionPatch.receipt_format = patch.receipt_format
    extensionPatch.printer_width = patch.receipt_format === '58' ? '58' : '80'
  }
  if (Object.keys(extensionPatch).length) {
    statements.push(extensionMergeStatement(database, scope.tenantId, scope.moduleId, extensionPatch, now))
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
