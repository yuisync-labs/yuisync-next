type JsonRecord = Record<string, unknown>
export type BillingIntent = {
  type: 'auto' | 'standalone' | 'subscription'
  allocations: Array<{ serviceCode: string; subscriptionId: string }>
}
const asObject = (value: unknown): JsonRecord => value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {}
const asText = (value: unknown) => String(value ?? '').trim()
export function parseBillingIntent(payload: JsonRecord): BillingIntent {
  const raw = asObject(payload.billing_intent)
  const kind = asText(raw.type || payload.billing_intent_type).toLowerCase()
  const type = kind === 'subscription' ? 'subscription' : kind === 'standalone' ? 'standalone' : 'auto'
  const allocations = (Array.isArray(raw.allocations) ? raw.allocations : []).map((value) => {
    const item = asObject(value)
    return { serviceCode: asText(item.service_code || item.code), subscriptionId: asText(item.subscription_id) }
  }).filter((item) => item.serviceCode && item.subscriptionId)
  return { type, allocations }
}
export const hasExplicitBillingIntent = (payload: JsonRecord) => parseBillingIntent(payload).type !== 'auto'
