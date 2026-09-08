import { createManagedUser, listManagedUsers } from './api'

const API_BASE = (import.meta.env.VITE_API_URL || '/api').replace(/\/$/, '')

async function request(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    const error = new Error(payload.error?.message || payload.error || payload.message || payload.code || 'Erro ao processar a solicitação.')
    error.status = response.status
    error.code = payload.error?.code || payload.code || ''
    throw error
  }
  return payload
}

export function createAssistedTenant(name, operationKey) {
  return request('/app/tenants', {
    method: 'POST',
    headers: { 'idempotency-key': operationKey },
    body: JSON.stringify({ name }),
  })
}

export function getAssistedOnboarding(tenantId) {
  const params = new URLSearchParams({ tenant_id: tenantId })
  return request(`/app/onboarding?${params.toString()}`, { method: 'GET' })
}

export function saveAssistedTeam(tenantId, staff, options = {}) {
  const params = new URLSearchParams({ tenant_id: tenantId })
  return request(`/app/onboarding?${params.toString()}`, {
    method: 'PATCH',
    body: JSON.stringify({
      step: 'team',
      staff,
      ...(options.commissionResetAt ? { commission_reset_at: options.commissionResetAt } : {}),
    }),
  })
}

export function saveAssistedSchedule(tenantId, schedule) {
  const params = new URLSearchParams({ tenant_id: tenantId })
  return request(`/app/onboarding?${params.toString()}`, {
    method: 'PATCH',
    body: JSON.stringify({ step: 'schedule', ...schedule }),
  })
}

export async function ensureAssistedAdministrator({ tenantId, fullName, email, password }) {
  const normalizedEmail = String(email || '').trim().toLowerCase()
  const findExisting = async () => {
    const profiles = await listManagedUsers('petshop', { tenantId })
    return profiles.find((profile) => String(profile.email || '').trim().toLowerCase() === normalizedEmail) || null
  }

  const existing = await findExisting()
  if (existing) {
    if (existing.role === 'admin' && existing.active !== false) return existing
    const error = new Error('Este e-mail já pertence a um usuário que não é administrador ativo desta empresa.')
    error.code = 'ONBOARDING_ADMIN_EMAIL_IN_USE'
    throw error
  }

  try {
    const result = await createManagedUser({
      full_name: String(fullName || '').trim(),
      email: normalizedEmail,
      password,
      role: 'admin',
      staff_type: 'gerente',
      permissions: { petshop: 'admin_pet' },
      scopeModuleId: 'petshop',
      tenantIds: [tenantId],
      activeTenantId: tenantId,
    })
    return result.profile
  } catch (error) {
    if (error?.code !== 'EMAIL_ALREADY_EXISTS') throw error
    const raced = await findExisting()
    if (raced?.role === 'admin' && raced.active !== false) return raced
    throw error
  }
}

export async function listAssistedServices(tenantId) {
  const services = []
  let cursor = ''
  do {
    const params = new URLSearchParams({ limit: '200' })
    if (cursor) params.set('cursor', cursor)
    const payload = await request(`/petshop/services?${params.toString()}`, {
      method: 'GET',
      headers: { 'x-tenant-id': tenantId, 'x-module-id': 'petshop' },
    })
    services.push(...(payload.services || []))
    cursor = payload.nextCursor || ''
  } while (cursor)
  return services
}

export async function upsertAssistedService(tenantId, service) {
  const code = String(service.code || '').trim().toLowerCase()
  const services = await listAssistedServices(tenantId)
  const existing = services.find((row) => String(row.code || '').trim().toLowerCase() === code)
  const path = existing
    ? `/petshop/services/${encodeURIComponent(existing.id)}`
    : '/petshop/services'
  const payload = await request(path, {
    method: existing ? 'PATCH' : 'POST',
    headers: { 'x-tenant-id': tenantId, 'x-module-id': 'petshop' },
    body: JSON.stringify(service),
  })
  return payload.service
}
