import { env } from 'cloudflare:workers'
import { evictDurableObject, runInDurableObject } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'

import type {
  CoordinationClaimRequest,
  CoordinationScope,
} from '../../../server/application/ports/coordination'
import { CoordinationDurableObject } from '../src/coordination/coordinationDurableObject'

type DurableTestEnv = Readonly<{
  COORDINATOR: DurableObjectNamespace<CoordinationDurableObject>
}>

const durableEnv = env as unknown as DurableTestEnv

const scope: CoordinationScope = {
  tenantId: 'tenant-durable-test',
  resourceType: 'schedule',
  resourceId: 'professional-1',
}

function claimRequest(
  operationId: string,
  idempotencyKey: string,
  nowMs: number,
  requestedScope: CoordinationScope = scope,
): CoordinationClaimRequest {
  return {
    scope: requestedScope,
    operationId,
    idempotencyKey,
    nowMs,
    leaseDurationMs: 5_000,
  }
}

describe('CoordinationDurableObject', () => {
  it('serializa claims concorrentes para o mesmo recurso', async () => {
    const stub = durableEnv.COORDINATOR.getByName('coordination-concurrency')

    const results = await Promise.all([
      stub.claim(claimRequest('operation-a', 'idempotency-a', 1_000)),
      stub.claim(claimRequest('operation-b', 'idempotency-b', 1_000)),
    ])

    expect(results.filter((result) => result.kind === 'claimed')).toHaveLength(1)
    expect(results.filter((result) => result.kind === 'busy')).toHaveLength(1)
  })

  it('preserva lease, token e idempotência depois de eviction', async () => {
    const stub = durableEnv.COORDINATOR.getByName('coordination-eviction')
    const request = claimRequest('operation-eviction', 'idempotency-eviction', 10_000)

    const claimed = await stub.claim(request)
    expect(claimed.kind).toBe('claimed')
    if (claimed.kind !== 'claimed') throw new Error('Expected coordination claim.')

    await evictDurableObject(stub)

    const duplicateWhileClaimed = await stub.claim({
      ...request,
      nowMs: 11_000,
    })
    expect(duplicateWhileClaimed).toEqual({
      kind: 'duplicate',
      status: 'claimed',
      fencingToken: claimed.fencingToken,
    })

    expect(await stub.complete({
      scope,
      operationId: request.operationId,
      idempotencyKey: request.idempotencyKey,
      fencingToken: claimed.fencingToken,
      nowMs: 12_000,
    })).toEqual({ kind: 'completed' })

    await evictDurableObject(stub)

    const duplicateAfterCompletion = await stub.claim({
      ...request,
      nowMs: 13_000,
    })
    expect(duplicateAfterCompletion).toEqual({
      kind: 'duplicate',
      status: 'succeeded',
      fencingToken: claimed.fencingToken,
    })
  })

  it('rejeita reutilização do mesmo objeto por outro escopo', async () => {
    const stub = durableEnv.COORDINATOR.getByName('coordination-scope-isolation')

    await stub.claim(claimRequest('operation-scope-a', 'idempotency-scope-a', 20_000))

    await expect(stub.claim(claimRequest(
      'operation-scope-b',
      'idempotency-scope-b',
      20_100,
      {
        tenantId: 'tenant-other',
        resourceType: scope.resourceType,
        resourceId: scope.resourceId,
      },
    ))).rejects.toThrow('Coordination scope mismatch.')
  })

  it('persiste somente metadados internos sanitizados no SQLite', async () => {
    const stub = durableEnv.COORDINATOR.getByName('coordination-storage')
    const request = claimRequest('operation-storage', 'idempotency-storage', 30_000)
    const claimed = await stub.claim(request)

    if (claimed.kind !== 'claimed') throw new Error('Expected coordination claim.')

    await stub.complete({
      scope,
      operationId: request.operationId,
      idempotencyKey: request.idempotencyKey,
      fencingToken: claimed.fencingToken,
      nowMs: 31_000,
    })

    await runInDurableObject(stub, (instance, state) => {
      expect(instance).toBeInstanceOf(CoordinationDurableObject)

      const metadata = state.storage.sql.exec<{
        next_fencing_token: number
        tenant_id: string
        resource_type: string
        resource_id: string
      }>(`
        SELECT next_fencing_token, tenant_id, resource_type, resource_id
        FROM coordination_metadata
        WHERE singleton = 1
      `).one()

      expect(metadata).toEqual({
        next_fencing_token: 2,
        tenant_id: scope.tenantId,
        resource_type: scope.resourceType,
        resource_id: scope.resourceId,
      })

      expect(state.storage.sql.exec<{ status: string; completed_at_ms: number }>(`
        SELECT status, completed_at_ms
        FROM coordination_operations
        WHERE idempotency_key = 'idempotency-storage'
      `).one()).toEqual({
        status: 'succeeded',
        completed_at_ms: 31_000,
      })

      expect(state.storage.sql.exec<{ count: number }>(`
        SELECT COUNT(*) AS count FROM coordination_holder
      `).one().count).toBe(0)
    })
  })
})
