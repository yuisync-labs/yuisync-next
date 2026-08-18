import { fmtCurrency } from '../../../lib/supabase'
import { appointmentPackagePresentation } from '../lib/appointmentBillingPresentation'

export function AgendaBillingLabel({ appointment }) {
  const presentation = appointmentPackagePresentation(appointment)

  if (presentation.usesPackage) {
    return (
      <span
        className="yuisync-package-label shrink-0 font-bold text-amber-100"
        data-billing-source="subscription"
        data-benefit-state={presentation.benefitState || ''}
      >
        PACOTE · R$ 0,00
      </span>
    )
  }

  return (
    <span
      className="shrink-0 font-bold text-emerald-400"
      data-billing-source="standalone"
      data-benefit-state={presentation.benefitState || ''}
    >
      {fmtCurrency(appointment?.price)}
    </span>
  )
}
