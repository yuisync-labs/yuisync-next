import { describe, expect, it } from 'vitest'

import { modulePermissionForTenant } from './authPermissions'

describe('modulePermissionForTenant', () => {
  it('normalizes the legacy admin_petshop alias used by migrated tenants', () => {
    expect(modulePermissionForTenant({
      role: 'owner',
      module_permissions: { petshop: { role: 'admin_petshop' } },
    }, 'petshop')).toBe('admin_pet')
  })

  it('keeps the canonical petshop role', () => {
    expect(modulePermissionForTenant({
      role: 'owner',
      module_permissions: { petshop: { role: 'admin_pet' } },
    }, 'petshop')).toBe('admin_pet')
  })
})
