import { describe, expect, it } from 'vitest'

import { projectLegacyCanonicalSnapshot } from '../scripts/migration/legacyCanonicalProjection.mjs'

const tenant_id = 'tenant-1'
const module_id = 'petshop'
const scoped = (row) => ({ tenant_id, module_id, ...row })

describe('legacy canonical projection v2', () => {
  it('preserves store hours, service policy, appointment snapshots and grooming machine', () => {
    const result = projectLegacyCanonicalSnapshot({ tables: {
      products: [], stock_movements: [], sales: [], sale_items: [], sale_payment_splits: [], chat_sessions: [], chat_messages: [], fiscal_documents: [],
      settings: [scoped({
        petbot_business_hours: { '1': [{ open: '08:00', close: '17:00' }] },
        store_business_hours: { '1': [{ open: '08:00', close: '18:00' }] },
        updated_at: '2026-08-19T10:00:00Z',
      })],
      petshop_services: [scoped({
        id: 'service-1', code: 'banho', name: 'Banho', group_type: 'banho_tosa', default_price: 55,
        default_duration_min: 60, commission_rate: 5, min_weight_kg: 0, max_weight_kg: 10,
        species_target: 'dog', active: true, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-08-19T10:00:00Z',
      })],
      appointments: [scoped({
        id: 'appointment-1', client_id: 'client-1', pet_id: 'pet-1', service_type: 'banho', service_group: 'banho_tosa',
        service_items: [{ code: 'banho', name: 'Banho', group_type: 'banho_tosa', unit_price: 55, catalog_price: 55, duration_min: 60,
          commission_rate: 5, min_weight_kg: 0, max_weight_kg: 10, species_target: 'dog', benefit_used: false }],
        scheduled_at: '2026-08-20T12:00:00Z', duration_min: 60, price: 55, status: 'agendado', source: 'agenda',
        grooming_machine_no: 7, employee_id: 'employee-1', groomer_id: 'groomer-1', live_status: 'aguardando',
        created_at: '2026-08-19T10:00:00Z', updated_at: '2026-08-19T10:00:00Z',
      })],
    } }, { tenantId: tenant_id, moduleId: module_id })

    const extension = result.collections.module_settings_extensions[0]
    expect(JSON.parse(extension.data_json).store_business_hours['1'][0]).toEqual({ open: '08:00', close: '18:00' })

    expect(result.collections.services[0]).toMatchObject({
      code: 'banho', min_weight_kg: 0, max_weight_kg: 10,
      min_weight_grams: 0, max_weight_grams: 10_000, species_target: 'dog',
    })
    expect(result.collections.appointments[0]).toMatchObject({
      id: 'appointment-1', grooming_machine_no: 7, employee_id: 'employee-1', groomer_id: 'groomer-1',
    })
    expect(result.collections.appointment_services[0]).toMatchObject({
      catalog_price_cents: 5500, commission_basis_points: 500,
      min_weight_grams: 0, max_weight_grams: 10_000, species_target: 'dog',
    })
  })

  it('turns legacy package usage into canonical base usage plus allocation ledger', () => {
    const result = projectLegacyCanonicalSnapshot({ tables: {
      products: [], petshop_services: [], stock_movements: [], settings: [], sales: [], sale_items: [], sale_payment_splits: [], chat_sessions: [], chat_messages: [], fiscal_documents: [],
      subscription_plans: [scoped({
        id: 'plan-1', name: '4 Banhos', price: 180, billing_cycle: 'monthly', active: true,
        services: [{ service_type: 'banho', qty_per_cycle: 4 }], created_at: '2026-01-01T00:00:00Z', updated_at: '2026-08-19T10:00:00Z',
      })],
      client_subscriptions: [scoped({
        id: 'subscription-1', plan_id: 'plan-1', client_id: 'client-1', status: 'active',
        services_used: { banho: 2 }, services_reserved: { banho: 0 }, started_at: '2026-08-01',
        created_at: '2026-08-01T00:00:00Z', updated_at: '2026-08-19T10:00:00Z',
      })],
      appointments: [scoped({
        id: 'appointment-used', client_id: 'client-1', pet_id: 'pet-1', service_type: 'banho',
        service_items: [{ code: 'banho', name: 'Banho', unit_price: 55, catalog_price: 55, benefit_used: true, benefit_key: 'banho' }],
        scheduled_at: '2026-08-10T12:00:00Z', duration_min: 60, price: 0, status: 'concluido', source: 'agenda',
        subscription_id: 'subscription-1', subscription_benefit_used: true, subscription_benefit_status: 'consumed',
        created_at: '2026-08-09T10:00:00Z', updated_at: '2026-08-10T13:00:00Z',
      })],
    } }, { tenantId: tenant_id, moduleId: module_id })

    const subscription = result.collections.client_subscriptions[0]
    expect(JSON.parse(subscription.services_used_json)).toEqual({ banho: 2 })
    expect(JSON.parse(subscription.benefit_ledger_base_used_json)).toEqual({ banho: 1 })
    expect(JSON.parse(subscription.legacy_metadata_json).services_reserved).toEqual({ banho: 0 })

    expect(result.collections.subscription_benefit_allocations).toHaveLength(1)
    expect(result.collections.subscription_benefit_allocations[0]).toMatchObject({
      subscription_id: 'subscription-1', appointment_id: 'appointment-used', benefit_kind: 'service',
      benefit_key: 'banho', service_code: 'banho', state: 'consumed', catalog_price_cents: 5500,
    })
  })

  it('preserves loyalty expiry and legacy support assignment fields', () => {
    const result = projectLegacyCanonicalSnapshot({ tables: {
      products: [], petshop_services: [], stock_movements: [], settings: [], appointments: [], sales: [], sale_items: [], sale_payment_splits: [], chat_sessions: [], chat_messages: [], fiscal_documents: [],
      loyalty_settings: [scoped({ points_per_real: 1, points_per_service: 10, redemption_rate: 100, expiry_days: 365, updated_at: '2026-08-19T10:00:00Z' })],
      loyalty_points: [scoped({ id: 'points-1', client_id: 'client-1', points: 20, reason: 'compra', reference_id: 'sale-1', expires_at: '2027-08-19', created_at: '2026-08-19T10:00:00Z' })],
      support_threads: [scoped({ id: 'thread-1', requester_profile_id: 'profile-1', assigned_to: 'profile-2', status: 'pending', priority: 'high', source: 'widget', subject: 'Ajuda', last_message_preview: 'Preciso de ajuda', created_at: '2026-08-19T10:00:00Z', updated_at: '2026-08-19T10:00:00Z' })],
      support_messages: [scoped({ id: 'message-1', thread_id: 'thread-1', sender_profile_id: 'profile-1', sender_type: 'customer', body: 'Preciso de ajuda', created_at: '2026-08-19T10:00:00Z' })],
    } }, { tenantId: tenant_id, moduleId: module_id })

    expect(result.collections.loyalty_points[0]).toMatchObject({ id: 'points-1', points_delta: 20, balance_after: 20 })
    expect(result.collections.loyalty_points[0].expires_at_ms).toBe(Date.parse('2027-08-19'))
    expect(result.collections.support_threads[0]).toMatchObject({
      id: 'thread-1', assigned_to: 'profile-2', last_message_preview: 'Preciso de ajuda', priority: 'high',
    })
  })

  it('fails closed for an invalid legacy grooming machine value', () => {
    expect(() => projectLegacyCanonicalSnapshot({ tables: {
      appointments: [scoped({
        id: 'appointment-invalid', scheduled_at: '2026-08-20T12:00:00Z', status: 'agendado', grooming_machine_no: 5,
      })],
    } }, { tenantId: tenant_id, moduleId: module_id })).toThrow('LEGACY_GROOMING_MACHINE_INVALID')
  })
})
