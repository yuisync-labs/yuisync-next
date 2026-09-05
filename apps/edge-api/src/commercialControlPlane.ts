export const DEFAULT_SAAS_PLAN_VERSION = 'essential@2026-09'
export const YUI_AI_OUTBOUND_USAGE_KEY = 'yui.ai_outbound_messages'

export type CommercialPlanSnapshot = Readonly<{
  tenantId: string
  planId: string
  planName: string
  planVersionId: string
  monthlyPriceCents: number
  currency: 'BRL'
  subscriptionStatus: string
  periodStartMs: number
  periodEndMs: number
  fallback: boolean
}>

export type CommercialEntitlement = Readonly<{
  key: string
  enabled: boolean
  quota: number | null
  config: Record<string, unknown>
  overridden: boolean
}>

export type UsageSnapshot = Readonly<{
  key: string
  included: number | null
  consumed: number
  remaining: number | null
  periodStartMs: number
  periodEndMs: number
}>

export type UsageConsumptionResult = Readonly<{
  accepted: boolean
  duplicate: boolean
  reason?: 'feature_disabled' | 'quota_exceeded' | 'billing_period_inactive'
  usage: UsageSnapshot
}>

type PlanRow = {
  tenant_id: string | null
  plan_id: string
  plan_name: string
  plan_version_id: string
  monthly_price_cents: number
  currency: string
  subscription_status: string | null
  current_period_start_ms: number | null
  current_period_end_ms: number | null
}

type EntitlementRow = {
  enabled: number | null
  quota_value: number | null
  config_json: string | null
}

type OverrideRow = EntitlementRow & { entitlement_key: string }

type UsageCountRow = { consumed: number | null }

function parseConfig(raw: string | null): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw || '{}')
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {}
  } catch {
    return {}
  }
}

function monthPeriod(nowMs: number): { start: number; end: number } {
  const date = new Date(nowMs)
  const start = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1)
  const end = Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1)
  return { start, end }
}

function positiveInteger(value: number | null | undefined): number | null {
  return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : null
}

function subscriptionAllowsEntitlements(plan: CommercialPlanSnapshot, nowMs: number): boolean {
  if (plan.fallback) return true
  if (plan.subscriptionStatus === 'active' || plan.subscriptionStatus === 'trialing' || plan.subscriptionStatus === 'past_due') {
    return true
  }
  return plan.subscriptionStatus === 'canceled' && plan.periodEndMs > nowMs
}

function meteredBillingPeriodIsActive(plan: CommercialPlanSnapshot, nowMs: number): boolean {
  if (plan.fallback) return true
  return Number.isSafeInteger(plan.periodStartMs)
    && Number.isSafeInteger(plan.periodEndMs)
    && plan.periodStartMs <= nowMs
    && nowMs < plan.periodEndMs
}

export async function resolveCommercialPlan(
  database: D1Database,
  tenantId: string,
  nowMs = Date.now(),
): Promise<CommercialPlanSnapshot> {
  // Presence of a subscription row is authoritative even when it is suspended or
  // canceled. Compatibility fallback is reserved exclusively for tenants that
  // predate the commercial control plane and have no subscription row at all.
  const row = await database.prepare(`
    SELECT s.tenant_id,
           p.id AS plan_id,
           p.name AS plan_name,
           v.id AS plan_version_id,
           v.monthly_price_cents,
           v.currency,
           s.status AS subscription_status,
           s.current_period_start_ms,
           s.current_period_end_ms
    FROM tenant_subscriptions s
    JOIN saas_plan_versions v ON v.id=s.plan_version_id
    JOIN saas_plans p ON p.id=v.plan_id
    WHERE s.tenant_id=?1
    LIMIT 1
  `).bind(tenantId).first<PlanRow>()

  if (row) {
    return {
      tenantId,
      planId: row.plan_id,
      planName: row.plan_name,
      planVersionId: row.plan_version_id,
      monthlyPriceCents: row.monthly_price_cents,
      currency: 'BRL',
      subscriptionStatus: row.subscription_status || 'active',
      periodStartMs: Number(row.current_period_start_ms),
      periodEndMs: Number(row.current_period_end_ms),
      fallback: false,
    }
  }

  const fallback = await database.prepare(`
    SELECT NULL AS tenant_id,
           p.id AS plan_id,
           p.name AS plan_name,
           v.id AS plan_version_id,
           v.monthly_price_cents,
           v.currency,
           NULL AS subscription_status,
           NULL AS current_period_start_ms,
           NULL AS current_period_end_ms
    FROM saas_plan_versions v
    JOIN saas_plans p ON p.id=v.plan_id
    WHERE v.id=?1
    LIMIT 1
  `).bind(DEFAULT_SAAS_PLAN_VERSION).first<PlanRow>()

  if (!fallback) throw new Error('COMMERCIAL_CATALOG_NOT_CONFIGURED')
  const period = monthPeriod(nowMs)
  return {
    tenantId,
    planId: fallback.plan_id,
    planName: fallback.plan_name,
    planVersionId: fallback.plan_version_id,
    monthlyPriceCents: fallback.monthly_price_cents,
    currency: 'BRL',
    subscriptionStatus: 'legacy_fallback',
    periodStartMs: period.start,
    periodEndMs: period.end,
    fallback: true,
  }
}

export async function resolveCommercialEntitlement(
  database: D1Database,
  tenantId: string,
  entitlementKey: string,
  nowMs = Date.now(),
): Promise<CommercialEntitlement> {
  const plan = await resolveCommercialPlan(database, tenantId, nowMs)
  const override = await database.prepare(`
    SELECT entitlement_key,enabled,quota_value,config_json
    FROM tenant_entitlement_overrides
    WHERE tenant_id=?1 AND entitlement_key=?2
      AND (effective_until_ms IS NULL OR effective_until_ms>?3)
    LIMIT 1
  `).bind(tenantId, entitlementKey, nowMs).first<OverrideRow>()

  const base = await database.prepare(`
    SELECT enabled,quota_value,config_json
    FROM saas_plan_entitlements
    WHERE plan_version_id=?1 AND entitlement_key=?2
    LIMIT 1
  `).bind(plan.planVersionId, entitlementKey).first<EntitlementRow>()

  const baseEnabled = base?.enabled === 1
  const baseQuota = positiveInteger(base?.quota_value)
  const baseConfig = parseConfig(base?.config_json || null)

  // Subscription status is a higher-level gate than plan entitlements and tenant
  // overrides. A suspended/expired subscription cannot re-enable paid capabilities
  // through an override. Past-due remains in grace until billing policy says otherwise.
  if (!subscriptionAllowsEntitlements(plan, nowMs)) {
    return {
      key: entitlementKey,
      enabled: false,
      quota: baseQuota,
      config: baseConfig,
      overridden: false,
    }
  }

  if (!override) {
    return {
      key: entitlementKey,
      enabled: baseEnabled,
      quota: baseQuota,
      config: baseConfig,
      overridden: false,
    }
  }

  return {
    key: entitlementKey,
    enabled: override.enabled == null ? baseEnabled : override.enabled === 1,
    quota: override.quota_value == null ? baseQuota : positiveInteger(override.quota_value),
    config: override.config_json == null ? baseConfig : parseConfig(override.config_json),
    overridden: true,
  }
}

export async function readUsage(
  database: D1Database,
  tenantId: string,
  usageKey: string,
  nowMs = Date.now(),
): Promise<UsageSnapshot> {
  const plan = await resolveCommercialPlan(database, tenantId, nowMs)
  const entitlement = await resolveCommercialEntitlement(database, tenantId, usageKey, nowMs)
  const count = await database.prepare(`
    SELECT COALESCE(SUM(quantity),0) AS consumed
    FROM usage_events
    WHERE tenant_id=?1 AND usage_key=?2
      AND occurred_at_ms>=?3 AND occurred_at_ms<?4
  `).bind(tenantId, usageKey, plan.periodStartMs, plan.periodEndMs).first<UsageCountRow>()
  const consumed = Number(count?.consumed || 0)
  const included = entitlement.quota
  return {
    key: usageKey,
    included,
    consumed,
    remaining: included == null ? null : Math.max(0, included - consumed),
    periodStartMs: plan.periodStartMs,
    periodEndMs: plan.periodEndMs,
  }
}

export async function consumeUsage(
  database: D1Database,
  input: Readonly<{
    tenantId: string
    usageKey: string
    eventKey: string
    quantity?: number
    source: string
    metadata?: Record<string, unknown>
    nowMs?: number
  }>,
): Promise<UsageConsumptionResult> {
  const nowMs = input.nowMs ?? Date.now()
  const quantity = input.quantity ?? 1
  if (!Number.isSafeInteger(quantity) || quantity <= 0) throw new Error('INVALID_USAGE_QUANTITY')

  const plan = await resolveCommercialPlan(database, input.tenantId, nowMs)
  const entitlement = await resolveCommercialEntitlement(database, input.tenantId, input.usageKey, nowMs)
  const before = await readUsage(database, input.tenantId, input.usageKey, nowMs)
  if (!entitlement.enabled) {
    return { accepted: false, duplicate: false, reason: 'feature_disabled', usage: before }
  }

  // Never roll a paid usage quota implicitly. Billing must advance the subscription
  // period first. Otherwise a stale period could make new events fall outside the SUM
  // window and accidentally create unlimited usage after period_end.
  if (!meteredBillingPeriodIsActive(plan, nowMs)) {
    return { accepted: false, duplicate: false, reason: 'billing_period_inactive', usage: before }
  }

  const existing = await database.prepare(`
    SELECT id FROM usage_events
    WHERE tenant_id=?1 AND usage_key=?2 AND event_key=?3
    LIMIT 1
  `).bind(input.tenantId, input.usageKey, input.eventKey).first<{ id: string }>()
  if (existing) return { accepted: true, duplicate: true, usage: before }

  const id = crypto.randomUUID()
  const metadataJson = JSON.stringify(input.metadata || {})
  const quota = entitlement.quota

  const inserted = quota == null
    ? await database.prepare(`
        INSERT OR IGNORE INTO usage_events(
          id,tenant_id,usage_key,event_key,quantity,source,metadata_json,occurred_at_ms,created_at_ms
        ) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?8)
      `).bind(id,input.tenantId,input.usageKey,input.eventKey,quantity,input.source,metadataJson,nowMs).run()
    : await database.prepare(`
        INSERT OR IGNORE INTO usage_events(
          id,tenant_id,usage_key,event_key,quantity,source,metadata_json,occurred_at_ms,created_at_ms
        )
        SELECT ?1,?2,?3,?4,?5,?6,?7,?8,?8
        WHERE (
          SELECT COALESCE(SUM(quantity),0)
          FROM usage_events
          WHERE tenant_id=?2 AND usage_key=?3
            AND occurred_at_ms>=?9 AND occurred_at_ms<?10
        ) + ?5 <= ?11
      `).bind(
        id,input.tenantId,input.usageKey,input.eventKey,quantity,input.source,metadataJson,nowMs,
        plan.periodStartMs,plan.periodEndMs,quota,
      ).run()

  const changes = Number((inserted.meta as { changes?: number } | undefined)?.changes || 0)
  if (changes === 0) {
    const duplicate = await database.prepare(`
      SELECT id FROM usage_events
      WHERE tenant_id=?1 AND usage_key=?2 AND event_key=?3
      LIMIT 1
    `).bind(input.tenantId,input.usageKey,input.eventKey).first<{ id: string }>()
    const usage = await readUsage(database, input.tenantId, input.usageKey, nowMs)
    return duplicate
      ? { accepted: true, duplicate: true, usage }
      : { accepted: false, duplicate: false, reason: 'quota_exceeded', usage }
  }

  const usage = await readUsage(database, input.tenantId, input.usageKey, nowMs)
  await database.prepare(`
    INSERT INTO usage_counters(
      tenant_id,usage_key,period_start_ms,period_end_ms,included_quantity,consumed_quantity,updated_at_ms
    ) VALUES(?1,?2,?3,?4,?5,?6,?7)
    ON CONFLICT(tenant_id,usage_key,period_start_ms) DO UPDATE SET
      period_end_ms=excluded.period_end_ms,
      included_quantity=excluded.included_quantity,
      consumed_quantity=excluded.consumed_quantity,
      updated_at_ms=excluded.updated_at_ms
  `).bind(
    input.tenantId,input.usageKey,usage.periodStartMs,usage.periodEndMs,
    usage.included,usage.consumed,nowMs,
  ).run()
  return { accepted: true, duplicate: false, usage }
}
