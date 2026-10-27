import { isVisualPreviewSession } from '../../../lib/visualPreview'
import { runVisualPreviewQuery } from '../../../lib/visualPreviewData'

const API_BASE = (import.meta.env.VITE_API_URL || '/api').replace(/\/$/, '')

async function request(path, { tenantId, moduleId = 'petshop', method = 'GET', body } = {}) {
  if (isVisualPreviewSession()) {
    if (method === 'GET') {
      const url = new URL(path || '', 'https://preview.yuisync.local')
      const id = url.pathname.replace(/^\//, '')
      const result = runVisualPreviewQuery({
        table: 'clients',
        filters: id ? [{ op: 'eq', column: 'id', value: decodeURIComponent(id) }] : [],
      })
      const search = String(url.searchParams.get('search') || '').trim().toLocaleLowerCase('pt-BR')
      const limit = Math.min(1000, Math.max(1, Number(url.searchParams.get('limit') || 1000)))
      const clients = (result.data || [])
        .filter((item) => !search || JSON.stringify(item).toLocaleLowerCase('pt-BR').includes(search))
        .slice(0, limit)
        .map((item) => ({
          id: item.id,
          tutor_group_id: item.details?.tutor_group_id || item.id,
          owner_name: item.name || '',
          owner_cpf: item.document || '',
          phone: item.phone || '',
          email: item.email || '',
          tutor_birth_date: item.details?.tutor_birth_date || '',
          owner_address: item.address || '',
          address_number: item.details?.address_number || '',
          address_complement: item.details?.address_complement || '',
          address_reference: item.details?.address_reference || '',
          owner_neighborhood: item.neighborhood || '',
          owner_city: item.city || '',
          zip_code: item.details?.zip_code || '',
          client_notes: item.notes || '',
          pet_name: item.details?.pet_name || '',
          species: item.details?.species || 'other',
          breed: item.details?.breed || '',
          birth_date: item.details?.birth_date || null,
          weight_kg: item.details?.weight_kg ?? null,
          color: item.details?.color || '',
          notes: item.details?.pet_notes || '',
          created_at: item.created_at,
          registration_status: item.details?.registration_status || 'pendente',
        }))
      return id ? { client: clients[0] || null } : { clients }
    }
    const error = new Error('O modo visual local não salva alterações.')
    error.code = 'VISUAL_PREVIEW_READ_ONLY'
    throw error
  }
  const response = await fetch(`${API_BASE}/petshop/clients${path}`, {
    method,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', 'x-tenant-id': tenantId, 'x-module-id': moduleId },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    const error = new Error(payload.message || payload.code || 'Não foi possível salvar o cliente e o pet.')
    error.code = payload.code || ''
    error.status = response.status
    throw error
  }
  return payload
}

// The full tutor+pet list is read by many pages; one copy per store for a short
// time keeps page changes from rereading every pet. Any write clears it.
const fullListCache = new Map()
const FULL_LIST_TTL_MS = 2 * 60_000
export function clearClientPetsCache() { fullListCache.clear() }

export async function listClientPetsCommand({ tenantId, moduleId = 'petshop', search = '', limit = 1000, allPages = false, fresh = false }) {
  const key = allPages && !search ? `${tenantId}:${moduleId}` : null
  const hit = key && !fresh ? fullListCache.get(key) : null
  if (hit && Date.now() - hit.at < FULL_LIST_TTL_MS) return hit.rows
  const rows = await loadClientPets({ tenantId, moduleId, search, limit, allPages })
  if (key) fullListCache.set(key, { at: Date.now(), rows })
  return rows
}

async function loadClientPets({ tenantId, moduleId, search, limit, allPages }) {
  const params = new URLSearchParams({ limit: String(limit) })
  if (search) params.set('search', search)
  if (allPages) params.set('paginate', '1')
  const clients = new Map()
  const cursors = new Set()
  let cursor
  do {
    if (cursor) params.set('after', cursor)
    const payload = await request(`?${params.toString()}`, { tenantId, moduleId })
    if (!Array.isArray(payload.clients)) throw new Error('Não foi possível carregar todos os cadastros. Atualize a lista.')
    for (const client of payload.clients) clients.set(client.id, client)
    cursor = allPages ? payload.next_cursor : null
    if (cursor && cursors.has(cursor)) throw new Error('Não foi possível carregar todos os cadastros. Atualize a lista.')
    if (cursor) cursors.add(cursor)
  } while (cursor)
  const rows = [...clients.values()]
  return allPages ? rows.sort((a, b) => String(a.owner_name || '').localeCompare(String(b.owner_name || ''), 'pt-BR')
    || String(a.pet_name || '').localeCompare(String(b.pet_name || ''), 'pt-BR') || a.id.localeCompare(b.id)) : rows
}

export async function getClientPetCommand({ tenantId, moduleId = 'petshop', id }) {
  const payload = await request(`/${encodeURIComponent(id)}`, { tenantId, moduleId })
  return payload.client || null
}

export async function createClientPetCommand({ tenantId, moduleId = 'petshop', payload }) {
  clearClientPetsCache()
  const result = await request('', { tenantId, moduleId, method: 'POST', body: payload })
  return result.client
}

export async function updateClientPetCommand({ tenantId, moduleId = 'petshop', id, payload }) {
  clearClientPetsCache()
  const result = await request(`/${encodeURIComponent(id)}`, { tenantId, moduleId, method: 'PATCH', body: payload })
  return result.client
}

export async function removeClientPetCommand({ tenantId, moduleId = 'petshop', id }) {
  clearClientPetsCache()
  return request(`/${encodeURIComponent(id)}`, { tenantId, moduleId, method: 'DELETE' })
}

export async function removeTutorCommand({ tenantId, moduleId = 'petshop', id }) {
  clearClientPetsCache()
  return request(`/${encodeURIComponent(id)}?scope=client`, { tenantId, moduleId, method: 'DELETE' })
}
