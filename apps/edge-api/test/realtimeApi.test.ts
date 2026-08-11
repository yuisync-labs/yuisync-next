import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'

import type { CoordinationDurableObject } from '../src/coordination/coordinationDurableObject'
import { handleRealtimeApiRequest } from '../src/realtimeApi'

type RealtimeTestEnv = EdgeEnv & {
  DB: D1Database
  COORDINATOR: DurableObjectNamespace<CoordinationDurableObject>
}

const testEnv = env as RealtimeTestEnv
const tenantId = 'tenant-realtime-api-test'
const principalId = 'principal-realtime-api-test'
const subject = 'auth-realtime-api-test'

async function seedAccess(): Promise<void> {
  const now = Date.now()
  await testEnv.DB.batch([
    testEnv.DB.prepare(`
      INSERT OR IGNORE INTO tenants(id,slug,name,status,created_at_ms,updated_at_ms)
      VALUES(?1,?2,'Realtime API Test','active',?3,?3)
    `).bind(tenantId, tenantId, now),
    testEnv.DB.prepare(`
      INSERT OR IGNORE INTO identity_principals(id,provider,subject,display_name,email,status,created_at_ms,updated_at_ms)
      VALUES(?1,'better-auth',?2,'Realtime User','realtime-api-test@example.invalid','active',?3,?3)
    `).bind(principalId, subject, now),
    testEnv.DB.prepare(`
      INSERT OR REPLACE INTO tenant_memberships(
        tenant_id,principal_id,status,created_at_ms,updated_at_ms,role,module_permissions_json
      ) VALUES(?1,?2,'active',?3,?3,'staff',?4)
    `).bind(tenantId, principalId, now, JSON.stringify({ petshop: { role: 'funcionario_pet' } })),
  ])
}

const getSession = (async () => ({ user: { id: subject } })) as never

function request(moduleId = 'petshop', headers: HeadersInit = {}): Request {
  return new Request(`https://edge.test/api/realtime?tenant_id=${encodeURIComponent(tenantId)}&module_id=${encodeURIComponent(moduleId)}`, {
    headers: {
      upgrade: 'websocket',
      origin: 'https://edge.test',
      ...headers,
    },
  })
}

describe('realtime websocket gateway', () => {
  it('upgrades an authenticated member only inside an allowed tenant/module scope', async () => {
    await seedAccess()
    const response = await handleRealtimeApiRequest(
      request(),
      { DB: testEnv.DB, COORDINATOR: testEnv.COORDINATOR },
      { getSession },
    )

    expect(response?.status).toBe(101)
    const socket = response?.webSocket
    if (!socket) throw new Error('Expected authorized realtime socket.')
    socket.accept()
    socket.close(1000, 'done')
  })

  it('rejects a module that is not present in the membership permissions', async () => {
    await seedAccess()
    const response = await handleRealtimeApiRequest(
      request('finance'),
      { DB: testEnv.DB, COORDINATOR: testEnv.COORDINATOR },
      { getSession },
    )
    expect(response?.status).toBe(403)
    await expect(response?.json()).resolves.toEqual({ code: 'FORBIDDEN' })
  })

  it('rejects cross-origin websocket upgrades before routing to the durable object', async () => {
    await seedAccess()
    const response = await handleRealtimeApiRequest(
      request('petshop', { origin: 'https://evil.example' }),
      { DB: testEnv.DB, COORDINATOR: testEnv.COORDINATOR },
      { getSession },
    )
    expect(response?.status).toBe(403)
    await expect(response?.json()).resolves.toEqual({ code: 'ORIGIN_FORBIDDEN' })
  })
})
