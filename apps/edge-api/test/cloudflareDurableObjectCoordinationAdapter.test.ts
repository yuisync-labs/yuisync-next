import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'

import type {
  CoordinationClaimRequest,
  CoordinationScope,
} from '../../../server/application/ports/coordination'
import {
  CloudflareDurableObjectCoordinationAdapter,
  coordinationObjectName,
} from '../src/adapters/cloudflareDurableObjectCoordinationAdapter'
import { createCoordinationPort } from '../src/coordination/createCoordinationPort'
import type { CoordinationDurableObject } from '../src/coordination/coordinationDurableObject'

type DurableTestEnv = EdgeEnv & Readonly<{
  EDGE_COORDINATION_ENABLED?: string
  COORDINATOR: DurableObjectNamespace<CoordinationDurableObject>
}>

const durableEnv = env as unknown as DurableTestEnv

const scope: CoordinationScope = {
  tenantId: 'tenant-adapter-test',
  resourceType: 'schedule',
  resourceId: 'professional-1',
}

function claimRequest(
  operationId: string,
  idempotencyKey: string,
  requestedScope: CoordinationScope = scope,
): CoordinationClaimRequest {
  return {
    scope: requestedScope,
    operationId,
    idempotencyKey,
    nowMs: 1_000,
    leaseDurationMs: 5_000,
  }
}

describe('CloudflareDurableObjectCoordinationAdapter', () => {
  it('gera nome determinístico e opaco por escopo', async () => {
    const first = await coordinationObjectName(scope)
    const repeated = await coordinationObjectName({ ...scope })
    const other = await coordinationObjectName({
      ...scope,
      resourceId: 'professional-2',
    })

    expect(first).toMatch(/^coordination-v1-[0-9a-f]{64}$/)
    expect(repeated).toBe(first)
    expect(other).not.toBe(first)
    expect(first).not.toContain(scope.tenantId)
    expect(first).not.toContain(scope.resourceId)
  })

  it('falha fechado quando a feature flag está desligada', async () => {
    const port = createCoordinationPort(durableEnv)

    await expect(port.claim(claimRequest(
      'operation-disabled',
      'idempotency-disabled',
    ))).rejects.toMatchObject({
      name: 'CoordinationAdapterError',
      code: 'COORDINATION_DISABLED',
      message: 'Coordination is disabled.',
    })
  })

  it('falha fechado quando a flag está ativa sem binding', async () => {
    const adapter = new CloudflareDurableObjectCoordinationAdapter(undefined, true)

    await expect(adapter.claim(claimRequest(
      'operation-no-binding',
      'idempotency-no-binding',
    ))).rejects.toMatchObject({
      code: 'COORDINATION_BINDING_UNAVAILABLE',
      message: 'Coordination binding is unavailable.',
    })
  })

  it('roteia o mesmo escopo ao mesmo objeto e escopos distintos isoladamente', async () => {
    const adapter = new CloudflareDurableObjectCoordinationAdapter(
      durableEnv.COORDINATOR,
      true,
    )

    const first = await adapter.claim(claimRequest(
      'operation-adapter-a',
      'idempotency-adapter-a',
    ))
    expect(first.kind).toBe('claimed')

    const sameScope = await adapter.claim(claimRequest(
      'operation-adapter-b',
      'idempotency-adapter-b',
    ))
    expect(sameScope.kind).toBe('busy')

    const isolatedScope = await adapter.claim(claimRequest(
      'operation-adapter-c',
      'idempotency-adapter-c',
      {
        ...scope,
        resourceId: 'professional-isolated',
      },
    ))
    expect(isolatedScope.kind).toBe('claimed')
  })

  it('não propaga detalhes de falhas do transporte', async () => {
    const rawFailure = 'internal-secret-transport-detail'
    const failingNamespace = {
      getByName: () => ({
        claim: async () => {
          throw new Error(rawFailure)
        },
        complete: async () => {
          throw new Error(rawFailure)
        },
      }),
    } as unknown as DurableObjectNamespace<CoordinationDurableObject>
    const adapter = new CloudflareDurableObjectCoordinationAdapter(
      failingNamespace,
      true,
    )

    let observed: unknown
    try {
      await adapter.claim(claimRequest(
        'operation-transport',
        'idempotency-transport',
      ))
    } catch (error) {
      observed = error
    }

    expect(observed).toMatchObject({
      name: 'CoordinationAdapterError',
      code: 'COORDINATION_TRANSPORT_FAILED',
      message: 'Coordination request failed.',
    })
    expect(String(observed)).not.toContain(rawFailure)
  })
})
