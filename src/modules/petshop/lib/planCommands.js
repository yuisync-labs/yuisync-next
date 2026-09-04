import { updateAppointmentCommand } from './appointmentCommands'
import { isVisualPreviewSession } from '../../../lib/visualPreview'

const API_BASE = (import.meta.env.VITE_API_URL || '/api').replace(/\/$/, '')

async function nativeRequest(path, { tenantId, moduleId = 'petshop', ...options } = {}) {
  if (isVisualPreviewSession()) {
    if ((options.method || 'GET').toUpperCase() === 'GET') {
      return path.includes('/subscriptions') ? { subscriptions: [] } : { plans: [] }
    }
    const previewError = new Error('O modo visual local não salva alterações.')
    previewError.code = 'VISUAL_PREVIEW_READ_ONLY'
    throw previewError
  }

  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      'x-tenant-id': tenantId,
      'x-module-id': moduleId,
      ...(options.headers || {}),
    },
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    const error = new Error(payload.message || payload.error?.message || payload.code || 'Falha na operação do pacote.')
    error.code = payload.code || payload.error?.code || ''
    error.status = response.status
    error.details = payload
    throw error
  }
  return payload
}

export function loadPlansCommand({ tenantId, moduleId = 'petshop' }) {
  return nativeRequest('/petshop/plans', { tenantId, moduleId, method: 'GET' })
    .then((result) => result.plans || [])
}

export function loadSubscriptionsCommand({ tenantId, moduleId = 'petshop' }) {
  return nativeRequest('/petshop/subscriptions', { tenantId, moduleId, method: 'GET' })
    .then((result) => result.subscriptions || [])
}

export function savePlanCommand({ tenantId, moduleId = 'petshop', id, ...payload }) {
  const path = id ? `/petshop/plans/${encodeURIComponent(id)}` : '/petshop/plans'
  return nativeRequest(path, {
    tenantId,
    moduleId,
    method: id ? 'PATCH' : 'POST',
    body: JSON.stringify(payload),
  }).then((result) => result.plan)
}

export function saveSubscriptionCommand({ tenantId, moduleId = 'petshop', id, ...payload }) {
  const path = id ? `/petshop/subscriptions/${encodeURIComponent(id)}` : '/petshop/subscriptions'
  return nativeRequest(path, {
    tenantId,
    moduleId,
    method: id ? 'PATCH' : 'POST',
    body: JSON.stringify(payload),
  }).then((result) => result.subscription)
}

export function updateSubscriptionUsageCommand({ tenantId, moduleId = 'petshop', subscriptionId, servicesUsed }) {
  return nativeRequest(`/petshop/subscriptions/${encodeURIComponent(subscriptionId)}/usage`, {
    tenantId,
    moduleId,
    method: 'PATCH',
    body: JSON.stringify({ services_used: servicesUsed }),
  }).then((result) => result.subscription)
}

export function cancelSubscriptionCommand({ tenantId, moduleId = 'petshop', subscriptionId }) {
  return nativeRequest(`/petshop/subscriptions/${encodeURIComponent(subscriptionId)}/cancel`, {
    tenantId,
    moduleId,
    method: 'POST',
    body: JSON.stringify({}),
  }).then((result) => result.subscription)
}

export async function loadPackageAppointmentsCommand({ tenantId, moduleId = 'petshop', subscriptionId }) {
  return nativeRequest(`/petshop/subscriptions/${encodeURIComponent(subscriptionId)}/appointments`, {
    tenantId,
    moduleId,
    method: 'GET',
  }).then((result) => result.appointments || [])
}

export function withPackageScheduleCommandPayload({ subscription, firstAppointmentAt, plan }) {
  return {
    ...subscription,
    first_appointment_at: firstAppointmentAt,
    plan,
    billing_cycle: plan?.billing_cycle,
  }
}

export async function reschedulePackageAppointmentCommand({ tenantId, moduleId = 'petshop', appointmentId, scheduledAt, source }) {
  return updateAppointmentCommand({ tenantId, moduleId, appointmentId, payload: {
    scheduled_at: scheduledAt,
    source: source || 'package_activation',
  } })
}

export function publishPackageScheduleHint({ subscriptionId, firstAppointmentAt }) {
  if (typeof window === 'undefined') return
  window.sessionStorage.removeItem('yuisync:package-first-appointment-at')
  window.dispatchEvent(new CustomEvent('yuisync:subscription-schedule-saved', {
    detail: { subscriptionId, firstAppointmentAt },
  }))
}
