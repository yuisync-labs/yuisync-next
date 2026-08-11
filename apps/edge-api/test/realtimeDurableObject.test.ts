import { env } from 'cloudflare:workers'
import { evictDurableObject } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'

import {
  CoordinationDurableObject,
  type RealtimeInvalidationEvent,
} from '../src/coordination/coordinationDurableObject'

type DurableTestEnv = Readonly<{
  COORDINATOR: DurableObjectNamespace<CoordinationDurableObject>
}>

const durableEnv = env as unknown as DurableTestEnv

function nextMessage(socket: WebSocket): Promise<string> {
  return new Promise((resolve) => {
    socket.addEventListener('message', (event) => resolve(String(event.data)), { once: true })
  })
}

function connectRequest(tenantId: string, moduleId: string): Request {
  return new Request('https://realtime.internal/realtime/connect', {
    headers: {
      upgrade: 'websocket',
      'x-realtime-principal-id': 'principal-realtime-test',
      'x-realtime-tenant-id': tenantId,
      'x-realtime-module-id': moduleId,
    },
  })
}

describe('CoordinationDurableObject realtime hub', () => {
  it('broadcasts invalidations and preserves the socket across hibernation eviction', async () => {
    const tenantId = 'tenant-realtime-hibernate'
    const moduleId = 'petshop'
    const stub = durableEnv.COORDINATOR.getByName('realtime-hibernate-test')
    const response = await stub.fetch(connectRequest(tenantId, moduleId))

    expect(response.status).toBe(101)
    const socket = response.webSocket
    if (!socket) throw new Error('Expected realtime WebSocket response.')
    socket.accept()

    const subscribed = JSON.parse(await nextMessage(socket)) as Record<string, unknown>
    expect(subscribed).toMatchObject({
      type: 'realtime.system',
      event: 'SUBSCRIBED',
      tenantId,
      moduleId,
    })

    await evictDurableObject(stub)

    const event: RealtimeInvalidationEvent = {
      type: 'realtime.invalidate',
      eventId: 'event-after-hibernation',
      schema: 'edge',
      eventType: 'SYNC',
      table: 'appointments',
      tenantId,
      moduleId,
      source: '/api/compat/query',
      occurredAtMs: 123456,
    }
    const broadcast = nextMessage(socket)
    await expect(stub.publishRealtime(event)).resolves.toEqual({ delivered: 1 })
    expect(JSON.parse(await broadcast)).toEqual(event)

    await evictDurableObject(stub)
    const pong = nextMessage(socket)
    socket.send('ping')
    expect(await pong).toBe('pong')
    socket.close(1000, 'done')
  })

  it('fails closed when a realtime object is reused for a different scope', async () => {
    const stub = durableEnv.COORDINATOR.getByName('realtime-scope-test')
    const response = await stub.fetch(connectRequest('tenant-realtime-a', 'petshop'))
    const socket = response.webSocket
    if (!socket) throw new Error('Expected realtime WebSocket response.')
    socket.accept()
    await nextMessage(socket)

    await expect(stub.publishRealtime({
      type: 'realtime.invalidate',
      eventId: 'wrong-scope',
      schema: 'edge',
      eventType: 'SYNC',
      table: null,
      tenantId: 'tenant-realtime-b',
      moduleId: 'petshop',
      source: '/test',
      occurredAtMs: 1,
    })).rejects.toMatchObject({ code: 'COORDINATION_SCOPE_MISMATCH' })

    socket.close(1000, 'done')
  })
})
