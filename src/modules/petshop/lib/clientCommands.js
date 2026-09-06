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

export async function listClientPetsCommand({ tenantId, moduleId = 'petshop', search = '', limit = 1000 }) {
  const params = new URLSearchParams({ limit: String(limit) })
  if (search) params.set('search', search)
  const payload = await request(`?${params.toString()}`, { tenantId, moduleId })
  return payload.clients || []
}

export async function getClientPetCommand({ tenantId, moduleId = 'petshop', id }) {
  const payload = await request(`/${encodeURIComponent(id)}`, { tenantId, moduleId })
  return payload.client || null
}

export async function createClientPetCommand({ tenantId, moduleId = 'petshop', payload }) {
  const result = await request('', { tenantId, moduleId, method: 'POST', body: payload })
  return result.client
}

export async function updateClientPetCommand({ tenantId, moduleId = 'petshop', id, payload }) {
  const result = await request(`/${encodeURIComponent(id)}`, { tenantId, moduleId, method: 'PATCH', body: payload })
  return result.client
}

export async function removeClientPetCommand({ tenantId, moduleId = 'petshop', id }) {
  return request(`/${encodeURIComponent(id)}`, { tenantId, moduleId, method: 'DELETE' })
}
