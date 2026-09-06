const API_BASE = (import.meta.env.VITE_API_URL || '/api').replace(/\/$/, '')

const scopeHeaders = (tenantId, moduleId) => ({
  'Content-Type': 'application/json',
  'x-tenant-id': tenantId,
  'x-module-id': moduleId,
})

async function parseApiResponse(response, fallbackMessage) {
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    const error = new Error(payload.error?.message || payload.error || payload.message || payload.code || fallbackMessage)
    error.status = response.status
    error.code = payload.error?.code || payload.code || ''
    throw error
  }
  return payload
}

export async function loadNativeCashDashboard({ tenantId, moduleId = 'petshop', start, end }) {
  if (!tenantId) throw new Error('Selecione uma empresa ativa antes de carregar o caixa.')
  const params = new URLSearchParams({ start, end })
  const response = await fetch(`${API_BASE}/petshop/cash/dashboard?${params.toString()}`, {
    method: 'GET',
    credentials: 'include',
    headers: scopeHeaders(tenantId, moduleId),
  })
  return parseApiResponse(response, 'Erro ao carregar o caixa.')
}

export async function closeNativeCashRegister({
  tenantId,
  moduleId = 'petshop',
  registerId,
  closingBalance = 0,
  notes = '',
  start,
  end,
}) {
  if (!tenantId) throw new Error('Selecione uma empresa ativa antes de fechar o caixa.')
  if (!registerId) throw new Error('Nenhum caixa aberto encontrado.')
  const response = await fetch(`${API_BASE}/petshop/cash/registers/${encodeURIComponent(registerId)}/close`, {
    method: 'POST',
    credentials: 'include',
    headers: scopeHeaders(tenantId, moduleId),
    body: JSON.stringify({
      closing_balance: Number(closingBalance || 0),
      notes: notes || '',
      start,
      end,
    }),
  })
  return parseApiResponse(response, 'Erro ao fechar o caixa.')
}

export function localDayBounds(date = new Date()) {
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0)
  const end = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999)
  return { start: start.toISOString(), end: end.toISOString() }
}
