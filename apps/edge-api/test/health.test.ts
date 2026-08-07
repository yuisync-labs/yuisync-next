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

  it('mantém banco e coordenação desligados por padrão', async () => {
    const response = await request('/ready')
    const body = await response.json<{
      status: string
      checks: { configuration: string; database: string; coordination: string }
      database_latency_ms: number | null
      missing_bindings: string[]
    }>()

    expect(response.status).toBe(200)
    expect(body).toEqual(expect.objectContaining({
      status: 'ready',
      checks: {
        configuration: 'ok',
        database: 'disabled',
        coordination: 'disabled',
      },
      database_latency_ms: null,
      missing_bindings: [],
    }))
  })

  it('valida D1 no readiness quando a feature flag é habilitada', async () => {
    const response = await request('/ready', undefined, {
      ...testBindings,
      EDGE_DATABASE_ENABLED: 'true',
    })
    const body = await response.json<{
      status: string
      checks: { database: string }
      database_latency_ms: number | null
    }>()

    expect(response.status).toBe(200)
    expect(body.status).toBe('ready')
    expect(body.checks.database).toBe('ready')
    expect(body.database_latency_ms).toEqual(expect.any(Number))
  })

  it('falha fechado quando a flag está ativa sem binding D1', async () => {
    const response = await request('/ready', undefined, {
      ...testBindings,
      EDGE_DATABASE_ENABLED: 'true',
      DB: undefined,
    })
    const body = await response.json<{
      status: string
      checks: { database: string }
      database_latency_ms: number | null
    }>()

    expect(response.status).toBe(503)
    expect(body).toMatchObject({
      status: 'not_ready',
      checks: { database: 'not_configured' },
      database_latency_ms: null,
    })
  })

  it('valida o binding de coordenação quando a feature flag é habilitada', async () => {
    const response = await request('/ready', undefined, {
      ...testBindings,
      EDGE_COORDINATION_ENABLED: 'true',
    })
    const body = await response.json<{
      status: string
      checks: { coordination: string }
    }>()

    expect(response.status).toBe(200)
    expect(body.status).toBe('ready')
    expect(body.checks.coordination).toBe('ready')
  })

  it('falha fechado quando a coordenação está ativa sem binding', async () => {
    const response = await request('/ready', undefined, {
      ...testBindings,
      EDGE_COORDINATION_ENABLED: 'true',
      COORDINATOR: undefined,
    })
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
