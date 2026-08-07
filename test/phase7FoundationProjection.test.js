import { describe, expect, it } from 'vitest'

import {
  buildMigrationManifest,
  reconcileMigrationManifests,
} from '../scripts/migration/manifest.mjs'
import {
  FoundationProjectionError,
  PHASE7_FOUNDATION_PROJECTION,
  projectD1Foundation,
  projectSupabaseFoundation,
} from '../scripts/migration/phase7FoundationProjection.mjs'

const scope = {
  tenant_id: 'tenant-legacy-uuid',
  module_id: 'petshop',
}

function sourceFixture(overrides = {}) {
  return {
    snapshotId: 'supabase-fixture',
    scope,
    tenant: {
      id: scope.tenant_id,
      slug: 'quatro-patas',
      name: 'Quatro Patas',
      active: true,
      created_at: '2025-01-01T00:00:00Z',
    },
    profiles: [
      {
        id: 'auth-user-1',
        full_name: 'Operador',
        email: 'OPERADOR@EXAMPLE.COM',
        role: 'employee',
        active: true,
        allowed_modules: ['petshop'],
      },
      {
        id: 'auth-admin-1',
        full_name: 'Admin Global',
        email: 'ADMIN@EXAMPLE.COM',
        role: 'admin',
        active: true,
      },
      {
        id: 'outside-user',
        full_name: 'Fora do tenant',
        email: 'outside@example.com',
        role: 'employee',
        active: true,
      },
    ],
    profileTenants: [
      {
        profile_id: 'auth-user-1',
        tenant_id: scope.tenant_id,
        role: 'employee',
        active: true,
      },
      {
        // Legacy global admin access bypasses profile_tenants, therefore an
        // explicit inactive link cannot revoke a still-active global admin.
        profile_id: 'auth-admin-1',
        tenant_id: scope.tenant_id,
        role: 'owner',
        active: false,
      },
      {
        profile_id: 'outside-user',
        tenant_id: 'another-tenant',
        active: true,
      },
    ],
    settings: [
      {
        tenant_id: scope.tenant_id,
        module_id: 'petshop',
        store_name: 'Quatro Patas',
        store_phone: '32999990000',
        store_address: 'Av. Central, 123',
        store_neighborhood: 'Centro',
        store_city: 'Muriaé',
        bot_prompt: 'Atenda com clareza.',
        // Legacy God-row fields are intentionally not part of the projection.
        pix_key: 'not-compared-here',
        pet_transport_fee: 12,
        petbot_autonomy_mode: 'canary',
        updated_at: '2026-08-07T00:00:00Z',
      },
    ],
    ...overrides,
  }
}

function destinationFixture(overrides = {}) {
  return {
    snapshotId: 'd1-fixture',
    scope,
    tenant: {
      id: scope.tenant_id,
      slug: 'quatro-patas',
      name: 'Quatro Patas',
      status: 'active',
      created_at_ms: 1,
      updated_at_ms: 2,
    },
    identityPrincipals: [
      {
        // Internal D1 IDs deliberately do not match Supabase Auth subjects.
        id: 'principal-internal-a',
        provider: 'supabase',
        subject: 'auth-user-1',
        display_name: 'Operador',
        email: 'operador@example.com',
        status: 'active',
        created_at_ms: 10,
        updated_at_ms: 20,
      },
      {
        id: 'principal-internal-admin',
        provider: 'supabase',
        subject: 'auth-admin-1',
        display_name: 'Admin Global',
        email: 'admin@example.com',
        status: 'active',
        created_at_ms: 10,
        updated_at_ms: 20,
      },
    ],
    tenantMemberships: [
      {
        tenant_id: scope.tenant_id,
        principal_id: 'principal-internal-a',
        status: 'active',
        created_at_ms: 30,
        updated_at_ms: 40,
      },
      {
        tenant_id: scope.tenant_id,
        principal_id: 'principal-internal-admin',
        status: 'active',
        created_at_ms: 30,
        updated_at_ms: 40,
      },
    ],
    settings: [
      {
        tenant_id: scope.tenant_id,
        module_id: 'petshop',
        store_name: 'Quatro Patas',
        store_phone: '32999990000',
        store_address: 'Av. Central, 123',
        store_neighborhood: 'Centro',
        store_city: 'Muriaé',
        bot_prompt: 'Atenda com clareza.',
        version: 7,
        created_at_ms: 50,
        updated_at_ms: 60,
      },
    ],
    ...overrides,
  }
}

function manifests(sourceInput = sourceFixture(), destinationInput = destinationFixture()) {
  return {
    source: buildMigrationManifest(projectSupabaseFoundation(sourceInput)),
    destination: buildMigrationManifest(projectD1Foundation(destinationInput)),
  }
}

describe('phase 7 foundation semantic projection', () => {
  it('reconcilia schemas físicos diferentes pela mesma semântica', () => {
    const { source, destination } = manifests()
    const report = reconcileMigrationManifests(source, destination)

    expect(report).toMatchObject({
      in_sync: true,
      projection: PHASE7_FOUNDATION_PROJECTION,
      scope,
    })
    expect(report.collections.every((collection) => collection.in_sync)).toBe(true)
  })

  it('preserva o tenant id legado como identidade do tenant no destino', () => {
    const projected = projectSupabaseFoundation(sourceFixture())

    expect(projected.collections.tenants).toEqual([
      {
        key: `tenant:${scope.tenant_id}`,
        data: {
          id: scope.tenant_id,
          slug: 'quatro-patas',
          name: 'Quatro Patas',
          status: 'active',
        },
      },
    ])
  })

  it('compara identidade por provider+subject e ignora principal_id interno', () => {
    const projected = projectD1Foundation(destinationFixture())

    expect(projected.collections.identity_principals.map((record) => record.data)).toEqual([
      {
        provider: 'supabase',
        subject: 'auth-admin-1',
        display_name: 'Admin Global',
        email: 'admin@example.com',
        status: 'active',
      },
      {
        provider: 'supabase',
        subject: 'auth-user-1',
        display_name: 'Operador',
        email: 'operador@example.com',
        status: 'active',
      },
    ])
    expect(JSON.stringify(projected)).not.toContain('principal-internal-a')
    expect(JSON.stringify(projected)).not.toContain('principal-internal-admin')
  })

  it('exclui perfil normal que não pertence ao tenant', () => {
    const projected = projectSupabaseFoundation(sourceFixture())
    expect(JSON.stringify(projected)).not.toContain('outside-user')
    expect(JSON.stringify(projected)).not.toContain('Fora do tenant')
  })

  it('materializa membership ativa para admin global ativo mesmo com link explícito inativo', () => {
    const projected = projectSupabaseFoundation(sourceFixture())
    const adminMembership = projected.collections.tenant_memberships.find(
      (record) => record.data.subject === 'auth-admin-1',
    )

    expect(adminMembership?.data).toEqual({
      tenant_id: scope.tenant_id,
      provider: 'supabase',
      subject: 'auth-admin-1',
      status: 'active',
    })
  })

  it('materializa membership para admin global sem profile_tenants', () => {
    const input = sourceFixture({
      profileTenants: sourceFixture().profileTenants.filter(
        (membership) => membership.profile_id !== 'auth-admin-1',
      ),
    })
    const projected = projectSupabaseFoundation(input)

    expect(projected.collections.tenant_memberships.some(
      (record) => record.data.subject === 'auth-admin-1' && record.data.status === 'active',
    )).toBe(true)
  })

  it('mantém admin global inativo como membership inativa', () => {
    const base = sourceFixture()
    const input = {
      ...base,
      profiles: base.profiles.map((profile) => (
        profile.id === 'auth-admin-1' ? { ...profile, active: false } : profile
      )),
    }
    const projected = projectSupabaseFoundation(input)
    const adminMembership = projected.collections.tenant_memberships.find(
      (record) => record.data.subject === 'auth-admin-1',
    )

    expect(adminMembership?.data.status).toBe('inactive')
  })

  it('mantém membership normal inativa como inativa', () => {
    const base = sourceFixture()
    const input = {
      ...base,
      profileTenants: base.profileTenants.map((membership) => (
        membership.profile_id === 'auth-user-1'
          ? { ...membership, active: false }
          : membership
      )),
    }
    const projected = projectSupabaseFoundation(input)
    const membership = projected.collections.tenant_memberships.find(
      (record) => record.data.subject === 'auth-user-1',
    )

    expect(membership?.data.status).toBe('inactive')
  })

  it('ignora God-row extras e metadados físicos de settings', () => {
    const { source, destination } = manifests()
    const sourceSettings = source.collections.find(
      (collection) => collection.name === 'tenant_module_settings',
    )
    const destinationSettings = destination.collections.find(
      (collection) => collection.name === 'tenant_module_settings',
    )

    expect(sourceSettings?.checksum).toBe(destinationSettings?.checksum)
  })

  it('reconcilia ausência de settings quando ambos os lados ainda não possuem a linha', () => {
    const { source, destination } = manifests(
      sourceFixture({ settings: [] }),
      destinationFixture({ settings: [] }),
    )

    expect(reconcileMigrationManifests(source, destination).in_sync).toBe(true)
  })

  it('falha fechado se profile_tenants referencia profile inexistente', () => {
    const base = sourceFixture()
    expect(() => projectSupabaseFoundation({
      ...base,
      profileTenants: [
        ...base.profileTenants,
        {
          profile_id: 'missing-profile',
          tenant_id: scope.tenant_id,
          active: true,
        },
      ],
    })).toThrowError(expect.objectContaining({
      name: 'FoundationProjectionError',
      code: 'SOURCE_MEMBERSHIP_PROFILE_NOT_FOUND',
    }))
  })

  it('falha fechado se D1 membership referencia principal inexistente', () => {
    const base = destinationFixture()
    expect(() => projectD1Foundation({
      ...base,
      tenantMemberships: [
        ...base.tenantMemberships,
        {
          tenant_id: scope.tenant_id,
          principal_id: 'missing-principal',
          status: 'active',
        },
      ],
    })).toThrowError(expect.objectContaining({
      code: 'DESTINATION_MEMBERSHIP_PRINCIPAL_NOT_FOUND',
    }))
  })

  it('falha fechado com settings duplicados no mesmo tenant/módulo', () => {
    const base = sourceFixture()
    expect(() => projectSupabaseFoundation({
      ...base,
      settings: [base.settings[0], { ...base.settings[0] }],
    })).toThrowError(expect.objectContaining({
      code: 'SOURCE_SETTINGS_DUPLICATE',
    }))
  })

  it('usa erro tipado para tenant divergente', () => {
    expect(() => projectD1Foundation(destinationFixture({
      tenant: {
        id: 'different-tenant',
        slug: 'quatro-patas',
        name: 'Quatro Patas',
        status: 'active',
      },
    }))).toThrowError(FoundationProjectionError)
  })
})
