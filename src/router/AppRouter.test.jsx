import { describe, expect, it } from 'vitest'

import { getAccessiblePages, tenantOnboardingStatus } from './AppRouter'

const Page = () => null
const activeModule = {
  id: 'petshop',
  navSections: [{
    title: 'Principal',
    items: [
      { id: 'dashboard', roles: ['admin_pet', 'funcionario_pet'] },
      { id: 'agenda', roles: ['admin_pet', 'funcionario_pet'], planModule: 'agenda' },
      { id: 'chat', roles: ['admin_pet'], planModule: 'petbot_ai' },
      { id: 'config', roles: ['admin_pet'] },
    ],
  }],
  pages: { dashboard: Page, agenda: Page, chat: Page, config: Page },
}

describe('AppRouter plan and onboarding guards', () => {
  it('combines role and plan access when resolving direct routes', () => {
    const profile = { role: 'owner', module_permissions: { petshop: 'admin_pet' } }
    expect(getAccessiblePages(activeModule, profile, { plan_slug: 'start' })).toEqual([
      'dashboard', 'agenda', 'config',
    ])
    expect(getAccessiblePages(activeModule, profile, { plan_slug: 'prime' })).toEqual([
      'dashboard', 'agenda', 'chat', 'config',
    ])
  })

  it('still applies role restrictions after plan access', () => {
    const profile = { role: 'member', module_permissions: { petshop: 'funcionario_pet' } }
    expect(getAccessiblePages(activeModule, profile, { plan_slug: 'prime' })).toEqual([
      'dashboard', 'agenda',
    ])
  })

  it('accepts current and nested onboarding status shapes', () => {
    expect(tenantOnboardingStatus({ onboarding_status: 'in_progress' })).toBe('in_progress')
    expect(tenantOnboardingStatus({ tenant_first_run: { status: 'COMPLETED' } })).toBe('completed')
    expect(tenantOnboardingStatus({ tenant_first_run_status: 'not_required' })).toBe('not_required')
    expect(tenantOnboardingStatus({})).toBe('')
  })
})
