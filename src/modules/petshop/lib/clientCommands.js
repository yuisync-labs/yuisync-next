import { isVisualPreviewSession } from '../../../lib/visualPreview'

const API_BASE = (import.meta.env.VITE_API_URL || '/api').replace(/\/$/, '')

async function request(path, { tenantId, moduleId = 'petshop', method = 'GET', body } = {}) {
  if (isVisualPreviewSession()) {
    if (method === 'GET') return path ? { client: null } : { clients: [] }
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
