import type { BillingService } from './appointmentBillingCatalog'
import type { BenefitAllocation } from './subscriptionBenefitResolver'
import { loadBenefitCandidates } from './subscriptionBenefitCandidates'

export async function resolveAutomaticBenefitAllocations(input: {
  db: D1Database
  tenantId: string
  moduleId: string
  clientId: string
  petId: string
  items: BillingService[]
  ignoreAppointmentId?: string
}) {
  const planned = new Map<string, number>()
  const allocations: BenefitAllocation[] = []

  for (let position = 0; position < input.items.length; position += 1) {
    const item = input.items[position]
    const serviceCode = String(item.service_code || item.code || '').trim()
    if (!serviceCode) continue

    const candidates = await loadBenefitCandidates(input.db, {
      tenantId: input.tenantId,
      moduleId: input.moduleId,
      clientId: input.clientId,
      petId: input.petId,
      serviceCode,
      ignoreAppointmentId: input.ignoreAppointmentId,
    })
    for (const candidate of candidates.results) {
      const planKey = `${candidate.subscription_id}:${candidate.benefit_key}`
      const pending = planned.get(planKey) || 0
      if (Number(candidate.baseline_used) + Number(candidate.active_qty) + pending >= Number(candidate.max_qty)) continue
      const price = Number(item.catalog_price ?? item.unit_price ?? 0)
      allocations.push({
        subscriptionId: candidate.subscription_id,
        serviceCode,
        benefitKey: candidate.benefit_key,
        position,
        catalogPriceCents: Math.max(0, Math.round((Number.isFinite(price) ? price : 0) * 100)),
        planName: candidate.plan_name,
      })
      planned.set(planKey, pending + 1)
      break
    }
  }
  return allocations
}
