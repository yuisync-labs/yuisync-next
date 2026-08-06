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
const canaryToken = 'phase06-test-token-0123456789abcdef0123456789abcdef'

async function postCanary(
  probeId: string,
  authorization: string | undefined,
): Promise<Response> {
  const context = createExecutionContext()
  const headers = new Headers({
    'content-type': 'application/json',
  })
  if (authorization) headers.set('authorization', authorization)

  const response = await worker.fetch(
    new Request('https://edge.test/_internal/coordination/canary', {
      method: 'POST',
      headers,
      body: JSON.stringify({ probe_id: probeId }),
    }),
    {
      ...testBindings,
      EDGE_COORDINATION_ENABLED: 'true',
      EDGE_COORDINATION_CANARY_TOKEN: canaryToken,
    },
    context,
  )
  await waitOnExecutionContext(context)
  return response
}

describe('coordination canary route', () => {
  it('permanece oculta sem autorização válida', async () => {
    const response = await postCanary(
      `phase06-hidden-${crypto.randomUUID()}`,
      'Bearer invalid-token',
    )
    const body = await response.json<{ code: string }>()

    expect(response.status).toBe(404)
    expect(body.code).toBe('NOT_FOUND')
  })

  it('comprova serialização, conclusão e idempotência no runtime Workers', async () => {
    const probeId = `phase06-runtime-${crypto.randomUUID()}`
    const response = await postCanary(probeId, `Bearer ${canaryToken}`)
    const body = await response.json<{
      status: string
      probe_id: string
      claims: { claimed: number; busy: number }
      completion: string
      duplicate_status: string
      fencing_token: number
      request_id: string
    }>()

    expect(response.status).toBe(200)
    expect(body).toMatchObject({
      status: 'passed',
      probe_id: probeId,
      claims: {
        claimed: 1,
        busy: 1,
      },
      completion: 'completed',
      duplicate_status: 'succeeded',
      fencing_token: 1,
    })
    expect(body.request_id).toBe(response.headers.get('x-request-id'))
  })
})
