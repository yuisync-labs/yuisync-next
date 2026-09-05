import {
  consumeUsage,
  readUsage,
  resolveCommercialPlan,
  YUI_AI_OUTBOUND_USAGE_KEY,
  type UsageConsumptionResult,
} from './commercialControlPlane'

export type YuiMessageReservation = Readonly<{
  metered: boolean
  eventKey: string
  result: UsageConsumptionResult | null
}>

export async function reserveYuiOutboundMessage(
  database: D1Database,
  input: Readonly<{
    tenantId: string
    eventKey: string
    moduleId: string
    conversationId: string
    recipient: string
    nowMs?: number
  }>,
): Promise<YuiMessageReservation> {
  const nowMs = input.nowMs ?? Date.now()
  const plan = await resolveCommercialPlan(database, input.tenantId, nowMs)

  // Compatibility mode deliberately preserves existing tenants until they are
  // assigned an explicit SaaS subscription. Migration 0033 makes new tenants
  // explicit Essential subscribers, so they cannot bypass plan enforcement.
  if (plan.fallback) {
    return { metered: false, eventKey: input.eventKey, result: null }
  }

  const result = await consumeUsage(database, {
    tenantId: input.tenantId,
    usageKey: YUI_AI_OUTBOUND_USAGE_KEY,
    eventKey: input.eventKey,
    quantity: 1,
    source: 'whatsapp.assistant',
    metadata: {
      module_id: input.moduleId,
      conversation_id: input.conversationId,
      recipient: input.recipient,
    },
    nowMs,
  })

  return { metered: result.accepted && !result.duplicate, eventKey: input.eventKey, result }
}

export async function releaseYuiOutboundMessage(
  database: D1Database,
  input: Readonly<{
    tenantId: string
    eventKey: string
    nowMs?: number
  }>,
): Promise<void> {
  const nowMs = input.nowMs ?? Date.now()
  await database.prepare(`
    DELETE FROM usage_events
    WHERE tenant_id=?1 AND usage_key=?2 AND event_key=?3
  `).bind(input.tenantId, YUI_AI_OUTBOUND_USAGE_KEY, input.eventKey).run()

  const usage = await readUsage(database, input.tenantId, YUI_AI_OUTBOUND_USAGE_KEY, nowMs)
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
    input.tenantId,
    YUI_AI_OUTBOUND_USAGE_KEY,
    usage.periodStartMs,
    usage.periodEndMs,
    usage.included,
    usage.consumed,
    nowMs,
  ).run()
}
