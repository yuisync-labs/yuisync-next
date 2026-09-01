import { env } from 'cloudflare:workers'
import { afterEach, describe, expect, it, vi } from 'vitest'

import app from '../src/app'
import type { EdgeAppEnvironment } from '../src/types'

const testEnv = env as EdgeEnv & { DB: D1Database }
const { COORDINATOR: testCoordinatorBinding, ...testEnvWithoutCoordinator } = testEnv
void testCoordinatorBinding
const NOW_MS = 1_786_108_800_000

type AppBindings = EdgeAppEnvironment['Bindings']

function createBindings(overrides: Partial<AppBindings> = {}): AppBindings {
  return {
    ...testEnvWithoutCoordinator,
    APP_ENV: 'test',
    SERVICE_NAME: 'yuisync-edge-api',
    RELEASE_CHANNEL: 'test',
    EDGE_DATABASE_ENABLED: 'true',
    EDGE_COORDINATION_ENABLED: 'false',
    EDGE_IDENTITY_CANARY_ENABLED: 'true',
    SUPABASE_URL: 'https://project-ref.supabase.co',
    SUPABASE_PUBLISHABLE_KEY: 'publishable-test-key',
    DB: testEnv.DB,
    ...overrides,
  }
}

async function seedAuthorizedIdentity(): Promise<void> {
  await testEnv.DB.batch([
    testEnv.DB.prepare(`
      INSERT INTO tenants (id, slug, name, status, created_at_ms, updated_at_ms)
      VALUES (?, ?, ?, 'active', ?, ?)
    `).bind(
      'tenant-canary-route',
      'tenant-canary-route',
      'Tenant Canary Route',
      NOW_MS,
      NOW_MS,
    ),
    testEnv.DB.prepare(`
      INSERT INTO identity_principals (
        id,
        provider,
        subject,
        display_name,
        status,
        created_at_ms,
        updated_at_ms
      ) VALUES (?, 'supabase', ?, ?, 'active', ?, ?)
    `).bind(
      'principal-canary-route',
      'subject-canary-route',
      'Principal Canary Route',
      NOW_MS,
      NOW_MS,
    ),
    testEnv.DB.prepare(`
      INSERT INTO tenant_memberships (
        tenant_id,
        principal_id,
        status,
        created_at_ms,
        updated_at_ms
      ) VALUES (?, ?, 'active', ?, ?)
    `).bind(
      'tenant-canary-route',
      'principal-canary-route',
      NOW_MS,
      NOW_MS,
    ),
  ])
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('identity canary route', () => {
  it('fica indistinguível de rota inexistente quando a flag está desligada', async () => {
    const response = await app.request(
      'https://worker.test/internal/canary/tenant-context',
      {},
      createBindings({ EDGE_IDENTITY_CANARY_ENABLED: 'false' }),
    )

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toMatchObject({
      code: 'NOT_FOUND',
    })
  })

  it('faz readiness falhar se o canário for ligado sem config de identidade', async () => {
    const response = await app.request(
      'https://worker.test/ready',
      {},
      createBindings({
        SUPABASE_URL: undefined,
        SUPABASE_PUBLISHABLE_KEY: undefined,
      }),
    )

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toMatchObject({
      status: 'not_ready',
      checks: {
        identity_canary: 'not_configured',
      },
      missing_bindings: [
        'SUPABASE_URL',
        'SUPABASE_PUBLISHABLE_KEY',
      ],
    })
  })

  it('prova Bearer -> Supabase subject -> membership D1 -> principal context', async () => {
    await seedAuthorizedIdentity()

    vi.stubGlobal('fetch', async () => Response.json({
      id: 'subject-canary-route',
    }))

    const response = await app.request(
      'https://worker.test/internal/canary/tenant-context',
      {
        headers: {
          authorization: 'Bearer opaque-canary-token',
          'x-tenant-id': 'tenant-canary-route',
        },
      },
      createBindings(),
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      status: 'ok',
      tenant_id: 'tenant-canary-route',
      principal_id: 'principal-canary-route',
      identity_provider: 'supabase',
    })
  })

  it('não revela o motivo interno quando a identidade não pertence ao tenant', async () => {
    vi.stubGlobal('fetch', async () => Response.json({
      id: 'subject-without-membership',
    }))

    const response = await app.request(
      'https://worker.test/internal/canary/tenant-context',
      {
        headers: {
          authorization: 'Bearer opaque-canary-token',
          'x-tenant-id': 'tenant-canary-route-missing',
        },
      },
      createBindings(),
    )

    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({
      code: 'FORBIDDEN',
      message: 'Acesso ao tenant negado.',
    })
  })
})
