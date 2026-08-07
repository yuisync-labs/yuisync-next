import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'

import app from '../src/app'
import {
  FOUNDATION_MIGRATION_MAX_BODY_BYTES,
  FOUNDATION_MIGRATION_ROUTE,
} from '../src/migration/foundationMigrationFeature'
import type { EdgeAppEnvironment } from '../src/types'

const testEnv = env as EdgeEnv & { DB: D1Database }
const TOKEN = 'foundation-migration-token-fixture-1234567890'

type AppBindings = EdgeAppEnvironment['Bindings']

function createBindings(overrides: Partial<AppBindings> = {}): AppBindings {
  return {
    ...testEnv,
    APP_ENV: 'staging',
    SERVICE_NAME: 'yuisync-edge-api',
    RELEASE_CHANNEL: 'test',
    EDGE_DATABASE_ENABLED: 'true',
    EDGE_COORDINATION_ENABLED: 'false',
    EDGE_IDENTITY_CANARY_ENABLED: 'false',
    EDGE_FOUNDATION_MIGRATION_ENABLED: 'true',
    FOUNDATION_MIGRATION_TOKEN: TOKEN,
    DB: testEnv.DB,
    ...overrides,
  }
}

function snapshot(tenantId: string, storeName = 'Quatro Patas') {
  const subject = `auth-${tenantId}`
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
            name: 'Quatro Patas',
            status: 'active',
          },
        },
      ],
      identity_principals: [
        {
          key: `identity:supabase:${subject}`,
          data: {
            provider: 'supabase',
            subject,
            display_name: 'Operador',
            email: `${tenantId}@example.com`,
            status: 'active',
          },
        },
      ],
      tenant_memberships: [
        {
          key: `membership:${tenantId}:supabase:${subject}`,
          data: {
            tenant_id: tenantId,
            provider: 'supabase',
            subject,
            status: 'active',
          },
        },
      ],
      tenant_module_settings: [
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
      ],
    },
  }
}

function postSnapshot(
  body: string,
  bindings: AppBindings,
  headers: HeadersInit = {},
) {
  return app.request(
    `https://worker.test${FOUNDATION_MIGRATION_ROUTE}`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-yuisync-migration-token': TOKEN,
        ...headers,
      },
      body,
    },
    bindings,
  )
}

describe('foundation migration staging transport', () => {
  it('fica indistinguível de rota inexistente quando a flag está desligada', async () => {
    const response = await postSnapshot(
      JSON.stringify(snapshot('tenant-transport-disabled')),
      createBindings({ EDGE_FOUNDATION_MIGRATION_ENABLED: 'false' }),
    )

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('fica escondida fora de staging mesmo se a flag estiver ligada', async () => {
    const response = await postSnapshot(
      JSON.stringify(snapshot('tenant-transport-production')),
      createBindings({ APP_ENV: 'production' }),
    )

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('falha fechado quando a feature foi ligada sem token configurado', async () => {
    const response = await postSnapshot(
      JSON.stringify(snapshot('tenant-transport-no-config')),
      createBindings({ FOUNDATION_MIGRATION_TOKEN: undefined }),
    )

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toMatchObject({
      code: 'FOUNDATION_MIGRATION_UNAVAILABLE',
    })
  })

  it('rejeita token incorreto sem tocar no D1', async () => {
    const tenantId = 'tenant-transport-bad-token'
    const response = await postSnapshot(
      JSON.stringify(snapshot(tenantId)),
      createBindings(),
      { 'x-yuisync-migration-token': 'wrong-token-that-is-long-enough-123456789' },
    )

    expect(response.status).toBe(401)
    expect(JSON.stringify(await response.json())).not.toContain(TOKEN)

    const row = await testEnv.DB
      .prepare('SELECT id FROM tenants WHERE id = ?')
      .bind(tenantId)
      .first<{ id: string }>()
    expect(row).toBeNull()
  })

  it('exige application/json antes de ler o snapshot', async () => {
    const response = await app.request(
      `https://worker.test${FOUNDATION_MIGRATION_ROUTE}`,
      {
        method: 'POST',
        headers: {
          'content-type': 'text/plain',
          'x-yuisync-migration-token': TOKEN,
        },
        body: '{}',
      },
      createBindings(),
    )

    expect(response.status).toBe(415)
    await expect(response.json()).resolves.toMatchObject({
      code: 'CONTENT_TYPE_REQUIRED',
    })
  })

  it('rejeita body acima do limite antes do writer', async () => {
    const body = JSON.stringify({
      padding: 'x'.repeat(FOUNDATION_MIGRATION_MAX_BODY_BYTES + 1),
    })
    const response = await postSnapshot(body, createBindings())

    expect(response.status).toBe(413)
    await expect(response.json()).resolves.toMatchObject({
      code: 'BODY_TOO_LARGE',
    })
  })

  it('aplica snapshot válido em staging e rerun idêntico continua 200', async () => {
    const tenantId = 'tenant-transport-success'
    const body = JSON.stringify(snapshot(tenantId))

    const first = await postSnapshot(body, createBindings(), {
      'x-request-id': 'migration-run-success-1',
    })
    expect(first.status).toBe(200)
    expect(first.headers.get('x-request-id')).toBe('migration-run-success-1')
    await expect(first.json()).resolves.toEqual({
      status: 'applied_or_already_present',
      request_id: 'migration-run-success-1',
      identity_count: 1,
      membership_count: 1,
      settings_present: true,
      statement_count: 9,
    })

    const settingsBefore = await testEnv.DB
      .prepare(`
        SELECT version, created_at_ms, updated_at_ms
        FROM tenant_module_settings
        WHERE tenant_id = ? AND module_id = 'petshop'
      `)
      .bind(tenantId)
      .first<{ version: number; created_at_ms: number; updated_at_ms: number }>()

    const second = await postSnapshot(body, createBindings(), {
      'x-request-id': 'migration-run-success-2',
    })
    expect(second.status).toBe(200)

    const settingsAfter = await testEnv.DB
      .prepare(`
        SELECT version, created_at_ms, updated_at_ms
        FROM tenant_module_settings
        WHERE tenant_id = ? AND module_id = 'petshop'
      `)
      .bind(tenantId)
      .first<{ version: number; created_at_ms: number; updated_at_ms: number }>()

    expect(settingsAfter).toEqual(settingsBefore)
  })

  it('mapeia divergência do writer para 409 sem sobrescrever destination', async () => {
    const tenantId = 'tenant-transport-conflict'
    const bindings = createBindings()

    const first = await postSnapshot(JSON.stringify(snapshot(tenantId)), bindings)
    expect(first.status).toBe(200)

    const conflict = await postSnapshot(
      JSON.stringify(snapshot(tenantId, 'Nome Divergente')),
      bindings,
    )
    expect(conflict.status).toBe(409)
    await expect(conflict.json()).resolves.toMatchObject({
      code: 'FOUNDATION_WRITE_REJECTED',
      message: 'Migração de foundation rejeitada.',
    })

    const settings = await testEnv.DB
      .prepare(`
        SELECT store_name
        FROM tenant_module_settings
        WHERE tenant_id = ? AND module_id = 'petshop'
      `)
      .bind(tenantId)
      .first<{ store_name: string }>()
    expect(settings).toEqual({ store_name: 'Quatro Patas' })
  })

  it('rejeita JSON válido mas snapshot incompatível como 400', async () => {
    const response = await postSnapshot(
      JSON.stringify({ projection: { name: 'wrong', version: 1 } }),
      createBindings(),
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      code: 'INVALID_SNAPSHOT',
    })
  })
})
