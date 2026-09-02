const ACTIVE_PACKAGE_BENEFIT_STATUSES = new Set(['reserved', 'consumed'])
const RELEASED_PACKAGE_BENEFIT_STATUSES = new Set(['released', 'cancelled', 'canceled'])

function normalizedStatus(value) {
  return String(value || '').trim().toLowerCase()
}

function parsedBenefits(appointment = {}) {
  if (Array.isArray(appointment.subscription_benefits)) return appointment.subscription_benefits
  if (typeof appointment.subscription_benefits_json !== 'string') return []

  try {
    const benefits = JSON.parse(appointment.subscription_benefits_json)
    return Array.isArray(benefits) ? benefits : []
  } catch {
    return []
  }
}

function isTransportBenefit(benefit = {}) {
  const kind = normalizedStatus(benefit.kind || benefit.type)
  const key = normalizedStatus(benefit.key || benefit.benefit_key || benefit.service_code)
  return kind === 'transport'
    || key === 'motodog'
    || (Boolean(benefit.transport_mode) && !benefit.service_code)
}

function benefitIsActive(benefit = {}, fallbackStatus = '') {
  const status = normalizedStatus(benefit.status || benefit.state || fallbackStatus)
  return ACTIVE_PACKAGE_BENEFIT_STATUSES.has(status)
}

function standaloneCardKind(appointment = {}) {
  const serviceText = [
    appointment.service_type,
    ...(Array.isArray(appointment.service_items)
      ? appointment.service_items.flatMap((item) => [
        item?.name,
        item?.label,
        item?.service_name,
        item?.code,
      ])
      : []),
  ].filter(Boolean).join(' ')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()

  return /\btosa\b|tosagem|tosar|groom|trim/.test(serviceText) ? 'grooming' : 'bath'
}

export function appointmentPackagePresentation(appointment = {}) {
  const benefitState = normalizedStatus(appointment.subscription_benefit_status) || null
  const serviceItems = Array.isArray(appointment.service_items) ? appointment.service_items : []
  const benefits = parsedBenefits(appointment)
  const billingIntent = normalizedStatus(appointment.billing_intent_type)

  const itemUsesPackage = serviceItems.some((item) => {
    const itemState = normalizedStatus(item?.benefit_status)
    return item?.benefit_used === true || ACTIVE_PACKAGE_BENEFIT_STATUSES.has(itemState)
  })

  const activeServiceBenefit = benefits.some((benefit) => (
    !isTransportBenefit(benefit) && benefitIsActive(benefit, benefitState)
  ))
  const hasDetailedBenefits = benefits.length > 0
  const transportOnlyBenefit = hasDetailedBenefits
    && benefits.every(isTransportBenefit)

  // The appointment-level flag means that some package benefit was used. It can
  // describe MotoDog only, so detailed snapshots and service-item allocations
  // take precedence when deciding how the grooming service itself is billed.
  const hasActiveServiceBenefit = itemUsesPackage
    || activeServiceBenefit
    || (!hasDetailedBenefits && (
      ACTIVE_PACKAGE_BENEFIT_STATUSES.has(benefitState)
      || appointment.subscription_benefit_used === true
    ))

  const explicitlyReleased = RELEASED_PACKAGE_BENEFIT_STATUSES.has(benefitState)
  const hasSubscriptionIdentity = Boolean(
    appointment.subscription_id
    || appointment.billing_intent_subscription_id,
  )

  const billingSource = hasActiveServiceBenefit
    ? 'subscription'
    : transportOnlyBenefit || explicitlyReleased
      ? 'standalone'
      : !hasDetailedBenefits && (billingIntent === 'subscription' || hasSubscriptionIdentity)
        ? 'subscription'
        : 'standalone'

  return {
    billingSource,
    benefitState,
    cardKind: billingSource === 'subscription' ? 'package' : standaloneCardKind(appointment),
    usesPackage: billingSource === 'subscription',
  }
}

export function appointmentCardKind(appointment = {}) {
  return appointmentPackagePresentation(appointment).cardKind
}
