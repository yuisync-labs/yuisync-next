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
