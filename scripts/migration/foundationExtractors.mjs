import { execFile as execFileCallback } from 'node:child_process'
import { resolve } from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

import {
  projectD1Foundation,
  projectSupabaseFoundation,
} from './phase7FoundationProjection.mjs'

const execFileAsync = promisify(execFileCallback)
const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url))
const SUPABASE_PAGE_SIZE = 500
const MAX_SUPABASE_PAGES = 100
const MAX_WRANGLER_OUTPUT_BYTES = 16 * 1024 * 1024

export class FoundationExtractorError extends Error {
  constructor(code, message = 'Foundation extraction could not be completed.') {
    super(message)
    this.name = 'FoundationExtractorError'
    this.code = code
  }
}

function text(value) {
  return value == null ? '' : String(value).trim()
}

function normalizeScope(scope = {}) {
  const tenantId = text(scope.tenant_id)
  const moduleId = text(scope.module_id).toLowerCase()

  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(tenantId)) {
    throw new FoundationExtractorError('INVALID_TENANT_ID')
  }
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(moduleId)) {
    throw new FoundationExtractorError('INVALID_MODULE_ID')
  }

  return { tenant_id: tenantId, module_id: moduleId }
}

function normalizeSnapshotId(value) {
  const snapshotId = text(value)
  if (!snapshotId || snapshotId.length > 200) {
    throw new FoundationExtractorError('INVALID_SNAPSHOT_ID')
  }
  return snapshotId
}

function normalizeSupabaseUrl(value) {
  let url
  try {
    url = new URL(text(value))
  } catch {
    throw new FoundationExtractorError('INVALID_SUPABASE_URL')
  }

  const isLocalhost = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLocalhost)) {
    throw new FoundationExtractorError('INVALID_SUPABASE_URL')
  }

  url.pathname = '/'
  url.search = ''
  url.hash = ''
  return url
}

function normalizeServiceRoleKey(value) {
  const key = text(value)
  if (!key || key.length > 8192 || /\s/.test(key)) {
    throw new FoundationExtractorError('INVALID_SUPABASE_SERVICE_ROLE_KEY')
  }
  return key
}

function responseRows(payload, code) {
  if (!Array.isArray(payload)) throw new FoundationExtractorError(code)
  return payload
}

function physicalProfile(profile) {
  if (!profile || typeof profile !== 'object' || Array.isArray(profile)) return null
  return {
    id: profile.id,
    full_name: profile.full_name,
    email: profile.email,
    role: profile.role,
    active: profile.active,
  }
}

function samePhysicalProfile(left, right) {
  return JSON.stringify(physicalProfile(left)) === JSON.stringify(physicalProfile(right))
}

function mergeProfile(map, profile) {
  const normalized = physicalProfile(profile)
  const id = text(normalized?.id)
  if (!id) return

  const existing = map.get(id)
  if (existing && !samePhysicalProfile(existing, normalized)) {
    throw new FoundationExtractorError('SUPABASE_PROFILE_CONFLICT')
  }
  map.set(id, normalized)
}

function embeddedProfile(value) {
  if (value == null) return null
  if (Array.isArray(value)) {
    if (value.length > 1) throw new FoundationExtractorError('SUPABASE_PROFILE_RELATION_AMBIGUOUS')
    return value[0] || null
  }
  if (typeof value === 'object') return value
  throw new FoundationExtractorError('SUPABASE_PROFILE_RELATION_INVALID')
}

function createSupabaseReader({ supabaseUrl, serviceRoleKey, fetcher = fetch }) {
  const baseUrl = normalizeSupabaseUrl(supabaseUrl)
  const key = normalizeServiceRoleKey(serviceRoleKey)

  async function getRows(path, params, { paginate = false } = {}) {
    const rows = []
    let offset = 0

    for (let page = 0; page < (paginate ? MAX_SUPABASE_PAGES : 1); page += 1) {
      const url = new URL(`/rest/v1/${path}`, baseUrl)
      for (const [name, value] of Object.entries(params)) {
        if (value != null) url.searchParams.set(name, String(value))
      }

      const headers = {
        accept: 'application/json',
        apikey: key,
        authorization: `Bearer ${key}`,
      }
      if (paginate) headers.range = `${offset}-${offset + SUPABASE_PAGE_SIZE - 1}`

      let response
      try {
        response = await fetcher(url, { method: 'GET', headers, redirect: 'error' })
      } catch {
        throw new FoundationExtractorError('SUPABASE_UNAVAILABLE')
      }

      if (!response?.ok) {
        throw new FoundationExtractorError(
          'SUPABASE_READ_FAILED',
          `Supabase read failed with HTTP ${Number(response?.status) || 0}.`,
        )
      }

      let payload
      try {
        payload = await response.json()
      } catch {
        throw new FoundationExtractorError('SUPABASE_RESPONSE_INVALID')
      }

      const pageRows = responseRows(payload, 'SUPABASE_RESPONSE_INVALID')
      rows.push(...pageRows)

      if (!paginate || pageRows.length < SUPABASE_PAGE_SIZE) return rows
      offset += SUPABASE_PAGE_SIZE
    }

    throw new FoundationExtractorError('SUPABASE_PAGINATION_LIMIT_EXCEEDED')
  }

  return { getRows }
}

export async function extractSupabaseFoundationSnapshot({
  supabaseUrl,
  serviceRoleKey,
  snapshotId,
  scope: rawScope,
  fetcher = fetch,
} = {}) {
  const scope = normalizeScope(rawScope)
  const sourceSnapshotId = normalizeSnapshotId(snapshotId)
  const reader = createSupabaseReader({ supabaseUrl, serviceRoleKey, fetcher })

  const [tenantRows, membershipRows, globalAdminRows, settingsRows] = await Promise.all([
    reader.getRows('tenants', {
      select: 'id,name,slug,active',
      id: `eq.${scope.tenant_id}`,
      limit: 2,
    }),
    reader.getRows('profile_tenants', {
      select: 'profile_id,tenant_id,role,active,profiles(id,full_name,email,role,active)',
      tenant_id: `eq.${scope.tenant_id}`,
      order: 'profile_id.asc',
    }, { paginate: true }),
    reader.getRows('profiles', {
      select: 'id,full_name,email,role,active',
      role: 'eq.admin',
      order: 'id.asc',
    }, { paginate: true }),
    reader.getRows('settings', {
      select: 'tenant_id,module_id,store_name,store_phone,store_address,store_neighborhood,store_city,bot_prompt',
      tenant_id: `eq.${scope.tenant_id}`,
      module_id: `eq.${scope.module_id}`,
      limit: 2,
    }),
  ])

  if (tenantRows.length > 1) {
    throw new FoundationExtractorError('SUPABASE_TENANT_DUPLICATE')
  }

  const profilesById = new Map()
  const profileTenants = membershipRows.map((row) => {
    mergeProfile(profilesById, embeddedProfile(row?.profiles))
    return {
      profile_id: row?.profile_id,
      tenant_id: row?.tenant_id,
      role: row?.role,
      active: row?.active,
    }
  })
  for (const profile of globalAdminRows) mergeProfile(profilesById, profile)

  return projectSupabaseFoundation({
    snapshotId: sourceSnapshotId,
    scope,
    tenant: tenantRows[0] || null,
    profiles: [...profilesById.values()],
    profileTenants,
    settings: settingsRows,
  })
}

function sqlText(value, code) {
  const normalized = text(value)
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(normalized)) {
    throw new FoundationExtractorError(code)
  }
  return `'${normalized}'`
}

function sqlModule(value) {
  const normalized = text(value).toLowerCase()
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(normalized)) {
    throw new FoundationExtractorError('INVALID_MODULE_ID')
  }
  return `'${normalized}'`
}

export function buildD1FoundationQueries(rawScope) {
  const scope = normalizeScope(rawScope)
  const tenant = sqlText(scope.tenant_id, 'INVALID_TENANT_ID')
  const moduleId = sqlModule(scope.module_id)

  return Object.freeze({
    tenant: `SELECT id, slug, name, status FROM tenants WHERE id = ${tenant} LIMIT 2`,
    memberships: `SELECT tenant_id, principal_id, status FROM tenant_memberships WHERE tenant_id = ${tenant} ORDER BY principal_id`,
    principals: `SELECT p.id, p.provider, p.subject, p.display_name, p.email, p.status FROM identity_principals AS p INNER JOIN tenant_memberships AS m ON m.principal_id = p.id WHERE m.tenant_id = ${tenant} ORDER BY p.id`,
    settings: `SELECT tenant_id, module_id, store_name, store_phone, store_address, store_neighborhood, store_city, bot_prompt, version, created_at_ms, updated_at_ms FROM tenant_module_settings WHERE tenant_id = ${tenant} AND module_id = ${moduleId} LIMIT 2`,
  })
}

export function parseWranglerD1Json(stdout) {
  let payload
  try {
    payload = JSON.parse(String(stdout || '').trim())
  } catch {
    throw new FoundationExtractorError('D1_RESPONSE_INVALID')
  }

  const envelopes = Array.isArray(payload) ? payload : [payload]
  const rows = []

  for (const envelope of envelopes) {
    if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) {
      throw new FoundationExtractorError('D1_RESPONSE_INVALID')
    }
    if (envelope.success === false) {
      throw new FoundationExtractorError('D1_QUERY_FAILED')
    }
    if (!Array.isArray(envelope.results)) {
      throw new FoundationExtractorError('D1_RESPONSE_INVALID')
    }
    rows.push(...envelope.results)
  }

  return rows
}

export function createWranglerD1ReadOnlyRunner({
  execFile = execFileAsync,
  environment = 'staging',
  binding = 'DB',
  configPath = 'apps/edge-api/wrangler.jsonc',
} = {}) {
  if (environment !== 'staging') {
    throw new FoundationExtractorError('D1_ENVIRONMENT_NOT_ALLOWED')
  }
  if (binding !== 'DB') {
    throw new FoundationExtractorError('D1_BINDING_NOT_ALLOWED')
  }

  const resolvedConfigPath = resolve(REPO_ROOT, configPath)

  return async function runSelect(sql) {
    if (typeof sql !== 'string' || !/^\s*SELECT\b/i.test(sql) || /;/.test(sql)) {
      throw new FoundationExtractorError('D1_NON_SELECT_REJECTED')
    }

    const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm'
    let result
    try {
      result = await execFile(npmCommand, [
        'exec',
        '--workspace', '@yuisync/edge-api',
        '--',
        'wrangler',
        'd1',
        'execute',
        binding,
        '--remote',
        '--env', environment,
        '--config', resolvedConfigPath,
        '--command', sql,
        '--json',
      ], {
        cwd: REPO_ROOT,
        encoding: 'utf8',
        maxBuffer: MAX_WRANGLER_OUTPUT_BYTES,
        windowsHide: true,
      })
    } catch {
      throw new FoundationExtractorError('D1_WRANGLER_FAILED')
    }

    return parseWranglerD1Json(result?.stdout)
  }
}

export async function extractD1FoundationSnapshot({
  snapshotId,
  scope: rawScope,
  runner = createWranglerD1ReadOnlyRunner(),
} = {}) {
  const scope = normalizeScope(rawScope)
  const destinationSnapshotId = normalizeSnapshotId(snapshotId)
  const queries = buildD1FoundationQueries(scope)

  const tenantRows = await runner(queries.tenant)
  if (tenantRows.length > 1) throw new FoundationExtractorError('D1_TENANT_DUPLICATE')

  const [tenantMemberships, identityPrincipals, settings] = await Promise.all([
    runner(queries.memberships),
    runner(queries.principals),
    runner(queries.settings),
  ])

  return projectD1Foundation({
    snapshotId: destinationSnapshotId,
    scope,
    tenant: tenantRows[0] || null,
    identityPrincipals,
    tenantMemberships,
    settings,
  })
}
