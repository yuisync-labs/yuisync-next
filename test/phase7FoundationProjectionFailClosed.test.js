import { describe, expect, it } from 'vitest'

import {
  projectD1Foundation,
  projectSupabaseFoundation,
} from '../scripts/migration/phase7FoundationProjection.mjs'

const scope = { tenant_id: 'tenant-status', module_id: 'petshop' }

function sourceBase() {
  return {
    snapshotId: 'source-status',
    scope,
    tenant: { id: scope.tenant_id, slug: 'tenant-status', name: 'Tenant', active: true },
    profiles: [
      { id: 'user-1', full_name: 'User', role: 'employee', active: true },
    ],
    profileTenants: [
      { profile_id: 'user-1', tenant_id: scope.tenant_id, active: true },
    ],
    settings: [],
  }
}

function destinationBase() {
  return {
    snapshotId: 'destination-status',
    scope,
    tenant: { id: scope.tenant_id, slug: 'tenant-status', name: 'Tenant', status: 'active' },
    identityPrincipals: [
      {
        id: 'principal-1',
        provider: 'supabase',
        subject: 'user-1',
        display_name: 'User',
        status: 'active',
      },
    ],
    tenantMemberships: [
      { tenant_id: scope.tenant_id, principal_id: 'principal-1', status: 'active' },
    ],
    settings: [],
  }
}

describe('phase 7 foundation projection fail-closed status validation', () => {
  it('rejeita tenant legado sem boolean active explícito', () => {
    const input = sourceBase()
    delete input.tenant.active

    expect(() => projectSupabaseFoundation(input)).toThrowError(
      expect.objectContaining({ code: 'SOURCE_TENANT_STATUS_INVALID' }),
    )
  })

  it('rejeita profile legado sem boolean active explícito', () => {
    const input = sourceBase()
    delete input.profiles[0].active

    expect(() => projectSupabaseFoundation(input)).toThrowError(
      expect.objectContaining({ code: 'SOURCE_PROFILE_STATUS_INVALID' }),
    )
  })

  it('rejeita membership legada normal sem boolean active explícito', () => {
    const input = sourceBase()
    delete input.profileTenants[0].active

    expect(() => projectSupabaseFoundation(input)).toThrowError(
      expect.objectContaining({ code: 'SOURCE_MEMBERSHIP_STATUS_INVALID' }),
    )
  })

  it('rejeita tenant D1 com status desconhecido', () => {
    const input = destinationBase()
    input.tenant.status = 'enabled'

    expect(() => projectD1Foundation(input)).toThrowError(
      expect.objectContaining({ code: 'DESTINATION_TENANT_STATUS_INVALID' }),
    )
  })

  it('rejeita principal D1 com status ausente', () => {
    const input = destinationBase()
    delete input.identityPrincipals[0].status

    expect(() => projectD1Foundation(input)).toThrowError(
      expect.objectContaining({ code: 'DESTINATION_IDENTITY_STATUS_INVALID' }),
    )
  })

  it('rejeita membership D1 com status ausente', () => {
    const input = destinationBase()
    delete input.tenantMemberships[0].status

    expect(() => projectD1Foundation(input)).toThrowError(
      expect.objectContaining({ code: 'DESTINATION_MEMBERSHIP_STATUS_INVALID' }),
    )
  })

  it('rejeita IDs físicos duplicados nos snapshots extraídos', () => {
    const source = sourceBase()
    source.profiles.push({ ...source.profiles[0] })
    expect(() => projectSupabaseFoundation(source)).toThrowError(
      expect.objectContaining({ code: 'SOURCE_PROFILE_DUPLICATE' }),
    )

    const destination = destinationBase()
    destination.identityPrincipals.push({ ...destination.identityPrincipals[0] })
    expect(() => projectD1Foundation(destination)).toThrowError(
      expect.objectContaining({ code: 'DESTINATION_PRINCIPAL_ID_DUPLICATE' }),
    )
  })
})
