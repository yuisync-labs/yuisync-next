const ACTIVE_PACKAGE_BENEFIT_STATUSES = new Set(['reserved', 'consumed'])
const RELEASED_PACKAGE_BENEFIT_STATUSES = new Set(['released', 'cancelled', 'canceled'])

function normalizedStatus(value) {
  return String(value || '').trim().toLowerCase()
}

export function appointmentPackagePresentation(appointment = {}) {
  const benefitState = normalizedStatus(appointment.subscription_benefit_status) || null
  const serviceItems = Array.isArray(appointment.service_items) ? appointment.service_items : []
  const billingIntent = normalizedStatus(appointment.billing_intent_type)

  const itemUsesPackage = serviceItems.some((item) => {
    const itemState = normalizedStatus(item?.benefit_status)
    return item?.benefit_used === true || ACTIVE_PACKAGE_BENEFIT_STATUSES.has(itemState)
  })

  const hasActiveBenefit = ACTIVE_PACKAGE_BENEFIT_STATUSES.has(benefitState)
    || appointment.subscription_benefit_used === true
    || itemUsesPackage

  const explicitlyReleased = RELEASED_PACKAGE_BENEFIT_STATUSES.has(benefitState)
  const hasSubscriptionIdentity = Boolean(
    appointment.subscription_id
    || appointment.billing_intent_subscription_id,
  )

  const billingSource = hasActiveBenefit
    ? 'subscription'
    : explicitlyReleased
      ? 'standalone'
      : billingIntent === 'subscription' || hasSubscriptionIdentity
        ? 'subscription'
        : 'standalone'

  return {
    billingSource,
    benefitState,
    cardKind: billingSource === 'subscription' ? 'package' : 'standalone',
    usesPackage: billingSource === 'subscription',
  }
}
