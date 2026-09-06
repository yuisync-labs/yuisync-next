const API_BASE = (import.meta.env.VITE_API_URL || '/api').replace(/\/$/, '')

export async function loadNativeCashDashboard({ tenantId, moduleId = 'petshop', start, end }) {
  if (!tenantId) throw new Error('Selecione uma empresa ativa antes de carregar o caixa.')
  const params = new URLSearchParams({ start, end })
  const response = await fetch(`${API_BASE}/petshop/cash/dashboard?${params.toString()}`, {
    method: 'GET',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      'x-tenant-id': tenantId,
      'x-module-id': moduleId,
    },
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    const error = new Error(payload.error?.message || payload.error || payload.message || payload.code || 'Erro ao carregar o caixa.')
    error.status = response.status
    error.code = payload.error?.code || payload.code || ''
    throw error
  }
  return payload
}

export function localDayBounds(date = new Date()) {
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0)
  const end = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999)
  return { start: start.toISOString(), end: end.toISOString() }
}
