import { supabase } from '../../../lib/supabase'
import { applyTenantFilter, runWithTenantFallback } from '../../../lib/tenant'

import { buildPackageCommissionAllocation } from '../../../../shared/packageCommissionAllocation.js'
export { buildPackageCommissionAllocation, configuredPackageTransportFee } from '../../../../shared/packageCommissionAllocation.js'

const appointmentHasPackageSignal = (appointment = {}) => {
  const items = Array.isArray(appointment.service_items) ? appointment.service_items : []
  return appointment.subscription_benefit_used === true
    || Number(appointment.price || 0) <= 0.005
    || appointment.source === 'package_activation'
    || items.some((item) => item?.package_covered === true
      || item?.subscription_benefit_used === true
      || item?.benefit_used === true)
}

const appointmentUsesPackage = (appointment = {}) => Boolean(
  appointmentHasPackageSignal(appointment)
  && (appointment.subscription_id || appointment.client_id || appointment.id)
)

function allocationValueForItem(allocation, item = {}) {
  if (!allocation) return 0
  const candidates = [item.code, item.service_code, item.service_type, item.value]
    .map((value) => String(value || '').trim())
    .filter(Boolean)
  for (const candidate of candidates) {
    if (allocation.unit_values.has(candidate)) return allocation.unit_values.get(candidate)
  }
  return allocation.fallback_unit_value || 0
}

function allocationEntryForItem(allocation, item = {}) {
  const entries = Array.isArray(allocation?.service_entries) ? allocation.service_entries : []
  const candidates = new Set([item.code, item.service_code, item.service_type, item.value]
    .map((value) => String(value || '').trim())
    .filter(Boolean))
  return entries.find((entry) => candidates.has(entry.code) || candidates.has(entry.service_type)) || null
}

export function buildPackageCommissionItems({ items = [], allocation } = {}) {
  const sourceItems = Array.isArray(items) ? items : []
  if (!allocation) return sourceItems
  const existingCodes = new Set(sourceItems.flatMap((item) => (
    [item.code, item.service_code, item.service_type, item.value]
      .map((value) => String(value || '').trim())
      .filter(Boolean)
  )))
  const enrichedItems = sourceItems.map((item) => {
    const recordedPackageBase = Number(item?.package_unit_price)
    const hasRecordedPackageBase = item?.package_unit_price !== null
      && item?.package_unit_price !== undefined
      && item?.package_unit_price !== ''
      && Number.isFinite(recordedPackageBase)
      && recordedPackageBase >= 0
    return {
      ...item,
      package_covered: true,
      package_plan_name: allocation.plan_name,
      package_unit_price: hasRecordedPackageBase ? recordedPackageBase : allocationValueForItem(allocation, item),
      package_base_source: hasRecordedPackageBase ? 'appointment_snapshot' : 'current_plan_allocation',
      package_service_pool: allocation.service_pool,
      package_transport_total: allocation.transport_total,
    }
  })
  const matchedEntries = sourceItems
    .map((item) => allocationEntryForItem(allocation, item))
    .filter(Boolean)
  const matchedPrimary = matchedEntries.find((entry) => entry.discountable)
  const primaryEntries = (allocation.service_entries || []).filter((entry) => entry.discountable)
  const primaryEntry = matchedPrimary || (primaryEntries.length === 1 ? primaryEntries[0] : null)
  if (!primaryEntry) return enrichedItems

  const companions = (allocation.service_entries || [])
    .filter((entry) => !entry.discountable
      && entry.catalog_price > 0
      && entry.qty_per_cycle === primaryEntry.qty_per_cycle
      && !existingCodes.has(entry.code)
      && !existingCodes.has(entry.service_type))
    .map((entry) => ({
      code: entry.code,
      service_code: entry.code,
      service_type: entry.service_type,
      name: entry.service_name,
      group_type: entry.group_type || 'banho_tosa',
      unit_price: 0,
      catalog_price: entry.catalog_price,
      benefit_used: true,
      package_covered: true,
      package_component: true,
      package_plan_name: allocation.plan_name,
      package_unit_price: entry.package_unit_value,
      package_base_source: 'current_plan_allocation',
      package_service_pool: allocation.service_pool,
      package_transport_total: allocation.transport_total,
    }))
  return [...enrichedItems, ...companions]
}

const subscriptionPriority = (subscription = {}) => {
  const status = String(subscription.status || '').toLowerCase()
  const statusScore = status === 'active' ? 3 : status === 'paused' ? 2 : 1
  const date = new Date(subscription.updated_at || subscription.started_at || 0).getTime()
  return [statusScore, Number.isFinite(date) ? date : 0]
}

function newestPreferredSubscription(current, candidate) {
  if (!current) return candidate
  const [currentStatus, currentDate] = subscriptionPriority(current)
  const [candidateStatus, candidateDate] = subscriptionPriority(candidate)
  if (candidateStatus !== currentStatus) return candidateStatus > currentStatus ? candidate : current
  return candidateDate > currentDate ? candidate : current
}

async function loadAppointmentSubscriptionIds({ moduleId, tenantId, appointmentIds }) {
  if (!appointmentIds.length) return new Map()
  const response = await runWithTenantFallback(tenantId, async (includeTenant) => {
    let query = supabase
      .from('appointments')
      .select('id,subscription_id')
      .eq('module_id', moduleId)
      .in('id', appointmentIds)
    query = applyTenantFilter(query, tenantId, includeTenant)
    return query
  })
  if (response.error) throw response.error
  return new Map((response.data || [])
    .filter((row) => row.id && row.subscription_id)
    .map((row) => [row.id, row.subscription_id]))
}

async function loadSubscriptionsByIds({ moduleId, tenantId, ids }) {
  if (!ids.length) return []
  const response = await runWithTenantFallback(tenantId, async (includeTenant) => {
    let query = supabase
      .from('client_subscriptions')
      .select('id,plan_id,client_id,status,started_at,updated_at')
      .eq('module_id', moduleId)
      .in('id', ids)
    query = applyTenantFilter(query, tenantId, includeTenant)
    return query
  })
  if (response.error) throw response.error
  return response.data || []
}

async function loadSubscriptionsByClients({ moduleId, tenantId, clientIds }) {
  if (!clientIds.length) return []
  const response = await runWithTenantFallback(tenantId, async (includeTenant) => {
    let query = supabase
      .from('client_subscriptions')
      .select('id,plan_id,client_id,status,started_at,updated_at')
      .eq('module_id', moduleId)
      .in('client_id', clientIds)
      .in('status', ['active', 'paused'])
      .order('started_at', { ascending: false })
    query = applyTenantFilter(query, tenantId, includeTenant)
    return query
  })
  if (response.error) throw response.error
  return response.data || []
}

export async function enrichPackageCommissionAppointments({
  appointments = [],
  moduleId = 'petshop',
  tenantId,
  settings = {},
  catalogServices = [],
} = {}) {
  const source = Array.isArray(appointments) ? appointments : []
  const packageAppointments = source.filter(appointmentUsesPackage)
  if (!tenantId || !packageAppointments.length) return source

  const appointmentIdsMissingSubscription = packageAppointments
    .filter((appointment) => !appointment.subscription_id && appointment.id)
    .map((appointment) => appointment.id)
  const exactSubscriptionByAppointment = await loadAppointmentSubscriptionIds({
    moduleId,
    tenantId,
    appointmentIds: appointmentIdsMissingSubscription,
  })
  const subscriptionIdForAppointment = (appointment) => (
    appointment.subscription_id || exactSubscriptionByAppointment.get(appointment.id) || null
  )

  const explicitSubscriptionIds = [...new Set(packageAppointments
    .map(subscriptionIdForAppointment)
    .filter(Boolean))]
  const unresolvedClientIds = [...new Set(packageAppointments
    .filter((appointment) => !subscriptionIdForAppointment(appointment))
    .map((appointment) => appointment.client_id)
    .filter(Boolean))]

  const [explicitSubscriptions, clientSubscriptions] = await Promise.all([
    loadSubscriptionsByIds({ moduleId, tenantId, ids: explicitSubscriptionIds }),
    loadSubscriptionsByClients({ moduleId, tenantId, clientIds: unresolvedClientIds }),
  ])

  const subscriptionsById = new Map()
  ;[...explicitSubscriptions, ...clientSubscriptions].forEach((subscription) => {
    subscriptionsById.set(subscription.id, subscription)
  })

  const subscriptionByClient = new Map()
  clientSubscriptions.forEach((subscription) => {
    const current = subscriptionByClient.get(subscription.client_id)
    subscriptionByClient.set(
      subscription.client_id,
      newestPreferredSubscription(current, subscription),
    )
  })

  const resolvedSubscriptionByAppointment = new Map()
  packageAppointments.forEach((appointment) => {
    const exactSubscriptionId = subscriptionIdForAppointment(appointment)
    const explicit = exactSubscriptionId ? subscriptionsById.get(exactSubscriptionId) : null
    const inferred = appointment.client_id ? subscriptionByClient.get(appointment.client_id) : null
    const resolved = explicit || inferred || null
    if (resolved) resolvedSubscriptionByAppointment.set(appointment.id, resolved)
  })

  const planIds = [...new Set([...resolvedSubscriptionByAppointment.values()]
    .map((subscription) => subscription.plan_id)
    .filter(Boolean))]
  if (!planIds.length) return source

  const planResponse = await runWithTenantFallback(tenantId, async (includeTenant) => {
    let query = supabase
      .from('subscription_plans')
      .select('id,name,price,services')
      .eq('module_id', moduleId)
      .in('id', planIds)
    query = applyTenantFilter(query, tenantId, includeTenant)
    return query
  })
  if (planResponse.error) throw planResponse.error

  const planMap = new Map((planResponse.data || []).map((plan) => [plan.id, plan]))
  const allocationByPlan = new Map()
  planMap.forEach((plan, planId) => {
    allocationByPlan.set(
      planId,
      buildPackageCommissionAllocation({ plan, catalogServices, settings }),
    )
  })

  return source.map((appointment) => {
    if (!appointmentUsesPackage(appointment)) return appointment
    const subscription = resolvedSubscriptionByAppointment.get(appointment.id)
    const allocation = subscription ? allocationByPlan.get(subscription.plan_id) : null
    if (!allocation) return appointment

    const benefits = Array.isArray(appointment.subscription_benefits) ? appointment.subscription_benefits : []
    const items = (Array.isArray(appointment.service_items) ? appointment.service_items : []).map((item) => {
      const benefit = benefits.find((entry) => entry.service_code === (item.code || item.service_code))
      return { ...item, package_unit_price: item.package_unit_price ?? benefit?.package_unit_price }
    })
    const enrichedItems = buildPackageCommissionItems({ items, allocation })

    return {
      ...appointment,
      subscription_id: appointment.subscription_id || subscription.id,
      package_commission: true,
      package_plan_name: allocation.plan_name,
      package_commission_base_source: enrichedItems.some((item) => item.package_base_source === 'appointment_snapshot')
        ? 'mixed_or_snapshot'
        : 'current_plan_allocation',
      package_service_pool: allocation.service_pool,
      package_transport_total: allocation.transport_total,
      package_commission_unit_value: enrichedItems.length === 1
        ? Number(enrichedItems[0].package_unit_price || 0)
        : allocation.fallback_unit_value,
      service_items: enrichedItems,
    }
  })
}
