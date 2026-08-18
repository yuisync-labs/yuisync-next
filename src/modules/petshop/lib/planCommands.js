import { supabase } from '../../../lib/supabase'
import { applyTenantFilter, runWithTenantFallback } from '../../../lib/tenant'

const API_BASE = (import.meta.env.VITE_API_URL || '/api').replace(/\/$/, '')

async function nativeRequest(path, { tenantId, moduleId = 'petshop', ...options } = {}) {
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
  const response = await runWithTenantFallback(tenantId, async (includeTenant) => {
    let query = supabase
      .from('appointments')
      .select('id,scheduled_at,status,service_type,service_items,notes,source')
      .eq('module_id', moduleId)
      .eq('subscription_id', subscriptionId)
      .order('scheduled_at', { ascending: true })
    query = applyTenantFilter(query, tenantId, includeTenant)
    return query
  })
  if (response.error) throw response.error
  return response.data || []
}

export async function reschedulePackageAppointmentCommand({ tenantId, moduleId = 'petshop', appointmentId, scheduledAt, source }) {
  const response = await supabase.rpc('update_petshop_appointment_transaction', {
    p_appointment_id: appointmentId,
    p_payload: {
      tenant_id: tenantId,
      module_id: moduleId,
      scheduled_at: scheduledAt,
      source: source || 'package_activation',
    },
  })
  if (response.error) throw response.error
  return response.data
}

export function publishPackageScheduleHint({ subscriptionId, firstAppointmentAt }) {
  if (typeof window === 'undefined') return
  window.sessionStorage.removeItem('yuisync:package-first-appointment-at')
  window.dispatchEvent(new CustomEvent('yuisync:subscription-schedule-saved', {
    detail: { subscriptionId, firstAppointmentAt },
  }))
}
