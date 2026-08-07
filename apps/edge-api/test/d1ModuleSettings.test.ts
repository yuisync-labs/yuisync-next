import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'

import {
  D1ModuleSettingsAdapter,
} from '../src/adapters/d1ModuleSettings'

const testEnv = env as EdgeEnv & { DB: D1Database }
const NOW_MS = 1_786_108_800_000

async function insertTenant(id: string): Promise<void> {
  await testEnv.DB
    .prepare(`
      INSERT INTO tenants (id, slug, name, status, created_at_ms, updated_at_ms)
      VALUES (?, ?, ?, 'active', ?, ?)
    `)
    .bind(id, id.toLowerCase(), `Tenant ${id}`, NOW_MS, NOW_MS)
    .run()
}

describe('D1ModuleSettingsAdapter', () => {
  it('cria e lê settings somente no tenant/módulo exatos', async () => {
    await insertTenant('tenant-settings-a')
    await insertTenant('tenant-settings-b')
    const adapter = new D1ModuleSettingsAdapter(testEnv.DB)

    const created = await adapter.saveBaseSettings({
      tenantId: 'tenant-settings-a',
      moduleId: 'PETSHOP',
      expectedVersion: null,
      nowMs: NOW_MS,
      settings: {
        storeName: 'Quatro Patas',
        storePhone: '(32) 99999-0000',
        storeCity: 'Muriaé',
        botPrompt: 'Atenda com clareza.',
      },
    })

    expect(created).toEqual({
      kind: 'saved',
      settings: {
        tenantId: 'tenant-settings-a',
        moduleId: 'petshop',
        storeName: 'Quatro Patas',
        storePhone: '(32) 99999-0000',
        storeAddress: '',
        storeNeighborhood: '',
        storeCity: 'Muriaé',
        botPrompt: 'Atenda com clareza.',
        version: 1,
        createdAtMs: NOW_MS,
        updatedAtMs: NOW_MS,
      },
    })

    await expect(adapter.getBaseSettings('tenant-settings-a', 'petshop')).resolves.toEqual(
      created.kind === 'saved' ? created.settings : null,
    )
    await expect(adapter.getBaseSettings('tenant-settings-b', 'petshop')).resolves.toBeNull()
    await expect(adapter.getBaseSettings('tenant-settings-a', 'other')).resolves.toBeNull()
  })

  it('não sobrescreve uma linha existente durante create', async () => {
    await insertTenant('tenant-settings-create-conflict')
    const adapter = new D1ModuleSettingsAdapter(testEnv.DB)

    await expect(adapter.saveBaseSettings({
      tenantId: 'tenant-settings-create-conflict',
      moduleId: 'petshop',
      expectedVersion: null,
      nowMs: NOW_MS,
      settings: { storeName: 'Original' },
    })).resolves.toMatchObject({ kind: 'saved' })

    await expect(adapter.saveBaseSettings({
      tenantId: 'tenant-settings-create-conflict',
      moduleId: 'petshop',
      expectedVersion: null,
      nowMs: NOW_MS + 1,
      settings: { storeName: 'Sobrescrito' },
    })).resolves.toEqual({ kind: 'conflict' })

    await expect(adapter.getBaseSettings(
      'tenant-settings-create-conflict',
      'petshop',
    )).resolves.toMatchObject({
      storeName: 'Original',
      version: 1,
    })
  })

  it('faz update parcial somente com a versão esperada', async () => {
    await insertTenant('tenant-settings-version')
    const adapter = new D1ModuleSettingsAdapter(testEnv.DB)

    const created = await adapter.saveBaseSettings({
      tenantId: 'tenant-settings-version',
      moduleId: 'petshop',
      expectedVersion: null,
      nowMs: NOW_MS,
      settings: {
        storeName: 'Loja Inicial',
        storePhone: '1111',
        botPrompt: 'Prompt inicial',
      },
    })
    expect(created.kind).toBe('saved')

    const updated = await adapter.saveBaseSettings({
      tenantId: 'tenant-settings-version',
      moduleId: 'petshop',
      expectedVersion: 1,
      nowMs: NOW_MS + 100,
      settings: {
        storePhone: '2222',
      },
    })

    expect(updated).toMatchObject({
      kind: 'saved',
      settings: {
        storeName: 'Loja Inicial',
        storePhone: '2222',
        botPrompt: 'Prompt inicial',
        version: 2,
        createdAtMs: NOW_MS,
        updatedAtMs: NOW_MS + 100,
      },
    })

    await expect(adapter.saveBaseSettings({
      tenantId: 'tenant-settings-version',
      moduleId: 'petshop',
      expectedVersion: 1,
      nowMs: NOW_MS + 200,
      settings: { storeName: 'Update atrasado' },
    })).resolves.toEqual({ kind: 'conflict' })

    await expect(adapter.getBaseSettings(
      'tenant-settings-version',
      'petshop',
    )).resolves.toMatchObject({
      storeName: 'Loja Inicial',
      storePhone: '2222',
      version: 2,
    })
  })

  it('D1 impede settings órfãos sem tenant', async () => {
    await expect(testEnv.DB
      .prepare(`
        INSERT INTO tenant_module_settings (
          tenant_id,
          module_id,
          created_at_ms,
          updated_at_ms
        ) VALUES (?, 'petshop', ?, ?)
      `)
      .bind('tenant-settings-orphan', NOW_MS, NOW_MS)
      .run()).rejects.toThrow()
  })

  it('falha fechado quando o binding D1 não está configurado', async () => {
    const adapter = new D1ModuleSettingsAdapter()

    await expect(adapter.getBaseSettings('tenant-any', 'petshop')).rejects.toMatchObject({
      name: 'ModuleSettingsError',
      code: 'DATABASE_NOT_CONFIGURED',
    })
  })

  it('rejeita módulo inválido antes de consultar o banco', async () => {
    const adapter = new D1ModuleSettingsAdapter(testEnv.DB)

    await expect(adapter.getBaseSettings(
      'tenant-any',
      '../petshop',
    )).rejects.toMatchObject({
      name: 'ModuleSettingsError',
      code: 'INVALID_ARGUMENT',
    })
  })
})
