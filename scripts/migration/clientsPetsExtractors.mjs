import {
  createWranglerD1ReadOnlyRunner,
  FoundationExtractorError,
} from './foundationExtractors.mjs'
import {
  projectD1ClientsPets,
  projectSupabaseClientsPets,
} from './phase7ClientsPetsProjection.mjs'

const SUPABASE_PAGE_SIZE = 500
const MAX_SUPABASE_PAGES = 100

export class ClientsPetsExtractorError extends Error {
  constructor(code, message = 'Clients/pets extraction could not be completed.') {
    super(message)
    this.name = 'ClientsPetsExtractorError'
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
    throw new ClientsPetsExtractorError('INVALID_TENANT_ID')
  }
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(moduleId)) {
    throw new ClientsPetsExtractorError('INVALID_MODULE_ID')
  }
  return { tenant_id: tenantId, module_id: moduleId }
}

function snapshotId(value) {
  const normalized = text(value)
  if (!normalized || normalized.length > 200) {
    throw new ClientsPetsExtractorError('INVALID_SNAPSHOT_ID')
  }
  return normalized
}

function normalizeSupabaseUrl(value) {
  let url
  try {
    url = new URL(text(value))
  } catch {
    throw new ClientsPetsExtractorError('INVALID_SUPABASE_URL')
  }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) {
    throw new ClientsPetsExtractorError('INVALID_SUPABASE_URL')
  }
  url.pathname = '/'
  url.search = ''
  url.hash = ''
  return url
}

function normalizeAdminKey(value) {
  const key = text(value)
  if (!key || key.length > 8192 || /\s/.test(key)) {
    throw new ClientsPetsExtractorError('INVALID_SUPABASE_ADMIN_KEY')
  }
  return key
}

async function readSupabaseClients({ supabaseUrl, adminApiKey, scope, fetcher }) {
  const baseUrl = normalizeSupabaseUrl(supabaseUrl)
  const key = normalizeAdminKey(adminApiKey)
  const opaqueSecretKey = key.startsWith('sb_secret_')
  const rows = []

  for (let page = 0; page < MAX_SUPABASE_PAGES; page += 1) {
    const offset = page * SUPABASE_PAGE_SIZE
    const url = new URL('/rest/v1/clients', baseUrl)
    url.searchParams.set('select', 'id,tenant_id,module_id,name,document,phone,email,address,neighborhood,city,notes,active,details,created_at,updated_at')
    url.searchParams.set('tenant_id', `eq.${scope.tenant_id}`)
    url.searchParams.set('module_id', `eq.${scope.module_id}`)
    url.searchParams.set('order', 'id.asc')

    const headers = {
      accept: 'application/json',
      apikey: key,
      range: `${offset}-${offset + SUPABASE_PAGE_SIZE - 1}`,
    }
    if (!opaqueSecretKey) headers.authorization = `Bearer ${key}`

    let response
    try {
      response = await fetcher(url, { method: 'GET', headers, redirect: 'error' })
    } catch {
      throw new ClientsPetsExtractorError('SUPABASE_UNAVAILABLE')
    }
    if (!response?.ok) {
      throw new ClientsPetsExtractorError(
        'SUPABASE_READ_FAILED',
        `Supabase read failed with HTTP ${Number(response?.status) || 0}.`,
      )
    }

    let payload
    try {
      payload = await response.json()
    } catch {
      throw new ClientsPetsExtractorError('SUPABASE_RESPONSE_INVALID')
    }
    if (!Array.isArray(payload)) {
      throw new ClientsPetsExtractorError('SUPABASE_RESPONSE_INVALID')
    }

    rows.push(...payload)
    if (payload.length < SUPABASE_PAGE_SIZE) return rows
  }

  throw new ClientsPetsExtractorError('SUPABASE_PAGINATION_LIMIT_EXCEEDED')
}

export async function extractSupabaseClientsPetsSnapshot({
  supabaseUrl,
  adminApiKey,
  snapshotId: rawSnapshotId,
  scope: rawScope,
  fetcher = fetch,
} = {}) {
  const scope = normalizeScope(rawScope)
  const sourceSnapshotId = snapshotId(rawSnapshotId)
  const clients = await readSupabaseClients({
    supabaseUrl,
    adminApiKey,
    scope,
    fetcher,
  })

  return projectSupabaseClientsPets({
    snapshotId: sourceSnapshotId,
    scope,
    clients,
  })
}

function sqlLiteral(value, code) {
  const normalized = text(value)
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(normalized)) {
    throw new ClientsPetsExtractorError(code)
  }
  return `'${normalized}'`
}

export function buildD1ClientsPetsQueries(rawScope) {
  const scope = normalizeScope(rawScope)
  const tenant = sqlLiteral(scope.tenant_id, 'INVALID_TENANT_ID')
  const moduleId = sqlLiteral(scope.module_id, 'INVALID_MODULE_ID')

  return Object.freeze({
    clients: `SELECT tenant_id, module_id, id, name, document, phone, email, birth_date, address, address_number, address_complement, address_reference, neighborhood, city, postal_code, notes, status, created_at_ms, updated_at_ms FROM clients WHERE tenant_id = ${tenant} AND module_id = ${moduleId} ORDER BY id`,
    pets: `SELECT tenant_id, module_id, id, client_id, name, species, breed, birth_date, weight_kg, color, notes, status, created_at_ms, updated_at_ms FROM pets WHERE tenant_id = ${tenant} AND module_id = ${moduleId} ORDER BY id`,
  })
}

export async function extractD1ClientsPetsSnapshot({
  snapshotId: rawSnapshotId,
  scope: rawScope,
  runner = createWranglerD1ReadOnlyRunner(),
} = {}) {
  const scope = normalizeScope(rawScope)
  const destinationSnapshotId = snapshotId(rawSnapshotId)
  const queries = buildD1ClientsPetsQueries(scope)

  let clients
  let pets
  try {
    ;[clients, pets] = await Promise.all([
      runner(queries.clients),
      runner(queries.pets),
    ])
  } catch (error) {
    if (error instanceof FoundationExtractorError) {
      throw new ClientsPetsExtractorError(error.code)
    }
    throw error
  }

  return projectD1ClientsPets({
    snapshotId: destinationSnapshotId,
    scope,
    clients,
    pets,
  })
}