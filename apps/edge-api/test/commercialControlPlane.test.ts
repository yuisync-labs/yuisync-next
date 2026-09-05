import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'

import {
  consumeUsage,
  readUsage,
  resolveCommercialEntitlement,
  resolveCommercialPlan,
  YUI_AI_OUTBOUND_USAGE_KEY,
} from '../src/commercialControlPlane'
import { releaseYuiOutboundMessage, reserveYuiOutboundMessage } from '../src/commercialYuiMeter'

const testEnv = env as EdgeEnv & { DB: D1Database }

async function seedTenant(id: string) {
  const now = Date.now()
  await testEnv.DB.prepare(`
    INSERT INTO tenants(id,slug,name,status,created_at_ms,updated_at_ms)
    VALUES(?1,?2,?3,'active',?4,?4)
  `).bind(id, id, id, now).run()
}

async function setPlan(tenantId: string, planVersionId: string, now = Date.now()) {
  const start = now - 60_000
  const end = now + 86_400_000
  await testEnv.DB.prepare(`
    UPDATE tenant_subscriptions
    SET plan_version_id=?2,status='active',current_period_start_ms=?3,current_period_end_ms=?4,updated_at_ms=?5
    WHERE tenant_id=?1
  `).bind(tenantId, planVersionId, start, end, now).run()
}

async function setSubscriptionStatus(
  tenantId: string,
  status: 'active' | 'trialing' | 'past_due' | 'canceled' | 'suspended',
  periodEndMs: number,
  now = Date.now(),
) {
  await testEnv.DB.prepare(`
    UPDATE tenant_subscriptions
    SET status=?2,current_period_start_ms=?3,current_period_end_ms=?4,updated_at_ms=?3
    WHERE tenant_id=?1
  `).bind(tenantId, status, now - 60_000, periodEndMs).run()
}

describe('commercial control plane', () => {
  it('seeds the three commercial prices and Business with 1000 Yui messages', async () => {
    const rows = await testEnv.DB.prepare(`
      SELECT id,monthly_price_cents
      FROM saas_plan_versions
      WHERE id IN ('essential@2026-09','pro@2026-09','business@2026-09')
      ORDER BY monthly_price_cents
    `).all<{ id: string; monthly_price_cents: number }>()

    expect(rows.results).toEqual([
      { id: 'essential@2026-09', monthly_price_cents: 14900 },
      { id: 'pro@2026-09', monthly_price_cents: 27900 },
      { id: 'business@2026-09', monthly_price_cents: 44900 },
    ])

    const tenantId = 'tenant-commercial-business-quota'
    await seedTenant(tenantId)
    await setPlan(tenantId, 'business@2026-09')
    const entitlement = await resolveCommercialEntitlement(testEnv.DB, tenantId, YUI_AI_OUTBOUND_USAGE_KEY)
    expect(entitlement).toMatchObject({ enabled: true, quota: 1000 })
  })

  it('assigns new tenants to Essential automatically', async () => {
    const tenantId = 'tenant-commercial-default-essential'
    await seedTenant(tenantId)
    const plan = await resolveCommercialPlan(testEnv.DB, tenantId)
    expect(plan).toMatchObject({
      planVersionId: 'essential@2026-09',
      monthlyPriceCents: 14900,
      fallback: false,
    })
    const users = await resolveCommercialEntitlement(testEnv.DB, tenantId, 'users.max')
    expect(users).toMatchObject({ enabled: true, quota: 3 })
  })

  it('does not allow autonomous Yui consumption on Pro', async () => {
    const tenantId = 'tenant-commercial-pro-yui'
    await seedTenant(tenantId)
    await setPlan(tenantId, 'pro@2026-09')
    const result = await consumeUsage(testEnv.DB, {
      tenantId,
      usageKey: YUI_AI_OUTBOUND_USAGE_KEY,
      eventKey: 'message-pro-1',
      source: 'test',
    })
    expect(result).toMatchObject({ accepted: false, duplicate: false, reason: 'feature_disabled' })
  })

  it('is idempotent and enforces the configured hard quota', async () => {
    const tenantId = 'tenant-commercial-idempotent'
    const now = Date.now()
    await seedTenant(tenantId)
    await setPlan(tenantId, 'business@2026-09', now)
    await testEnv.DB.prepare(`
      INSERT INTO tenant_entitlement_overrides(
        tenant_id,entitlement_key,enabled,quota_value,reason,created_at_ms,updated_at_ms
      ) VALUES(?1,?2,1,2,'test hard cap',?3,?3)
    `).bind(tenantId, YUI_AI_OUTBOUND_USAGE_KEY, now).run()

    const first = await consumeUsage(testEnv.DB, {
      tenantId, usageKey: YUI_AI_OUTBOUND_USAGE_KEY, eventKey: 'message-1', source: 'test', nowMs: now,
    })
    const retry = await consumeUsage(testEnv.DB, {
      tenantId, usageKey: YUI_AI_OUTBOUND_USAGE_KEY, eventKey: 'message-1', source: 'test', nowMs: now,
    })
    const second = await consumeUsage(testEnv.DB, {
      tenantId, usageKey: YUI_AI_OUTBOUND_USAGE_KEY, eventKey: 'message-2', source: 'test', nowMs: now,
    })
    const overflow = await consumeUsage(testEnv.DB, {
      tenantId, usageKey: YUI_AI_OUTBOUND_USAGE_KEY, eventKey: 'message-3', source: 'test', nowMs: now,
    })

    expect(first.accepted).toBe(true)
    expect(retry).toMatchObject({ accepted: true, duplicate: true })
    expect(second.accepted).toBe(true)
    expect(overflow).toMatchObject({ accepted: false, duplicate: false, reason: 'quota_exceeded' })
    expect((await readUsage(testEnv.DB, tenantId, YUI_AI_OUTBOUND_USAGE_KEY, now)).consumed).toBe(2)
  })

  it('releases a reserved Yui unit when provider delivery fails', async () => {
    const tenantId = 'tenant-commercial-release'
    const now = Date.now()
    await seedTenant(tenantId)
    await setPlan(tenantId, 'business@2026-09', now)

    const reservation = await reserveYuiOutboundMessage(testEnv.DB, {
      tenantId,
      eventKey: 'internal-message-1',
      moduleId: 'petshop',
      conversationId: 'wa:5511999999999',
      recipient: '5511999999999',
      nowMs: now,
    })
    expect(reservation.result?.accepted).toBe(true)
    expect((await readUsage(testEnv.DB, tenantId, YUI_AI_OUTBOUND_USAGE_KEY, now)).consumed).toBe(1)

    await releaseYuiOutboundMessage(testEnv.DB, { tenantId, eventKey: reservation.eventKey, nowMs: now })
    expect((await readUsage(testEnv.DB, tenantId, YUI_AI_OUTBOUND_USAGE_KEY, now)).consumed).toBe(0)
  })

  it('keeps pre-control-plane tenants in compatibility mode until explicit backfill', async () => {
    const tenantId = 'tenant-commercial-legacy-compat'
    await seedTenant(tenantId)
    await testEnv.DB.prepare('DELETE FROM tenant_subscriptions WHERE tenant_id=?1').bind(tenantId).run()
    const plan = await resolveCommercialPlan(testEnv.DB, tenantId)
    expect(plan.fallback).toBe(true)

    const reservation = await reserveYuiOutboundMessage(testEnv.DB, {
      tenantId,
      eventKey: 'legacy-message',
      moduleId: 'petshop',
      conversationId: 'wa:5511888888888',
      recipient: '5511888888888',
    })
    expect(reservation).toMatchObject({ metered: false, result: null })
  })

  it('does not turn suspended subscribers into compatibility-mode tenants', async () => {
    const tenantId = 'tenant-commercial-suspended'
    const now = Date.now()
    await seedTenant(tenantId)
    await setPlan(tenantId, 'business@2026-09', now)
    await setSubscriptionStatus(tenantId, 'suspended', now + 86_400_000, now)

    const plan = await resolveCommercialPlan(testEnv.DB, tenantId, now)
    expect(plan).toMatchObject({ fallback: false, subscriptionStatus: 'suspended', planVersionId: 'business@2026-09' })
    const result = await consumeUsage(testEnv.DB, {
      tenantId,
      usageKey: YUI_AI_OUTBOUND_USAGE_KEY,
      eventKey: 'message-suspended-1',
      source: 'test',
      nowMs: now,
    })
    expect(result).toMatchObject({ accepted: false, reason: 'feature_disabled' })
  })

  it('keeps canceled access until paid period end and disables it afterwards', async () => {
    const tenantId = 'tenant-commercial-canceled'
    const now = Date.now()
    await seedTenant(tenantId)
    await setPlan(tenantId, 'business@2026-09', now)
    await setSubscriptionStatus(tenantId, 'canceled', now + 60_000, now)

    const beforeEnd = await resolveCommercialEntitlement(testEnv.DB, tenantId, YUI_AI_OUTBOUND_USAGE_KEY, now)
    expect(beforeEnd.enabled).toBe(true)

    const afterEnd = await resolveCommercialEntitlement(testEnv.DB, tenantId, YUI_AI_OUTBOUND_USAGE_KEY, now + 120_000)
    expect(afterEnd.enabled).toBe(false)
  })

  it('keeps past-due subscriptions in grace while billing policy handles recovery', async () => {
    const tenantId = 'tenant-commercial-past-due'
    const now = Date.now()
    await seedTenant(tenantId)
    await setPlan(tenantId, 'business@2026-09', now)
    await setSubscriptionStatus(tenantId, 'past_due', now + 86_400_000, now)

    const entitlement = await resolveCommercialEntitlement(testEnv.DB, tenantId, YUI_AI_OUTBOUND_USAGE_KEY, now)
    expect(entitlement.enabled).toBe(true)
  })

  it('fails closed for metered usage when an active billing period is stale', async () => {
    const tenantId = 'tenant-commercial-stale-period'
    const now = Date.now()
    await seedTenant(tenantId)
    await setPlan(tenantId, 'business@2026-09', now)
    await testEnv.DB.prepare(`
      UPDATE tenant_subscriptions
      SET status='active',current_period_start_ms=?2,current_period_end_ms=?3,updated_at_ms=?4
      WHERE tenant_id=?1
    `).bind(tenantId, now - 120_000, now - 60_000, now).run()

    const result = await consumeUsage(testEnv.DB, {
      tenantId,
      usageKey: YUI_AI_OUTBOUND_USAGE_KEY,
      eventKey: 'message-stale-period-1',
      source: 'test',
      nowMs: now,
    })
    expect(result).toMatchObject({ accepted: false, duplicate: false, reason: 'billing_period_inactive' })
    expect((await readUsage(testEnv.DB, tenantId, YUI_AI_OUTBOUND_USAGE_KEY, now)).consumed).toBe(0)
  })
})
