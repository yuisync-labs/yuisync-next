type JsonRecord = Record<string, unknown>
export type BillingIntent = {
  type: 'auto' | 'standalone' | 'subscription'
  allocations: Array<{ serviceCode: string; subscriptionId: string }>
}

export type BenefitLedgerAllocation = {
  id?: string
  benefit_key?: string
  service_code?: string | null
  state?: 'reserved' | 'consumed' | 'released' | string
  appointment_id?: string | null
  appointment_status?: string | null
  scheduled_at_ms?: number | null
  service_name?: string | null
  reserved_at_ms?: number | null
  consumed_at_ms?: number | null
  released_at_ms?: number | null
  updated_at_ms?: number | null
}

export type BenefitLedgerMovement = {
  id: string
  kind: 'appointment' | 'historical_or_manual_adjustment'
  state: 'reserved' | 'consumed' | 'released'
  quantity: number
  appointment_id: string | null
  appointment_status: string | null
  scheduled_at: string | null
  recorded_at: string | null
  service_code: string | null
  label: string
  origin_known: boolean
}

export type BenefitLedgerItem = {
  benefit_key: string
  label: string
  capacity: number
  manual_or_historical: number
  reserved: number
  consumed: number
  used: number
  available: number
  movements: BenefitLedgerMovement[]
}

const asObject = (value: unknown): JsonRecord => value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {}
const asText = (value: unknown) => String(value ?? '').trim()
const asInteger = (value: unknown) => {
  const number = Number(value)
  return Number.isFinite(number) ? Math.max(0, Math.trunc(number)) : 0
}
const asIso = (value: unknown) => {
  const millis = Number(value)
  return Number.isFinite(millis) && millis > 0 ? new Date(millis).toISOString() : null
}

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

function serviceKey(service: JsonRecord): string {
  return asText(service.service_type || service.service_code || service.code)
}

function serviceLabel(service: JsonRecord, fallback: string): string {
  return asText(service.service_name || service.name || service.label) || fallback
}

function movementRecordedAt(row: BenefitLedgerAllocation): string | null {
  if (row.state === 'consumed') return asIso(row.consumed_at_ms || row.updated_at_ms)
  if (row.state === 'released') return asIso(row.released_at_ms || row.updated_at_ms)
  return asIso(row.reserved_at_ms || row.updated_at_ms)
}

export function projectBenefitLedger(input: {
  services: JsonRecord[]
  baseUsage?: Record<string, number>
  allocations?: BenefitLedgerAllocation[]
}): BenefitLedgerItem[] {
  const services = Array.isArray(input.services) ? input.services : []
  const baseUsage = input.baseUsage || {}
  const allocations = Array.isArray(input.allocations) ? input.allocations : []
  const serviceByKey = new Map<string, JsonRecord>()
  services.forEach((service) => {
    const key = serviceKey(service)
    if (key) serviceByKey.set(key, service)
  })

  const keys = new Set<string>([
    ...serviceByKey.keys(),
    ...Object.keys(baseUsage),
    ...allocations.map((row) => asText(row.benefit_key)).filter(Boolean),
  ])

  return [...keys].map((key) => {
    const service = serviceByKey.get(key) || {}
    const capacity = asInteger(service.qty_per_cycle ?? service.quantity ?? service.qty)
    const manualOrHistorical = asInteger(baseUsage[key])
    const rows = allocations.filter((row) => asText(row.benefit_key) === key)
    const reserved = rows.filter((row) => row.state === 'reserved').length
    const consumed = rows.filter((row) => row.state === 'consumed').length
    const movements: BenefitLedgerMovement[] = rows
      .filter((row) => ['reserved', 'consumed', 'released'].includes(String(row.state || '')))
      .map((row) => ({
        id: asText(row.id) || `${asText(row.appointment_id) || 'appointment'}:${key}:${row.state}`,
        kind: 'appointment',
        state: row.state as 'reserved' | 'consumed' | 'released',
        quantity: 1,
        appointment_id: asText(row.appointment_id) || null,
        appointment_status: asText(row.appointment_status) || null,
        scheduled_at: asIso(row.scheduled_at_ms),
        recorded_at: movementRecordedAt(row),
        service_code: asText(row.service_code) || null,
        label: asText(row.service_name) || serviceLabel(service, key),
        origin_known: Boolean(asText(row.appointment_id)),
      }))

    if (manualOrHistorical > 0) {
      movements.unshift({
        id: `base:${key}`,
        kind: 'historical_or_manual_adjustment',
        state: 'consumed',
        quantity: manualOrHistorical,
        appointment_id: null,
        appointment_status: null,
        scheduled_at: null,
        recorded_at: null,
        service_code: key,
        label: 'Ajuste histórico/manual sem vínculo com atendimento',
        origin_known: false,
      })
    }

    const used = manualOrHistorical + consumed
    return {
      benefit_key: key,
      label: serviceLabel(service, key),
      capacity,
      manual_or_historical: manualOrHistorical,
      reserved,
      consumed,
      used,
      available: Math.max(0, capacity - used - reserved),
      movements,
    }
  }).sort((left, right) => left.label.localeCompare(right.label, 'pt-BR'))
}
