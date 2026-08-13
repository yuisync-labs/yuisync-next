import { env } from 'cloudflare:workers'
import {
  createExecutionContext,
  waitOnExecutionContext,
} from 'cloudflare:test'
import { describe, expect, it } from 'vitest'

import worker from '../src/index'
import type { EdgeAppEnvironment } from '../src/types'

type TestBindings = EdgeAppEnvironment['Bindings']
const testBindings = env as TestBindings
const BETTER_AUTH_SECRET = 'better-auth-secret-fixture-12345678901234567890'

const authDb = {
  prepare: () => ({
    all: async () => ({
      results: [
        { name: 'account' },
        { name: 'session' },
        { name: 'user' },
        { name: 'verification' },
      ],
    }),
  }),
} as unknown as D1Database

function readyBindings(overrides: Partial<TestBindings> = {}): TestBindings {
  return {
    ...testBindings,
    EDGE_DATABASE_ENABLED: 'true',
    EDGE_BETTER_AUTH_ENABLED: 'true',
    AUTH_DB: authDb,
    BETTER_AUTH_SECRET,
    EDGE_OPERATIONAL_MIGRATION_ENABLED: 'false',
    EDGE_AUTH_MIGRATION_ENABLED: 'false',
    ...overrides,
  }
}

async function request(
  path: string,
  headers?: HeadersInit,
  bindings: TestBindings = testBindings,
): Promise<Response> {
  const context = createExecutionContext()
  const response = await worker.fetch(
    new Request(`https://edge.test${path}`, { headers }),
    bindings,
    context,
  )
  await waitOnExecutionContext(context)
  return response
}

describe('YuiSync edge foundation', () => {
  it('responde liveness com bindings do ambiente de teste', async () => {
    const response = await request('/health', {
      'x-request-id': 'request-health-123',
    })
    const body = await response.json<{
      service: string
      environment: string
      release_channel: string
      request_id: string
      status: string
      timestamp: string
    }>()

    expect(response.status).toBe(200)
    expect(response.headers.get('x-request-id')).toBe('request-health-123')
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(body).toMatchObject({
      service: 'yuisync-edge-api',
      environment: 'test',
      release_channel: 'test',
      request_id: 'request-health-123',
      status: 'ok',
    })
    expect(Number.isNaN(Date.parse(body.timestamp))).toBe(false)
  })

  it('gera correlation id quando o cabeçalho recebido é inválido', async () => {
    const response = await request('/health', {
      'x-request-id': 'invalid with spaces',
    })
    const requestId = response.headers.get('x-request-id')

    expect(requestId).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('mantém o cutover indisponível enquanto banco e Better Auth estão desligados', async () => {
    const response = await request('/ready')
    const body = await response.json<{
      status: string
      checks: Record<string, string | null>
    }>()

    expect(response.status).toBe(503)
    expect(body).toEqual(expect.objectContaining({
      status: 'not_ready',
      checks: expect.objectContaining({
        database: 'ready',
        schema_version: '25',
        auth_database: 'not_configured',
        coordination: 'disabled',
        better_auth: 'disabled',
        migration_capabilities: 'closed',
      }),
    }))
  })

  it('fica ready somente com D1 v25, AUTH_DB e Better Auth configurados', async () => {
    const response = await request('/ready', undefined, readyBindings())
    const body = await response.json<{
      status: string
      checks: Record<string, string | null>
    }>()

    expect(response.status).toBe(200)
    expect(body).toMatchObject({
      status: 'ready',
      checks: {
        database: 'ready',
        schema_version: '25',
        auth_database: 'configured',
        coordination: 'disabled',
        better_auth: 'enabled',
        migration_capabilities: 'closed',
      },
    })
  })

  it('falha fechado quando a flag de banco está ativa sem binding D1', async () => {
    const response = await request('/ready', undefined, readyBindings({ DB: undefined }))
    const body = await response.json<{
      status: string
      checks: { database: string; schema_version: string | null }
    }>()

    expect(response.status).toBe(503)
    expect(body).toMatchObject({
      status: 'not_ready',
      checks: { database: 'not_configured', schema_version: null },
    })
  })

  it('valida o binding de coordenação quando a feature flag é habilitada', async () => {
    const response = await request('/ready', undefined, readyBindings({
      EDGE_COORDINATION_ENABLED: 'true',
    }))
    const body = await response.json<{
      status: string
      checks: { coordination: string }
    }>()

    expect(response.status).toBe(200)
    expect(body.status).toBe('ready')
    expect(body.checks.coordination).toBe('ready')
  })

  it('falha fechado quando a coordenação está ativa sem binding', async () => {
    const response = await request('/ready', undefined, readyBindings({
      EDGE_COORDINATION_ENABLED: 'true',
      COORDINATOR: undefined,
    }))
    const body = await response.json<{
      status: string
      checks: { coordination: string }
    }>()

    expect(response.status).toBe(503)
    expect(body).toMatchObject({
      status: 'not_ready',
      checks: { coordination: 'not_configured' },
    })
  })

  it('falha fechado quando Better Auth está ativo sem AUTH_DB configurado', async () => {
    const response = await request('/ready', undefined, readyBindings({ AUTH_DB: undefined }))
    const body = await response.json<{
      status: string
      checks: { auth_database: string; better_auth: string }
    }>()

    expect(response.status).toBe(503)
    expect(body).toMatchObject({
      status: 'not_ready',
      checks: { auth_database: 'not_configured', better_auth: 'enabled' },
    })
  })

  it('bloqueia readiness enquanto capacidades de migração permanecem abertas', async () => {
    const response = await request('/ready', undefined, readyBindings({
      EDGE_OPERATIONAL_MIGRATION_ENABLED: 'true',
    }))
    const body = await response.json<{
      status: string
      checks: { migration_capabilities: string }
    }>()

    expect(response.status).toBe(503)
    expect(body).toMatchObject({
      status: 'not_ready',
      checks: { migration_capabilities: 'open' },
    })
  })

  it('expõe somente a fundação na raiz', async () => {
    const response = await request('/')
    const body = await response.json<{ status: string }>()

    expect(response.status).toBe(200)
    expect(body.status).toBe('foundation_only')
  })

  it('retorna erro sanitizado para rotas inexistentes', async () => {
    const response = await request('/catalog')
    const body = await response.json<{
      code: string
      message: string
      request_id: string
    }>()

    expect(response.status).toBe(404)
    expect(body.code).toBe('NOT_FOUND')
    expect(body.message).toBe('Rota não encontrada.')
    expect(body.request_id).toBe(response.headers.get('x-request-id'))
  })
})
