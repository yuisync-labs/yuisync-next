const normalizeText = (value = '') => String(value || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .trim()

const transportPattern = /\b(motodog|moto\s*dog|transporte|entrega|delivery|frete|buscar|levar)\b/
const genericBathTosaPattern = /^(banho[_\s-]*tosa|banho e tosa)$/
const anyGroomingCommissionPattern = /\b(tosa|tosagem|tosar|trim|trimming|stripping)\w*/

const itemText = (item = {}) => normalizeText([
  item.code,
  item.value,
  item.name,
  item.label,
  item.service_type,
  item.group_type,
].filter(Boolean).join(' '))

const itemDescriptionText = (item = {}) => normalizeText([
  item.code,
  item.value,
  item.name,
  item.label,
  item.service_name,
  item.service_type,
].filter(Boolean).join(' ')).replace(/[_-]+/g, ' ')

const itemCategory = (item = {}, appointment = {}) => {
  const text = itemText(item)
  const description = itemDescriptionText(item)
  const rawType = normalizeText(item.service_type || item.code || item.value || appointment.service_type || '')
  const genericBathTosa = genericBathTosaPattern.test(rawType)

  if (/tesoura/.test(text)) return 'scissor_grooming'
  if (/tosa\s*(?:na\s*)?maquina|maquina|tosa\s*total|tosa\s*completa|groom|trim/.test(text)) return 'machine_grooming'
  if (/\b(?:corte|apar(?:ar|o)?)\s+(?:de\s+)?unhas?\b/.test(description)
    && !/\b(?:banho|tosa)\b/.test(description)) return 'other'
  if (/\bbanho\b/.test(text)) return 'bath'
  if (/\btosa\b/.test(text) && !/higien/.test(text)) return 'machine_grooming'
  if (/higien/.test(text)) return 'other'
  if (genericBathTosa || normalizeText(item.group_type || appointment.service_group) === 'banho_tosa') return 'bath'
  return 'other'
}

const serviceCode = (value = {}) => String(value.code || value.service_type || value.value || '').trim()

// Historical policy: a snapshot persisted on the appointment always wins.
// Current catalog rate is used only to hydrate legacy rows that have no snapshot.
const configuredCommissionPercent = (item = {}, category = 'other') => {
  if (item.commission_rate !== null && item.commission_rate !== undefined && item.commission_rate !== '') {
    const rate = Number(item.commission_rate)
    if (Number.isFinite(rate) && rate >= 0) return rate
  }
  return ['machine_grooming', 'scissor_grooming'].includes(category) ? 10 : 5
}

const enrichItemsFromCatalog = (items = [], services = []) => {
  const byCode = new Map((services || []).map((service) => [serviceCode(service), service]))
  return (items || []).map((item) => {
    const catalog = byCode.get(serviceCode(item))
    if (!catalog) return item
    return {
      ...item,
      commission_type: item.commission_type || catalog.commission_type || 'percentage',
      commission_rate: item.commission_rate ?? catalog.commission_rate,
      catalog_price: item.catalog_price ?? catalog.default_price ?? catalog.price,
    }
  })
}

export function hydrateLegacyCommissionAppointment(appointment = {}, services = []) {
  if (Array.isArray(appointment.service_items) && appointment.service_items.length) {
    return {
      ...appointment,
      service_items: enrichItemsFromCatalog(appointment.service_items, services),
    }
  }

  const rawType = normalizeText(appointment.service_type || '')
  if (!genericBathTosaPattern.test(rawType)) return appointment

  const appointmentPrice = Number(appointment.price || 0)
  const candidates = (services || []).filter((service) => (
    normalizeText(service.group_type) === 'banho_tosa'
    && appointmentPrice > 0
    && Math.abs(Number(service.default_price || 0) - appointmentPrice) < 0.01
  ))
  const categories = new Set(candidates.map((service) => itemCategory(service, appointment)))
  const selected = categories.size === 1 ? candidates[0] : null
  if (!selected) return appointment

  return {
    ...appointment,
    service_items: [{
      code: selected.code,
      name: selected.name,
      service_type: selected.code,
      group_type: selected.group_type || 'banho_tosa',
      unit_price: appointmentPrice,
      catalog_price: selected.default_price ?? appointmentPrice,
      commission_type: selected.commission_type || 'percentage',
      commission_rate: selected.commission_rate,
      source_product_id: selected.source_product_id || null,
      inferred_from_legacy_price: true,
    }],
  }
}

export function hydrateLegacyCommissionAppointments(appointments = [], services = []) {
  return (appointments || []).map((appointment) => hydrateLegacyCommissionAppointment(appointment, services))
}

export function appointmentCommissionLines(appointment = {}) {
  const appointmentGroup = normalizeText(appointment.service_group || '')
  if (appointmentGroup && appointmentGroup !== 'banho_tosa') return []

  const serviceBenefits = (Array.isArray(appointment.subscription_benefits) ? appointment.subscription_benefits : [])
    .filter((benefit) => benefit?.kind === 'service'
      && ['reserved', 'consumed'].includes(String(benefit?.status || appointment.subscription_benefit_status || 'reserved')))
  const rawItems = Array.isArray(appointment.service_items) && appointment.service_items.length
    ? appointment.service_items
    : serviceBenefits.length
      ? serviceBenefits.map((benefit) => ({
        code: benefit.service_code || benefit.key,
        name: benefit.label || benefit.service_name || benefit.service_code || 'Servico do pacote',
        service_type: benefit.service_code || benefit.key,
        group_type: appointment.service_group || 'banho_tosa',
        unit_price: 0,
        catalog_price: benefit.catalog_price,
        commission_rate: benefit.commission_rate,
        subscription_benefit_used: true,
        package_covered: true,
      }))
      : [{
        code: appointment.service_type,
        name: appointment.service_type,
        service_type: appointment.service_type,
        group_type: appointment.service_group || 'banho_tosa',
        unit_price: appointment.price,
      }]

  const eligible = rawItems.filter((item) => {
    const group = normalizeText(item?.group_type || appointment.service_group || 'banho_tosa')
    const text = itemText(item)
    if (group && group !== 'banho_tosa') return false
    return !transportPattern.test(text)
  })

  return eligible.map((item) => {
    const category = itemCategory(item, appointment)
    const code = String(item.code || item.service_type || item.value || '').trim()
    const benefitKey = String(item.benefit_key || '').trim()
    const matchingBenefit = serviceBenefits.find((benefit) => {
      const benefitServiceCode = String(benefit?.service_code || '').trim()
      const key = String(benefit?.key || benefit?.benefit_key || '').trim()
      return (code && benefitServiceCode === code)
        || (benefitKey && key === benefitKey)
        || (eligible.length === 1 && serviceBenefits.length === 1 && !benefitServiceCode)
    })
    const packageCovered = item.package_covered === true
      || item.subscription_benefit_used === true
      || item.benefit_used === true
      || appointment.package_commission === true
      || Boolean(matchingBenefit)
    const catalogRevenue = Number(
      item.catalog_price
      ?? item.default_price
      ?? matchingBenefit?.catalog_price
      ?? item.unit_price
      ?? item.price
      ?? 0
    )
    const packageRevenue = Number(
      item.package_unit_price
      ?? appointment.package_commission_unit_value
      ?? 0
    )
    const netRevenue = Number(item.unit_price ?? item.price ?? 0)
    const revenue = packageCovered
      ? packageRevenue > 0 ? packageRevenue : catalogRevenue
      : netRevenue > 0
        ? netRevenue
        : eligible.length === 1
          ? Number(appointment.price || 0)
          : 0
    const commissionPercent = configuredCommissionPercent({
      ...item,
      commission_rate: item.commission_rate ?? matchingBenefit?.commission_rate,
    }, category)
    const rate = commissionPercent / 100
    const rawLabel = item.name || item.label || item.code || item.value || appointment.service_type || 'Servico estetico'
    const legacyGeneric = genericBathTosaPattern.test(normalizeText(item.service_type || item.code || appointment.service_type || ''))
    const baseLabel = legacyGeneric && category === 'bath' ? 'Banho (registro antigo)' : rawLabel
    return {
      appointment_id: appointment.id,
      category,
      code: item.code || item.value || item.service_type || appointment.service_type || '',
      label: packageCovered ? `${baseLabel} · PACOTE` : baseLabel,
      revenue: Math.max(0, revenue),
      commission: Math.max(0, revenue) * rate,
      rate,
      commission_rate: commissionPercent,
      package_covered: packageCovered,
      package_plan_name: item.package_plan_name || appointment.package_plan_name || '',
    }
  })
}

export function appointmentHasCommissionServices(appointment = {}) {
  return appointmentCommissionLines(appointment).length > 0
}

export function commissionHistoryLabel(appointment = {}) {
  const labels = appointmentCommissionLines(appointment).map((line) => line.label).filter(Boolean)
  return [...new Set(labels)].join(' + ') || 'Servico estetico'
}

export function buildCommissionRows(history = [], configuredStaff = []) {
  const rows = new Map()
  const configuredNames = new Map((configuredStaff || []).map((person) => [person.key, person.name]))
  const ensure = (key, name = '') => {
    if (!key) return null
    if (!rows.has(key)) {
      rows.set(key, {
        staff_key: key,
        collaborator_name: name || key,
        service_count: 0,
        bath_count: 0,
        machine_grooming_count: 0,
        scissor_grooming_count: 0,
        grooming_count: 0,
        other_service_count: 0,
        package_count: 0,
        package_bath_count: 0,
        package_grooming_count: 0,
        service_revenue: 0,
        bath_revenue: 0,
        grooming_revenue: 0,
        other_service_revenue: 0,
        package_revenue: 0,
        bath_commission: 0,
        grooming_commission: 0,
        other_service_commission: 0,
        package_commission: 0,
        total_commission: 0,
      })
    }
    const current = rows.get(key)
    if (name && !configuredNames.has(key)) current.collaborator_name = name
    return current
  }

  configuredStaff.forEach((person) => ensure(person.key, person.name))

  history.forEach((appointment) => {
    const key = String(appointment.responsible_staff_key || '').trim()
    if (!key) return
    const row = ensure(key, configuredNames.get(key) || appointment.responsible_staff_name || key)
    const lines = appointmentCommissionLines(appointment)
    if (lines.some((line) => line.package_covered)) row.package_count += 1

    lines.forEach((line) => {
      row.service_count += 1
      row.service_revenue += line.revenue
      row.total_commission += line.commission

      if (line.package_covered) {
        row.package_revenue += line.revenue
        row.package_commission += line.commission
        if (line.category === 'bath') row.package_bath_count += 1
        if (['machine_grooming', 'scissor_grooming'].includes(line.category)) row.package_grooming_count += 1
        return
      }

      if (line.category === 'bath') {
        row.bath_count += 1
        row.bath_revenue += line.revenue
        row.bath_commission += line.commission
      } else if (line.category === 'machine_grooming') {
        row.machine_grooming_count += 1
        row.grooming_count += 1
        row.grooming_revenue += line.revenue
        row.grooming_commission += line.commission
      } else if (line.category === 'scissor_grooming') {
        row.scissor_grooming_count += 1
        row.grooming_count += 1
        row.grooming_revenue += line.revenue
        row.grooming_commission += line.commission
      } else {
        row.other_service_count += 1
        row.other_service_revenue += line.revenue
        row.other_service_commission += line.commission
      }
    })
  })

  return [...rows.values()]
    .map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) => (
      typeof value === 'number' ? [key, Number(value.toFixed(2))] : [key, value]
    ))))
    .sort((left, right) => right.total_commission - left.total_commission
      || String(left.collaborator_name).localeCompare(String(right.collaborator_name), 'pt-BR'))
}
