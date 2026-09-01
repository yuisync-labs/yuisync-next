const normalizeText = (value = '') => String(value || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .trim()

const activePackageStatuses = new Set(['reserved', 'consumed'])
const transportPattern = /\b(motodog|moto\s*dog|transporte|entrega|delivery|frete|buscar|levar)\b/

const activeServiceBenefits = (appointment = {}) => (
  (Array.isArray(appointment.subscription_benefits) ? appointment.subscription_benefits : [])
    .filter((benefit) => benefit?.kind === 'service'
      && activePackageStatuses.has(String(benefit?.status || appointment.subscription_benefit_status || 'reserved')))
)

const itemServiceCode = (item = {}) => String(item.code || item.service_type || item.value || '').trim()

const itemHasPackageBenefit = (item = {}, appointment = {}, itemCount = 0) => {
  if (item?.benefit_used === true || item?.subscription_benefit_used === true) return true
  const code = itemServiceCode(item)
  const key = String(item?.benefit_key || '').trim()
  const benefits = activeServiceBenefits(appointment)
  return benefits.some((benefit) => {
    const benefitCode = String(benefit?.service_code || '').trim()
    const benefitKey = String(benefit?.key || benefit?.benefit_key || '').trim()
    return (code && benefitCode === code)
      || (key && benefitKey === key)
      || (itemCount === 1 && benefits.length === 1 && !benefitCode)
  })
}

export function resolveCashPeriod({ openedAt = null, dayStart, dayEnd } = {}) {
  return {
    start: openedAt || dayStart,
    end: dayEnd,
    mode: openedAt ? 'register' : 'day',
  }
}

export function isPackageCoveredAppointment(appointment = {}) {
  if (Math.abs(Number(appointment.price || 0)) > 0.005) return false
  const items = Array.isArray(appointment.service_items) ? appointment.service_items : []
  const itemBenefit = items.some((item) => itemHasPackageBenefit(item, appointment, items.length))
  return itemBenefit
    || activeServiceBenefits(appointment).length > 0
    || (String(appointment.subscription_benefit_status || '') === 'consumed'
      && Number(appointment.subscription_discount || 0) > 0)
}

const packageServiceLabel = (appointment = {}) => {
  const items = (Array.isArray(appointment.service_items) ? appointment.service_items : [])
    .filter((item) => !transportPattern.test(normalizeText([
      item?.name, item?.label, item?.code, item?.service_type,
    ].filter(Boolean).join(' '))))
  const itemNames = items.map((item) => item?.name || item?.label || item?.code || item?.service_type).filter(Boolean)
  if (itemNames.length) return [...new Set(itemNames)].join(' + ')
  const benefitNames = activeServiceBenefits(appointment)
    .map((benefit) => benefit?.label || benefit?.service_name || benefit?.service_code)
    .filter(Boolean)
  return [...new Set(benefitNames)].join(' + ')
    || appointment.service_type
    || 'Servico do pacote'
}

const sourceKeyForSale = (sale = {}) => {
  if (sale.subscription_id || normalizeText(sale.source) === 'assinatura') return 'subscriptions'
  if (sale.appointment_id || normalizeText(sale.source) === 'agenda') return 'agenda'
  return 'retail'
}

const sourceLabelForSale = (sale = {}) => {
  const key = sourceKeyForSale(sale)
  if (key === 'subscriptions') return 'Pacote pago'
  if (key === 'agenda') return 'Atendimento recebido'
  if (normalizeText(sale.source) === 'whatsapp') return 'Venda WhatsApp'
  return 'Venda PDV'
}

const saleDescription = (sale = {}) => String(sale.notes || '')
  .replace(/^Agendamento:\s*[0-9a-f-]{36}\s*(?:\|\s*)?/i, '')
  .trim()

export function buildCashDashboardSummary({ sales = [], splitRows = [], packageAppointments = [] } = {}) {
  const splitMap = new Map()
  splitRows.forEach((row) => {
    const existing = splitMap.get(row.sale_id) || []
    existing.push(row)
    splitMap.set(row.sale_id, existing)
  })

  const totalsByMethod = sales.reduce((acc, sale) => {
    const saleSplits = splitMap.get(sale.id) || []
    if (saleSplits.length) {
      saleSplits.forEach((split) => {
        const key = split.payment_method || 'outros'
        acc[key] = (acc[key] || 0) + Number(split.amount || 0)
      })
    } else {
      const key = sale.payment_method || 'outros'
      acc[key] = (acc[key] || 0) + Number(sale.total_price || 0)
    }
    return acc
  }, {})

  const sourceSummary = {
    agenda: { count: 0, total: 0 },
    subscriptions: { count: 0, total: 0 },
    retail: { count: 0, total: 0 },
    packageConsumed: { count: packageAppointments.length, total: 0 },
  }

  const saleMovements = sales.map((sale) => {
    const sourceKey = sourceKeyForSale(sale)
    sourceSummary[sourceKey].count += 1
    sourceSummary[sourceKey].total += Number(sale.total_price || 0)
    return {
      id: `sale:${sale.id}`,
      record_type: 'sale',
      occurred_at: sale.created_at,
      source_key: sourceKey,
      source_label: sourceLabelForSale(sale),
      client_name: sale.client?.owner_name || sale.customer_name || 'Cliente',
      pet_name: sale.client?.pet_name || '',
      description: saleDescription(sale),
      payment_method: sale.payment_method || 'outros',
      amount: Number(sale.total_price || 0),
    }
  })

  const packageMovements = packageAppointments.map((appointment) => ({
    id: `package:${appointment.id}`,
    record_type: 'package_consumption',
    occurred_at: appointment.updated_at || appointment.scheduled_at,
    source_key: 'packageConsumed',
    source_label: 'Servico de pacote',
    client_name: appointment.client?.owner_name || 'Cliente',
    pet_name: appointment.client?.pet_name || '',
    description: packageServiceLabel(appointment),
    payment_method: 'pacote',
    amount: 0,
  }))

  const movements = [...saleMovements, ...packageMovements]
    .sort((left, right) => new Date(right.occurred_at || 0) - new Date(left.occurred_at || 0))

  return {
    totalsByMethod,
    totalSales: sales.reduce((sum, sale) => sum + Number(sale.total_price || 0), 0),
    expectedCash: Number(totalsByMethod.dinheiro || 0),
    sourceSummary,
    movements,
  }
}
