import { isVisualPreviewSession } from '../../../lib/visualPreview'

const API_BASE = (import.meta.env.VITE_API_URL || '/api').replace(/\/$/, '')

const ERROR_MESSAGES = Object.freeze({
  INVALID_RESPONSIBLE_STAFF: 'Selecione um responsável válido.',
  APPOINTMENT_NOT_FOUND: 'Este atendimento não foi encontrado. Atualize a página e tente novamente.',
  APPOINTMENT_NOT_COMPLETED: 'Somente atendimentos concluídos podem entrar no fechamento de comissões.',
  APPOINTMENT_RESPONSIBLE_ALREADY_ASSIGNED: 'Este atendimento já possui responsável.',
  APPOINTMENT_RESPONSIBLE_CONCURRENT_CHANGE: 'O atendimento mudou enquanto você atribuía o responsável. Atualize a página e tente novamente.',
  RESPONSIBLE_ASSIGNMENT_FORBIDDEN: 'Seu acesso não permite alterar o fechamento de comissões.',
  PET_NOT_FOUND: 'O pet selecionado não foi encontrado. Atualize os clientes e tente novamente.',
  INVALID_DATE_RANGE: 'O período selecionado para a agenda é inválido.',
})

function commandError(payload, status) {
  const code = String(payload?.code || '').trim()
  const error = new Error(ERROR_MESSAGES[code] || payload?.message || code || 'Não foi possível atribuir o responsável.')
  error.code = code
  error.status = status
  error.details = payload
  return error
}

export async function assignAppointmentResponsibleCommand({
  tenantId,
  moduleId = 'petshop',
  appointmentId,
  staffKey,
  staffName,
}) {
  if (isVisualPreviewSession()) throw commandError({ code: 'VISUAL_PREVIEW_READ_ONLY' }, 409)

  const response = await fetch(`${API_BASE}/petshop/appointments/${encodeURIComponent(appointmentId)}/responsible`, {
    method: 'PATCH',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      'x-tenant-id': tenantId,
      'x-module-id': moduleId,
    },
    body: JSON.stringify({
      responsible_staff_key: staffKey,
      responsible_staff_name: staffName,
    }),
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw commandError(payload, response.status)
  return payload.appointment
}

async function appointmentRequest(path, { tenantId, moduleId = 'petshop', method = 'GET', body } = {}) {
  if (isVisualPreviewSession()) {
    if (method === 'GET') return method === 'GET' && path === '' ? { appointments: [] } : { appointment: null }
    throw commandError({ code: 'VISUAL_PREVIEW_READ_ONLY' }, 409)
  }
  const response = await fetch(`${API_BASE}/petshop/appointments${path}`, {
    method,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      'x-tenant-id': tenantId,
      'x-module-id': moduleId,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw commandError(payload, response.status)
  return payload
}

export async function listAppointmentsCommand({ tenantId, moduleId = 'petshop', filters = {} }) {
  const params = new URLSearchParams()
  Object.entries(filters).forEach(([key, value]) => {
    if (value !== null && value !== undefined && value !== '') params.set(key, String(value))
  })
  const query = params.size ? `?${params.toString()}` : ''
  const payload = await appointmentRequest(query, { tenantId, moduleId })
  return payload.appointments || []
}

export async function getAppointmentCommand({ tenantId, moduleId = 'petshop', appointmentId }) {
  const payload = await appointmentRequest(`/${encodeURIComponent(appointmentId)}`, { tenantId, moduleId })
  return payload.appointment || null
}

export async function createAppointmentCommand({ tenantId, moduleId = 'petshop', payload }) {
  const result = await appointmentRequest('', { tenantId, moduleId, method: 'POST', body: payload })
  return result.appointment
}

export async function updateAppointmentCommand({ tenantId, moduleId = 'petshop', appointmentId, payload }) {
  const result = await appointmentRequest(`/${encodeURIComponent(appointmentId)}`, { tenantId, moduleId, method: 'PATCH', body: payload })
  return result.appointment
}

export async function removeAppointmentCommand({ tenantId, moduleId = 'petshop', appointmentId }) {
  return appointmentRequest(`/${encodeURIComponent(appointmentId)}`, { tenantId, moduleId, method: 'DELETE' })
}
