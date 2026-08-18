import { describe, expect, it } from 'vitest'

import { buildLegacyIntakeSql, createD1LegacyIntakeWriter } from '../scripts/migration/d1LegacyIntakeWriter.mjs'
import { projectLegacySourceRows } from '../scripts/migration/legacyIntakeProjection.mjs'
import { registryEntry, sourceKeyFor, validateRegistryCoverage } from '../scripts/migration/legacyIntakeRegistry.mjs'
import { evaluateMigrationReadiness } from '../scripts/migration/migrationReadinessGate.mjs'
import { openMigrationSecret, parseMigrationVaultKey, sealMigrationSecret } from '../scripts/migration/migrationSecretVault.mjs'
import { projectNormalizedSupabaseClientsPets } from '../scripts/migration/normalizedClientsPetsIntake.mjs'
import { projectSupabaseUsersToBetterAuth } from '../scripts/migration/supabaseBetterAuthIntake.mjs'

const vaultKey = Buffer.alloc(32, 7).toString('base64')
const bcryptHash = '$2a$12$123456789012345678901u1234567890123456789012345678901'

describe('migration intake readiness', () => {
  it('registers canonical, secret, relation, auth and view surfaces', () => {
    expect(registryEntry('clients')?.disposition).toBe('canonical')
    expect(registryEntry('tenant_bot_channels')?.disposition).toBe('secret_bridge')
    expect(registryEntry('profiles')?.scope).toBe('relation')
    expect(registryEntry('auth.users')?.disposition).toBe('identity')
    expect(registryEntry('petshop_growth_exec_daily')?.scope).toBe('view')
    expect(sourceKeyFor('settings', { tenant_id: 't1', module_id: 'petshop' })).toBe('tenant_id=t1|module_id=petshop')
  })

  it('fails closed for an unknown non-empty source base table', () => {
    const report = validateRegistryCoverage([{ table_name: 'new_money_table', table_type: 'BASE TABLE', row_count: 1 }])
    expect(report.ok).toBe(false)
    expect(report.failures[0].code).toBe('UNREGISTERED_NONEMPTY_TABLE')
  })

  it('round-trips AES-256-GCM secrets with row-bound associated data', () => {
    const context = { runId: 'run-1', sourceTable: 'tenant_bot_channels', sourceKey: 'id=x', secretPath: '$.whatsapp_app_secret' }
    const sealed = sealMigrationSecret('very-secret-value', context, vaultKey, { iv: Buffer.alloc(12, 3) })
    expect(sealed.ciphertext_b64).not.toContain('very-secret-value')
    expect(openMigrationSecret(sealed, context, vaultKey)).toBe('very-secret-value')
    expect(sealed.secret_fingerprint).toHaveLength(64)
    expect(() => parseMigrationVaultKey(Buffer.alloc(31).toString('base64'))).toThrowError(expect.objectContaining({ code: 'MIGRATION_VAULT_KEY_INVALID' }))
  })

  it('strips plaintext credentials from landing rows and seals nested secrets', () => {
    const result = projectLegacySourceRows({
      runId: 'run-1',
      tableName: 'tenant_bot_channels',
      tenantId: 'tenant-1',
      vaultKey,
      rows: [{
        id: 'channel-1', tenant_id: 'tenant-1', module_id: 'petshop', channel: 'whatsapp',
        whatsapp_app_secret: 'dont-log-me', metadata: { access_token: 'nested-secret' },
      }],
      now: 1,
    })
    expect(result.records).toHaveLength(1)
    expect(result.secrets).toHaveLength(2)
    expect(result.records[0].payload_json).not.toContain('dont-log-me')
    expect(result.records[0].payload_json).not.toContain('nested-secret')
    expect(JSON.parse(result.records[0].secret_names_json)).toEqual(['$.metadata.access_token', '$.whatsapp_app_secret'])
  })

  it('rejects cross-tenant rows and secret rows without a vault key', () => {
    expect(() => projectLegacySourceRows({ runId: 'run-1', tableName: 'clients', tenantId: 'tenant-1', rows: [{ id: 'x', tenant_id: 'tenant-2' }] }))
      .toThrowError(expect.objectContaining({ code: 'MIGRATION_TENANT_SCOPE_MISMATCH' }))
    expect(() => projectLegacySourceRows({ runId: 'run-1', tableName: 'billing_settings', tenantId: 'tenant-1', rows: [{ tenant_id: 'tenant-1', module_id: 'petshop', invoice_api_key: 'secret' }] }))
      .toThrowError(expect.objectContaining({ code: 'MIGRATION_VAULT_KEY_REQUIRED_FOR_SECRET' }))
  })

  it('uses only explicit memberships and preserves compatible bcrypt hashes for Better Auth', () => {
    const result = projectSupabaseUsersToBetterAuth({
      tenantId: 'tenant-1', now: 10,
      users: [
        { id: 'user-1', email: 'A@EXAMPLE.COM', encrypted_password: bcryptHash, email_confirmed_at: '2026-01-01' },
        { id: 'global-admin-not-member', email: 'global@example.com', encrypted_password: bcryptHash, email_confirmed_at: '2026-01-01' },
      ],
      profiles: [
        { id: 'user-1', email: 'a@example.com', full_name: 'A', role: 'employee', active: true, staff_type: 'gerente', module_permissions: { petshop: 'admin_pet' } },
        { id: 'global-admin-not-member', email: 'global@example.com', full_name: 'Global', role: 'admin', active: true },
      ],
      memberships: [{ profile_id: 'user-1', tenant_id: 'tenant-1', role: 'member', active: true }],
    })
    expect(result.authUsers.map((row) => row.id)).toEqual(['user-1'])
    expect(result.authAccounts[0].password).toBe(bcryptHash)
    expect(result.principals[0]).toMatchObject({ id: 'user-1', provider: 'better-auth', subject: 'user-1' })
    expect(result.tenantMemberships[0]).toMatchObject({ principal_id: 'user-1', role: 'manager' })
    expect(JSON.parse(result.tenantMemberships[0].module_permissions_json)).toEqual({ petshop: { role: 'admin_pet' } })
  })

  it('fails Better Auth intake for incompatible password hashes', () => {
    expect(() => projectSupabaseUsersToBetterAuth({
      tenantId: 'tenant-1',
      users: [{ id: 'u', email: 'u@example.com', encrypted_password: 'argon' }],
      profiles: [{ id: 'u', email: 'u@example.com', active: true }],
      memberships: [{ profile_id: 'u', tenant_id: 'tenant-1', active: true }],
    })).toThrowError(expect.objectContaining({ code: 'AUTH_PASSWORD_NOT_BCRYPT' }))
  })

  it('projects normalized pets by same id, unique owner match, then deterministic synthetic client', () => {
    const scope = { tenant_id: 'tenant-1', module_id: 'petshop' }
    const result = projectNormalizedSupabaseClientsPets({ scope, now: 1,
      clients: [
        { id: 'pet-same', tenant_id: 'tenant-1', module_id: 'petshop', name: 'Maria', phone: '(32)9999-0000', active: true, details: {} },
        { id: 'owner-2', tenant_id: 'tenant-1', module_id: 'petshop', name: 'Joao', phone: '32988880000', active: true, details: {} },
      ],
      pets: [
        { id: 'pet-same', tenant_id: 'tenant-1', module_id: 'petshop', owner_name: 'Maria', phone: '3299990000', pet_name: 'Thor', species: 'dog' },
        { id: 'pet-fallback', tenant_id: 'tenant-1', module_id: 'petshop', owner_name: 'Joao', phone: '(32) 98888-0000', pet_name: 'Mel', species: 'dog' },
        { id: 'pet-orphan', tenant_id: 'tenant-1', module_id: 'petshop', owner_name: 'Ana', phone: '32977770000', pet_name: 'Lua', species: 'cat' },
      ],
    })
    expect(result.pets.find((row) => row.id === 'pet-same')?.client_id).toBe('pet-same')
    expect(result.pets.find((row) => row.id === 'pet-fallback')?.client_id).toBe('owner-2')
    expect(result.pets.find((row) => row.id === 'pet-orphan')?.client_id).toBe('pet-orphan')
    expect(result.diagnostics.synthetic_clients).toEqual(['pet-orphan'])
  })

  it('fails normalized pets intake if owner matching is ambiguous', () => {
    expect(() => projectNormalizedSupabaseClientsPets({
      scope: { tenant_id: 'tenant-1', module_id: 'petshop' },
      clients: [
        { id: 'a', tenant_id: 'tenant-1', module_id: 'petshop', name: 'Maria', phone: '3299990000', active: true },
        { id: 'b', tenant_id: 'tenant-1', module_id: 'petshop', name: 'Maria', phone: '3299990000', active: true },
      ],
      pets: [{ id: 'p', tenant_id: 'tenant-1', owner_name: 'Maria', phone: '3299990000', pet_name: 'Thor' }],
    })).toThrowError(expect.objectContaining({ code: 'PET_OWNER_MATCH_AMBIGUOUS' }))
  })

  it('marks readiness green only when registry, destination, auth, secrets, storage and clients/pets are green', () => {
    const intakeTables = ['migration_runs','migration_source_records','migration_secret_vault','migration_table_checkpoints','migration_reconciliation']
    const report = evaluateMigrationReadiness({
      discoveredSource: [{ table_name: 'clients', table_type: 'BASE TABLE', row_count: 10 }],
      destinationTables: intakeTables,
      authSummary: { total: 4, bcrypt: 4, explicit_memberships: 4 },
      secretSummary: { secret_values: 3, vault_ready: true },
      storageSummary: { supabase_hosted_assets: 0 },
      clientsPetsSummary: { source_clients: 10, destination_clients: 10, source_pets: 5, destination_pets: 5, ambiguous_matches: 0 },
    })
    expect(report.ready).toBe(true)
  })

  it('builds idempotent intake SQL and requires run-specific production authorization', async () => {
    const sql = buildLegacyIntakeSql({
      run: {
        id: 'run-1', source_system: 'supabase', source_ref: 'source', tenant_id: 'tenant-1', module_id: 'petshop',
        source_snapshot_at_ms: 1, source_schema_fingerprint: 'a'.repeat(64), created_at_ms: 1, updated_at_ms: 1,
        details: { label: "O'Hara" },
      },
    })
    expect(sql).toContain("O''Hara")
    expect(sql).toContain('BEGIN IMMEDIATE;')
    expect(sql).toContain('ON CONFLICT(id) DO UPDATE')

    const writer = createD1LegacyIntakeWriter({ environment: 'production', productionAuthorization: 'wrong', execFile: async () => ({ stdout: '' }) })
    await expect(writer({ run: {
      id: 'run-1', source_system: 'supabase', source_ref: 'x', tenant_id: 't', module_id: 'petshop',
      source_snapshot_at_ms: 1, source_schema_fingerprint: 'a'.repeat(64), created_at_ms: 1, updated_at_ms: 1,
    } })).rejects.toMatchObject({ code: 'MIGRATION_PRODUCTION_NOT_AUTHORIZED' })
  })
})
