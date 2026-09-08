import { supabase } from '../../../lib/supabase'
import { applyTenantFilter, runWithTenantFallback } from '../../../lib/tenant'

const normalizeText = (value = '') => String(value || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .trim()

const positiveNumber = (value, fallback = 0) => {
  const number = Number(value)
  return Number.isFinite(number) && number >= 0 ? number : fallback
}

const normalizedPlanServices = (services = []) => (Array.isArray(services) ? services : [])
  .map((service) => ({
    ...service,
    service_type: String(service?.service_type || service?.service_code || '').trim(),
    service_code: String(service?.service_code || service?.service_type || '').trim(),
    qty_per_cycle: Math.max(0, Number(service?.qty_per_cycle || 0)),
  }))
  .filter((service) => service.service_type && service.qty_per_cycle > 0)

const isTransportService = (service = {}) => {
  const text = normalizeText([
    service.service_type,
    service.service_code,
    service.service_name,
    service.group_type,
    service.service_kind,
  ].filter(Boolean).join(' '))
  return service.service_type === 'motodog'
    || service.group_type === 'transport'
    || service.service_kind === 'transport'
    || /motodog|moto dog|transporte|buscar e levar/.test(text)
}

const packageServiceText = (service = {}, catalogService = {}) => normalizeText([
  service.service_type,
  service.service_code,
  service.service_name,
  catalogService.code,
  catalogService.name,
  catalogService.category,
].filter(Boolean).join(' '))

const isDiscountablePackageService = (service = {}, catalogService = {}) => {
  const text = packageServiceText(service, catalogService)
  return /(?:^|[\s_-])(banho|tosa|tosagem|groom|trim|trimming|stripping)(?:$|[\s_-])/.test(text)
}

export function configuredPackageTransportFee(settings = {}) {
  const options = Array.isArray(settings?.pet_transport_options) ? settings.pet_transport_options : []
  const roundTrip = options.find((option) => ['buscar_e_levar', 'motodog'].includes(String(option?.id || '')))
  const configured = Number(roundTrip?.fee)
  if (Number.isFinite(configured) && configured >= 0) return configured
  return positiveNumber(settings?.pet_transport_fee, 20)
}

function assignAllocationPool(entries, pool, unitValues) {
  if (!entries.length) return
  const allPriced = entries.every((entry) => entry.catalog_price > 0)
  const totalWeight = entries.reduce((sum, entry) => (
    sum + entry.qty_per_cycle * (allPriced ? entry.catalog_price : 1)
  ), 0)

  entries.forEach((entry) => {
    const weight = allPriced ? entry.catalog_price : 1
    const unitValue = totalWeight > 0 ? pool * weight / totalWeight : 0
    const rounded = Number(unitValue.toFixed(2))
    unitValues.set(entry.code, rounded)
    unitValues.set(entry.service_type, rounded)
  })
}

export function buildPackageCommissionAllocation({ plan = {}, catalogServices = [], settings = {} } = {}) {
  const planServices = normalizedPlanServices(plan.services)
  const catalog = new Map((catalogServices || [])
    .map((service) => [String(service?.code || '').trim(), service])
    .filter(([code]) => code))
  const transportFee = configuredPackageTransportFee(settings)
  const transportQuantity = planServices
    .filter(isTransportService)
    .reduce((sum, service) => sum + service.qty_per_cycle, 0)
  const transportTotal = transportQuantity * transportFee
  const packagePrice = positiveNumber(plan.price)
  const servicePool = Math.max(0, packagePrice - transportTotal)
  const serviceEntries = planServices
    .filter((service) => !isTransportService(service))
    .map((service) => {
      const code = service.service_code || service.service_type
      const catalogService = catalog.get(code) || {}
      return {
        ...service,
        code,
        service_type: service.service_type || code,
        service_name: String(catalogService.name || service.service_name || code).trim(),
        group_type: catalogService.group_type || service.group_type || 'banho_tosa',
        catalog_price: positiveNumber(catalogService.default_price),
        discountable: isDiscountablePackageService(service, catalogService),
      }
    })
  const totalUnits = serviceEntries.reduce((sum, service) => sum + service.qty_per_cycle, 0)
  const unitValues = new Map()
  const discountableEntries = serviceEntries.filter((entry) => entry.discountable)
  const fixedEntries = serviceEntries.filter((entry) => !entry.discountable)
  const fixedCatalogTotal = fixedEntries.reduce((sum, entry) => (
    sum + entry.qty_per_cycle * entry.catalog_price
  ), 0)
  const canPreserveFixedPrices = discountableEntries.length > 0
    && fixedEntries.every((entry) => entry.catalog_price > 0)
    && fixedCatalogTotal <= servicePool + 0.005

  if (canPreserveFixedPrices) {
    fixedEntries.forEach((entry) => {
      const value = Number(entry.catalog_price.toFixed(2))
      unitValues.set(entry.code, value)
      unitValues.set(entry.service_type, value)
    })
    assignAllocationPool(
      discountableEntries,
      Math.max(0, servicePool - fixedCatalogTotal),
      unitValues,
    )
  } else {
    assignAllocationPool(serviceEntries, servicePool, unitValues)
  }

  const allocatedEntries = serviceEntries.map((entry) => ({
    ...entry,
    package_unit_value: unitValues.get(entry.code)
      ?? unitValues.get(entry.service_type)
      ?? 0,
  }))

  return {
    plan_name: String(plan.name || 'Pacote').trim(),
    package_price: Number(packagePrice.toFixed(2)),
    transport_fee: Number(transportFee.toFixed(2)),
    transport_quantity: transportQuantity,
    transport_total: Number(transportTotal.toFixed(2)),
    service_pool: Number(servicePool.toFixed(2)),
    service_units: totalUnits,
    fixed_service_total: Number(fixedCatalogTotal.toFixed(2)),
    unit_values: unitValues,
    service_entries: allocatedEntries,
    fallback_unit_value: serviceEntries.length === 1
      ? unitValues.get(serviceEntries[0].code) || 0
      : totalUnits > 0 ? Number((servicePool / totalUnits).toFixed(2)) : 0,
  }
}

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

    const items = Array.isArray(appointment.service_items) ? appointment.service_items : []
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
