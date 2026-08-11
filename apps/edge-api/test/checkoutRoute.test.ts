import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'

import worker from '../src/index'

function context(): ExecutionContext {
  return {
    waitUntil() {},
    passThroughOnException() {},
    props: {},
  } as unknown as ExecutionContext
}

describe('PDV checkout Worker routing', () => {
  it('routes GET /api/petshop/checkout to the checkout handler instead of the app 404', async () => {
    const response = await worker.fetch(
      new Request('https://edge.test/api/petshop/checkout', { method: 'GET' }),
      env as EdgeEnv,
      context(),
    )

    expect(response.status).toBe(405)
    expect(await response.json()).toEqual({ code: 'METHOD_NOT_ALLOWED' })
  })

  it('routes POST /api/petshop/checkout before the fallback app', async () => {
    const response = await worker.fetch(
      new Request('https://edge.test/api/petshop/checkout', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      }),
      env as EdgeEnv,
      context(),
    )

    expect(response.status).toBe(400)
    const body = await response.json<Record<string, any>>()
    expect(body.success).toBe(false)
    expect(body.error?.code).toBe('INVALID_TENANT')
  })
})
