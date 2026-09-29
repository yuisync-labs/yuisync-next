import assert from 'node:assert/strict'
import test from 'node:test'

import {
  COMMERCIAL_CONTROL_TABLES,
  tenantScopedDeleteOrder,
} from '../scripts/migration/staging-e2e-fixtures.mjs'

test('fixture cleanup excludes the complete commercial control-plane graph', () => {
  assert.deepEqual(
    [...COMMERCIAL_CONTROL_TABLES].sort(),
    [
      'platform_billing_subscriptions',
      'platform_checkout_orders',
      'platform_onboarding_invitations',
      'platform_stripe_webhook_events',
    ],
  )

  const deleteOrder = tenantScopedDeleteOrder([
    {
      name: 'tenants',
      sql: 'CREATE TABLE tenants (id TEXT PRIMARY KEY)',
    },
    {
      name: 'operational_rows',
      sql: 'CREATE TABLE operational_rows (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id))',
    },
    {
      name: 'platform_checkout_orders',
      sql: 'CREATE TABLE platform_checkout_orders (id TEXT PRIMARY KEY, tenant_id TEXT REFERENCES tenants(id))',
    },
    {
      name: 'platform_billing_subscriptions',
      sql: 'CREATE TABLE platform_billing_subscriptions (id TEXT PRIMARY KEY, tenant_id TEXT REFERENCES tenants(id), checkout_order_id TEXT REFERENCES platform_checkout_orders(id))',
    },
    {
      name: 'platform_onboarding_invitations',
      sql: 'CREATE TABLE platform_onboarding_invitations (id TEXT PRIMARY KEY, checkout_order_id TEXT REFERENCES platform_checkout_orders(id))',
    },
    {
      name: 'platform_stripe_webhook_events',
      sql: 'CREATE TABLE platform_stripe_webhook_events (id TEXT PRIMARY KEY)',
    },
  ])

  assert.deepEqual(deleteOrder, ['operational_rows'])
})
