export function configuredPackageTransportFee(settings?: Record<string, unknown>): number
export function buildPackageCommissionAllocation(options?: {
  plan?: Record<string, unknown>
  catalogServices?: Record<string, unknown>[]
  settings?: Record<string, unknown>
}): { unit_values: Map<string, number> }
