import type { BillingIntent } from './subscriptionBenefitLedger'

type ObjectRow = Record<string, unknown>
type SubscriptionRow = {
  id: string
  client_id: string
  status: string
  plan_name: string
  plan_status: string
  services_json: string
}
export type BenefitAllocation = {
  subscriptionId: string
  serviceCode: string
  benefitKey: string
  position: number
  catalogPriceCents: number
  planName: string
}

const text = (value: unknown) => String(value ?? '').trim()
const object = (value: unknown): ObjectRow => value && typeof value === 'object' && !Array.isArray(value) ? value as ObjectRow : {}
const normalize = (value: unknown) => text(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
function array(value: string): ObjectRow[] {
  try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed.map(object) : [] } catch { return [] }
}
function matchesPlanService(item: ObjectRow, code: string) {
  const target = normalize(code)
  return [item.service_type, item.service_code, item.code, item.service_name, item.name, item.label]
    .map(normalize).filter(Boolean).includes(target)
}
function quantity(item: ObjectRow) {
  const raw = Number(item.qty_per_cycle ?? item.quantity ?? item.qty)
  return Number.isFinite(raw) ? Math.max(0, Math.trunc(raw)) : 0
}

async function packagePetBinding(db:D1Database,input:{tenantId:string;moduleId:string;subscriptionId:string}) {
  return db.prepare(`SELECT COALESCE(
      json_extract(cycle.facts_json,'$.pet_id'),
      (SELECT appointment.pet_id FROM appointments appointment
       WHERE appointment.tenant_id=?1 AND appointment.module_id=?2 AND appointment.subscription_id=?3
       ORDER BY appointment.scheduled_at_ms,appointment.id LIMIT 1)
    ) AS pet_id
    FROM client_subscriptions subscription
    LEFT JOIN operation_checkpoints cycle
      ON cycle.tenant_id=subscription.tenant_id AND cycle.module_id=subscription.module_id
     AND cycle.id=('package_cycle:'||subscription.id) AND cycle.operation_type='package_cycle'
    WHERE subscription.tenant_id=?1 AND subscription.module_id=?2 AND subscription.id=?3
    LIMIT 1`).bind(input.tenantId,input.moduleId,input.subscriptionId).first<{pet_id:string|null}>()
}

export async function resolveBenefitAllocations(input: {
  db: D1Database
  tenantId: string
  moduleId: string
  clientId: string
  petId: string
  serviceItems: ObjectRow[]
  intent: BillingIntent
}): Promise<{ allocations?: BenefitAllocation[]; code?: string }> {
  const { db, tenantId, moduleId, clientId, petId, serviceItems, intent } = input
  if (intent.type === 'standalone') return intent.allocations.length ? { code: 'STANDALONE_BILLING_HAS_ALLOCATIONS' } : { allocations: [] }
  if (intent.type !== 'subscription') return { allocations: [] }
  if (!intent.allocations.length) return { code: 'PACKAGE_ALLOCATION_REQUIRED' }

  const positions = new Map<string, number[]>()
  serviceItems.forEach((item, index) => {
    const code = text(item.service_code || item.code || item.id)
    if (code) positions.set(code, [...(positions.get(code) || []), index])
  })
  const usedPositions = new Set<number>()
  const subscriptions = new Map<string, SubscriptionRow | null>()
  const bindings = new Map<string, string | null>()
  const allocations: BenefitAllocation[] = []

  for (const requested of intent.allocations) {
    const position = (positions.get(requested.serviceCode) || []).find((index) => !usedPositions.has(index))
    if (position === undefined) return { code: 'PACKAGE_SERVICE_NOT_SELECTED' }
    let subscription = subscriptions.get(requested.subscriptionId)
    if (subscription === undefined) {
      subscription = await db.prepare(`
        SELECT cs.id,cs.client_id,cs.status,sp.name AS plan_name,sp.status AS plan_status,sp.services_json
        FROM client_subscriptions cs
        JOIN subscription_plans sp
          ON sp.tenant_id=cs.tenant_id AND sp.module_id=cs.module_id AND sp.id=cs.plan_id
        WHERE cs.tenant_id=?1 AND cs.module_id=?2 AND cs.id=?3 LIMIT 1
      `).bind(tenantId, moduleId, requested.subscriptionId).first<SubscriptionRow>() || null
      subscriptions.set(requested.subscriptionId, subscription)
    }
    if (!subscription || subscription.status !== 'active' || subscription.plan_status !== 'active') return { code: 'PACKAGE_NOT_ACTIVE' }
    if (subscription.client_id !== clientId) return { code: 'PACKAGE_CLIENT_MISMATCH' }
    let boundPetId = bindings.get(requested.subscriptionId)
    if (boundPetId === undefined) {
      const binding = await packagePetBinding(db,{tenantId,moduleId,subscriptionId:requested.subscriptionId})
      boundPetId = text(binding?.pet_id) || null
      bindings.set(requested.subscriptionId,boundPetId)
    }
    if (!boundPetId) return { code: 'PACKAGE_PET_BINDING_REQUIRED' }
    if (boundPetId !== petId) return { code: 'PACKAGE_PET_MISMATCH' }
    const planService = array(subscription.services_json).find((item) => matchesPlanService(item, requested.serviceCode))
    if (!planService || quantity(planService) <= 0) return { code: 'PACKAGE_SERVICE_NOT_INCLUDED' }
    const snapshot = serviceItems[position]
    const catalogPrice = Number(snapshot.catalog_price ?? snapshot.unit_price ?? 0)
    allocations.push({
      subscriptionId: subscription.id,
      serviceCode: requested.serviceCode,
      benefitKey: text(planService.service_type || planService.service_code || planService.code) || requested.serviceCode,
      position,
      catalogPriceCents: Math.max(0, Math.round((Number.isFinite(catalogPrice) ? catalogPrice : 0) * 100)),
      planName: subscription.plan_name,
    })
    usedPositions.add(position)
  }
  return { allocations }
}

export const allocationOperationKey = (appointmentId: string, allocation: BenefitAllocation) =>
  `appointment-benefit:${appointmentId}:${allocation.position}:${allocation.subscriptionId}:${allocation.benefitKey}`

export const allocationSnapshot = (allocation: BenefitAllocation, status: 'reserved' | 'consumed' | 'released') => ({
  kind: 'service',
  key: allocation.benefitKey,
  service_code: allocation.serviceCode,
  catalog_price: allocation.catalogPriceCents / 100,
  status,
})