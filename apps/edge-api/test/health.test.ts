import {
  createExecutionContext,
  env,
  waitOnExecutionContext,
} from 'cloudflare:test'
import { describe, expect, it } from 'vitest'

import worker from '../src/index'

async function request(path: string, headers?: HeadersInit): Promise<Response> {
  const context = createExecutionContext()
  const response = await worker.fetch(
    new Request(`https://edge.test${path}`, { headers }),
    env,
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
      'x-request-id': 'inválido com espaços',
    })
    const requestId = response.headers.get('x-request-id')

    expect(requestId).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('responde readiness sem acessar banco ou integrações reais', async () => {
    const response = await request('/ready')
    const body = await response.json<{
      status: string
      checks: { configuration: string }
      missing_bindings: string[]
    }>()

    expect(response.status).toBe(200)
    expect(body).toEqual(expect.objectContaining({
      status: 'ready',
      checks: { configuration: 'ok' },
      missing_bindings: [],
    }))
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
