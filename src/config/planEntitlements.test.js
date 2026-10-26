import { describe, expect, it } from 'vitest'

import {
  PLAN_ENTITLEMENTS,
  canAccessPlanItem,
  hasPlanModule,
  normalizePlanSlug,
  planDefinition,
} from './planEntitlements'

describe('plan entitlements', () => {
  it.each([
    ['start', 'yui-start'],
    ['yui_start', 'yui-start'],
    ['YUI-PRO', 'yui-pro'],
    ['prime', 'yui-prime-ia'],
    ['yui_prime_ia', 'yui-prime-ia'],
    ['elite', 'yui-elite'],
    ['', null],
    ['desconhecido', null],
  ])('normalizes %s to %s', (input, expected) => {
    expect(normalizePlanSlug(input)).toBe(expected)
  })

  it('keeps the plan matrix cumulative and immutable', () => {
    expect(PLAN_ENTITLEMENTS['yui-start'].modules).toEqual([
      'agenda', 'clients_pets', 'sales_pos', 'cash_control', 'inventory',
    ])
    expect(PLAN_ENTITLEMENTS['yui-pro'].modules).toEqual(expect.arrayContaining([
      ...PLAN_ENTITLEMENTS['yui-start'].modules,
      'service_orders_delivery', 'whatsapp_basic', 'team_commissions',
    ]))
    expect(PLAN_ENTITLEMENTS['yui-prime-ia'].modules).toEqual(expect.arrayContaining([
      ...PLAN_ENTITLEMENTS['yui-pro'].modules,
      'petbot_ai', 'campaigns_reengagement', 'ai_satisfaction',
    ]))
    expect(PLAN_ENTITLEMENTS['yui-elite'].modules).toEqual(expect.arrayContaining([
      ...PLAN_ENTITLEMENTS['yui-prime-ia'].modules,
      'multi_instance', 'custom_configuration',
    ]))
    expect(Object.isFrozen(PLAN_ENTITLEMENTS['yui-start'].modules)).toBe(true)
  })

  it('returns a normalized definition', () => {
    expect(planDefinition('yui_prime_ia')).toEqual({
      slug: 'yui-prime-ia',
      name: 'Yui Prime IA',
      modules: PLAN_ENTITLEMENTS['yui-prime-ia'].modules,
    })
    expect(planDefinition('invalid')).toBeNull()
  })

  it('checks arrays and sets without coercing invalid module ids', () => {
    expect(hasPlanModule(['agenda'], 'agenda')).toBe(true)
    expect(hasPlanModule(new Set(['inventory']), 'inventory')).toBe(true)
    expect(hasPlanModule(['agenda'], '')).toBe(false)
    expect(hasPlanModule(null, 'agenda')).toBe(false)
  })

  it('uses explicit tenant modules before plan defaults', () => {
    const item = { planModule: 'petbot_ai' }
    expect(canAccessPlanItem(item, { plan_slug: 'yui-prime-ia' })).toBe(true)
    expect(canAccessPlanItem(item, { plan_slug: 'yui-start' })).toBe(false)
    expect(canAccessPlanItem(item, { plan_slug: 'yui-prime-ia', allowed_modules: ['agenda'] })).toBe(false)
  })

  it('supports multiple requirements and preserves tenants without plan metadata', () => {
    const item = { planModules: ['agenda', 'inventory'] }
    expect(canAccessPlanItem(item, { allowed_modules: ['agenda', 'inventory'] })).toBe(true)
    expect(canAccessPlanItem(item, { allowed_modules: ['agenda'] })).toBe(false)
    expect(canAccessPlanItem(item, { enabled_modules: ['petshop'] })).toBe(true)
    expect(canAccessPlanItem({ id: 'legacy-page' }, { allowed_modules: [] })).toBe(true)
  })
})
