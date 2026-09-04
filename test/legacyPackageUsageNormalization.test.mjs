import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { projectLegacyCanonicalSnapshot } from '../scripts/migration/legacyCanonicalProjection.mjs'

const tenant_id = 'tenant-1'
const module_id = 'petshop'
const scoped = (row) => ({ tenant_id, module_id, ...row })

function sourceWithCompletedUsage({ capacity = 4, aggregate = 3, completed = 4 } = {}) {
  return {
    tables: {
      petshop_services: [scoped({ id:'service-banho',code:'banho',name:'Banho',group_type:'banho_tosa',active:true })],
      subscription_plans: [scoped({
        id: 'plan-1', name: 'Plano', price: 100, active: true,
        services: [{ service_type: 'banho', qty_per_cycle: capacity }],
      })],
      client_subscriptions: [scoped({
        id: 'subscription-1', plan_id: 'plan-1', client_id: 'client-1', status: 'active',
        services_used: { banho: aggregate }, services_reserved: { banho: 0 },
      })],
      appointments: Array.from({ length: completed }, (_, index) => scoped({
        id: `appointment-${index + 1}`, client_id: 'client-1', pet_id: 'pet-1',
        service_type: 'banho', service_items: [{ code: 'banho', benefit_used: true, benefit_key: 'banho' }],
        status: 'concluido', subscription_id: 'subscription-1', subscription_benefit_status: 'consumed',
      })),
    },
  }
}

describe('legacy package usage normalization', () => {
  it('uses completed allocations when the legacy aggregate is stale but capacity is respected', () => {
    const result = projectLegacyCanonicalSnapshot(sourceWithCompletedUsage(), { tenantId: tenant_id, moduleId: module_id })
    const subscription = result.collections.client_subscriptions[0]

    assert.deepEqual(JSON.parse(subscription.services_used_json), { banho: 4 })
    assert.deepEqual(JSON.parse(subscription.benefit_ledger_base_used_json), { banho: 0 })
    assert.deepEqual(JSON.parse(subscription.legacy_metadata_json).source_services_used, { banho: 3 })
    assert.equal(result.collections.subscription_benefit_allocations.length, 4)
  })

  it('still fails closed when completed allocations exceed plan capacity', () => {
    assert.throws(
      () => projectLegacyCanonicalSnapshot(sourceWithCompletedUsage({ capacity: 3 }), { tenantId: tenant_id, moduleId: module_id }),
      /LEGACY_PACKAGE_USAGE_UNDERFLOW/,
    )
  })

  it('supports an explicit audited exclusion without weakening capacity validation', () => {
    const source = sourceWithCompletedUsage({ capacity: 4, aggregate: 4, completed: 5 })
    source.tables.appointments[4].subscription_benefits = [{
      kind: 'service', key: 'banho', service_code: 'banho', status: 'consumed', catalog_price: 100,
    }]
    source.tables.appointments[4].service_items = [{
      code: 'banho', benefit_used: false, transport_benefit_used: true,
    }]
    const result = projectLegacyCanonicalSnapshot(source, {
      tenantId: tenant_id,
      moduleId: module_id,
      reconciliationOverrides: [{
        action: 'exclude_subscription_benefit',
        appointment_id: 'appointment-5',
        benefit_key: 'banho',
      }],
    })
    const appointment = result.collections.appointments.find((row) => row.id === 'appointment-5')
    const service = result.collections.appointment_services.find((row) => row.appointment_id === 'appointment-5')

    assert.equal(result.collections.subscription_benefit_allocations.length, 4)
    assert.equal(appointment.subscription_id, null)
    assert.equal(appointment.subscription_benefit_used, 0)
    assert.equal(appointment.subscription_benefit_status, 'released')
    assert.equal(appointment.subscription_discount_cents, 0)
    assert.deepEqual(JSON.parse(appointment.subscription_benefits_json), [])
    assert.equal(service.benefit_used, 0)
  })

  it('preserves cancelled subscription allocations as history outside the active D1 ledger', () => {
    const source = sourceWithCompletedUsage({ aggregate: 1, completed: 1 })
    source.tables.client_subscriptions[0].status = 'cancelled'
    const result = projectLegacyCanonicalSnapshot(source, { tenantId:tenant_id,moduleId:module_id })
    const metadata = JSON.parse(result.collections.client_subscriptions[0].legacy_metadata_json)

    assert.equal(result.collections.subscription_benefit_allocations.length, 0)
    assert.equal(metadata.historical_benefit_allocations.length, 1)
    assert.deepEqual(JSON.parse(result.collections.client_subscriptions[0].benefit_ledger_base_used_json), { banho:1 })
  })
})
