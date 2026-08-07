import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'

import {
  applyFoundationSnapshotToD1,
  deterministicFoundationPrincipalId,
} from '../src/migration/d1FoundationWriter'

const testEnv = env as EdgeEnv & { DB: D1Database }
const NOW_MS = 1_786_108_800_000

type IdentityFixture = Readonly<{
  subject: string
  displayName: string
  email: string
  status?: 'active' | 'inactive'
}>

function foundationSnapshot({
  tenantId,
  tenantName = 'Quatro Patas',
  identities = [
    {
      subject: 'auth-user-1',
      displayName: 'Operador',
      email: 'operador@example.com',
    },
  ],
  storeName = 'Quatro Patas',
  includeSettings = true,
}: Readonly<{
  tenantId: string
  tenantName?: string
  identities?: readonly IdentityFixture[]
  storeName?: string
  includeSettings?: boolean
}>) {
  return {
    projection: { name: 'phase7-foundation', version: 1 },
    source: { system: 'supabase', snapshot_id: `source-${tenantId}` },
    scope: { tenant_id: tenantId, module_id: 'petshop' },
    collections: {
      tenants: [
        {
          key: `tenant:${tenantId}`,
          data: {
            id: tenantId,
            slug: tenantId,
            name: tenantName,
            status: 'active',
          },
        },
      ],
      identity_principals: identities.map((identity) => ({
        key: `identity:supabase:${identity.subject}`,
        data: {
          provider: 'supabase',
          subject: identity.subject,
          display_name: identity.displayName,
          email: identity.email,
          status: identity.status ?? 'active',
        },
      })),
      tenant_memberships: identities.map((identity) => ({
        key: `membership:${tenantId}:supabase:${identity.subject}`,
        data: {
          tenant_id: tenantId,
          provider: 'supabase',
          subject: identity.subject,
          status: identity.status ?? 'active',
        },
      })),
      tenant_module_settings: includeSettings
        ? [
          {
            key: `settings:${tenantId}:petshop`,
            data: {
              tenant_id: tenantId,
              module_id: 'petshop',
              store_name: storeName,
              store_phone: '32999990000',
              store_address: 'Av. Central, 123',
              store_neighborhood: 'Centro',
              store_city: 'Muriaé',
              bot_prompt: 'Atenda com clareza.',
            },
          },
        ]
        : [],
    },
  }
}

async function countRows(table: string, tenantId: string): Promise<number> {
  const allowed = new Set(['tenants', 'tenant_memberships', 'tenant_module_settings'])
  if (!allowed.has(table)) throw new Error('invalid test table')

  const field = table === 'tenants' ? 'id' : 'tenant_id'
  const row = await testEnv.DB
    .prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE ${field} = ?`)
    .bind(tenantId)
    .first<{ count: number }>()

  return Number(row?.count || 0)
}

describe('D1 foundation writer', () => {
  it('insere a foundation em um único batch e usa principal id determinístico', async () => {
    const tenantId = 'tenant-writer-create'
    const snapshot = foundationSnapshot({ tenantId })

    const result = await applyFoundationSnapshotToD1({
      database: testEnv.DB,
      snapshot,
      nowMs: NOW_MS,
    })

    expect(result).toEqual({
      status: 'applied_or_already_present',
      tenantId,
      moduleId: 'petshop',
      identityCount: 1,
      membershipCount: 1,
      settingsPresent: true,
      statementCount: 9,
    })

    const expectedPrincipalId = await deterministicFoundationPrincipalId(
      'supabase',
      'auth-user-1',
    )
    const principal = await testEnv.DB
      .prepare(`
        SELECT id, provider, subject, display_name, email, status, created_at_ms, updated_at_ms
        FROM identity_principals
        WHERE provider = 'supabase' AND subject = 'auth-user-1'
      `)
      .first<Record<string, unknown>>()

    expect(principal).toMatchObject({
      id: expectedPrincipalId,
      provider: 'supabase',
      subject: 'auth-user-1',
      display_name: 'Operador',
      email: 'operador@example.com',
      status: 'active',
      created_at_ms: NOW_MS,
      updated_at_ms: NOW_MS,
    })

    expect(await countRows('tenants', tenantId)).toBe(1)
    expect(await countRows('tenant_memberships', tenantId)).toBe(1)
    expect(await countRows('tenant_module_settings', tenantId)).toBe(1)
  })

  it('é idempotente: reexecução idêntica não altera timestamps nem versão', async () => {
    const tenantId = 'tenant-writer-idempotent'
    const snapshot = foundationSnapshot({ tenantId })

    await applyFoundationSnapshotToD1({
      database: testEnv.DB,
      snapshot,
      nowMs: NOW_MS,
    })
    await applyFoundationSnapshotToD1({
      database: testEnv.DB,
      snapshot,
      nowMs: NOW_MS + 50_000,
    })

    const tenant = await testEnv.DB
      .prepare('SELECT created_at_ms, updated_at_ms FROM tenants WHERE id = ?')
      .bind(tenantId)
      .first<{ created_at_ms: number; updated_at_ms: number }>()
    const settings = await testEnv.DB
      .prepare(`
        SELECT version, created_at_ms, updated_at_ms
        FROM tenant_module_settings
        WHERE tenant_id = ? AND module_id = 'petshop'
      `)
      .bind(tenantId)
      .first<{ version: number; created_at_ms: number; updated_at_ms: number }>()

    expect(tenant).toEqual({
      created_at_ms: NOW_MS,
      updated_at_ms: NOW_MS,
    })
    expect(settings).toEqual({
      version: 1,
      created_at_ms: NOW_MS,
      updated_at_ms: NOW_MS,
    })
  })

  it('reusa principal existente com ID físico diferente quando a semântica coincide', async () => {
    const tenantId = 'tenant-writer-existing-principal'
    const snapshot = foundationSnapshot({ tenantId })

    await testEnv.DB.batch([
      testEnv.DB.prepare(`
        INSERT INTO identity_principals (
          id, provider, subject, display_name, email, status, created_at_ms, updated_at_ms
        ) VALUES (?, 'supabase', 'auth-user-1', 'Operador', 'operador@example.com', 'active', ?, ?)
      `).bind('principal-preexisting-custom-id', NOW_MS - 10, NOW_MS - 10),
    ])

    await applyFoundationSnapshotToD1({
      database: testEnv.DB,
      snapshot,
      nowMs: NOW_MS,
    })

    const membership = await testEnv.DB
      .prepare(`
        SELECT principal_id
        FROM tenant_memberships
        WHERE tenant_id = ?
      `)
      .bind(tenantId)
      .first<{ principal_id: string }>()

    expect(membership).toEqual({ principal_id: 'principal-preexisting-custom-id' })
  })

  it('rollbacka inserts anteriores quando settings existentes divergem', async () => {
    const tenantId = 'tenant-writer-settings-conflict'
    const initial = foundationSnapshot({ tenantId })
    await applyFoundationSnapshotToD1({
      database: testEnv.DB,
      snapshot: initial,
      nowMs: NOW_MS,
    })

    const changed = foundationSnapshot({
      tenantId,
      storeName: 'Nome divergente',
      identities: [
        {
          subject: 'auth-user-1',
          displayName: 'Operador',
          email: 'operador@example.com',
        },
        {
          subject: 'auth-user-2',
          displayName: 'Novo Operador',
          email: 'novo@example.com',
        },
      ],
    })

    await expect(applyFoundationSnapshotToD1({
      database: testEnv.DB,
      snapshot: changed,
      nowMs: NOW_MS + 100,
    })).rejects.toMatchObject({
      name: 'FoundationWriterError',
      code: 'FOUNDATION_WRITE_REJECTED',
    })

    const newPrincipal = await testEnv.DB
      .prepare(`
        SELECT id FROM identity_principals
        WHERE provider = 'supabase' AND subject = 'auth-user-2'
      `)
      .first<{ id: string }>()

    expect(newPrincipal).toBeNull()
    expect(await countRows('tenant_memberships', tenantId)).toBe(1)

    const settings = await testEnv.DB
      .prepare(`
        SELECT store_name FROM tenant_module_settings
        WHERE tenant_id = ? AND module_id = 'petshop'
      `)
      .bind(tenantId)
      .first<{ store_name: string }>()
    expect(settings).toEqual({ store_name: 'Quatro Patas' })
  })

  it('rejeita destination com membership extra em vez de apagá-la', async () => {
    const tenantId = 'tenant-writer-extra-membership'
    const both = foundationSnapshot({
      tenantId,
      identities: [
        {
          subject: 'auth-user-1',
          displayName: 'Operador 1',
          email: 'operador1@example.com',
        },
        {
          subject: 'auth-user-2',
          displayName: 'Operador 2',
          email: 'operador2@example.com',
        },
      ],
    })
    await applyFoundationSnapshotToD1({
      database: testEnv.DB,
      snapshot: both,
      nowMs: NOW_MS,
    })

    const onlyOne = foundationSnapshot({
      tenantId,
      identities: [
        {
          subject: 'auth-user-1',
          displayName: 'Operador 1',
          email: 'operador1@example.com',
        },
      ],
    })

    await expect(applyFoundationSnapshotToD1({
      database: testEnv.DB,
      snapshot: onlyOne,
      nowMs: NOW_MS + 100,
    })).rejects.toMatchObject({
      code: 'FOUNDATION_WRITE_REJECTED',
    })

    expect(await countRows('tenant_memberships', tenantId)).toBe(2)
  })

  it('rejeita ausência de settings na source quando destination já possui settings', async () => {
    const tenantId = 'tenant-writer-settings-extra'
    await applyFoundationSnapshotToD1({
      database: testEnv.DB,
      snapshot: foundationSnapshot({ tenantId }),
      nowMs: NOW_MS,
    })

    await expect(applyFoundationSnapshotToD1({
      database: testEnv.DB,
      snapshot: foundationSnapshot({ tenantId, includeSettings: false }),
      nowMs: NOW_MS + 100,
    })).rejects.toMatchObject({
      code: 'FOUNDATION_WRITE_REJECTED',
    })

    expect(await countRows('tenant_module_settings', tenantId)).toBe(1)
  })

  it('rejeita snapshot de destination ou projection diferente antes do banco', async () => {
    const tenantId = 'tenant-writer-invalid-source'
    const invalidSource = foundationSnapshot({ tenantId })
    invalidSource.source.system = 'd1'

    await expect(applyFoundationSnapshotToD1({
      database: testEnv.DB,
      snapshot: invalidSource,
      nowMs: NOW_MS,
    })).rejects.toMatchObject({ code: 'INVALID_SNAPSHOT' })

    const invalidProjection = foundationSnapshot({ tenantId: 'tenant-writer-invalid-projection' })
    invalidProjection.projection.version = 2

    await expect(applyFoundationSnapshotToD1({
      database: testEnv.DB,
      snapshot: invalidProjection,
      nowMs: NOW_MS,
    })).rejects.toMatchObject({ code: 'INVALID_SNAPSHOT' })
  })

  it('recusa snapshot grande demais para preservar um único batch atômico', async () => {
    const identities = Array.from({ length: 11 }, (_, index) => ({
      subject: `auth-large-${index}`,
      displayName: `User ${index}`,
      email: `user${index}@example.com`,
    }))

    await expect(applyFoundationSnapshotToD1({
      database: testEnv.DB,
      snapshot: foundationSnapshot({
        tenantId: 'tenant-writer-too-large',
        identities,
      }),
      nowMs: NOW_MS,
    })).rejects.toMatchObject({
      code: 'SNAPSHOT_TOO_LARGE',
    })

    expect(await countRows('tenants', 'tenant-writer-too-large')).toBe(0)
  })

  it('falha fechado sem binding D1', async () => {
    await expect(applyFoundationSnapshotToD1({
      snapshot: foundationSnapshot({ tenantId: 'tenant-writer-no-db' }),
      nowMs: NOW_MS,
    })).rejects.toMatchObject({
      code: 'DATABASE_NOT_CONFIGURED',
    })
  })
})
