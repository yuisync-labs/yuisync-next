import type {
  CoordinationClaimRequest,
  CoordinationClaimResult,
  CoordinationCompletionRequest,
  CoordinationCompletionResult,
  CoordinationPort,
  CoordinationScope,
} from '../../../../server/application/ports/coordination'
import type { CoordinationDurableObject } from '../coordination/coordinationDurableObject'
import { hasCoordinationBinding } from '../coordination/coordinationFeature'

export type CoordinationAdapterErrorCode =
  | 'COORDINATION_DISABLED'
  | 'COORDINATION_BINDING_UNAVAILABLE'
  | 'COORDINATION_TRANSPORT_FAILED'

export class CoordinationAdapterError extends Error {
  readonly code: CoordinationAdapterErrorCode

  constructor(code: CoordinationAdapterErrorCode) {
    super(
      code === 'COORDINATION_DISABLED'
        ? 'Coordination is disabled.'
        : code === 'COORDINATION_BINDING_UNAVAILABLE'
          ? 'Coordination binding is unavailable.'
          : 'Coordination request failed.',
    )
    this.name = 'CoordinationAdapterError'
    this.code = code
  }
}

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer), (value) => value.toString(16).padStart(2, '0')).join('')
}

export async function coordinationObjectName(scope: CoordinationScope): Promise<string> {
  const canonicalScope = JSON.stringify([
    'coordination-scope-v1',
    scope.tenantId,
    scope.resourceType,
    scope.resourceId,
  ])
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(canonicalScope),
  )
  return `coordination-v1-${toHex(digest)}`
}

export class CloudflareDurableObjectCoordinationAdapter implements CoordinationPort {
  constructor(
    private readonly namespace: DurableObjectNamespace<CoordinationDurableObject> | undefined,
    private readonly enabled: boolean,
  ) {}

  async claim(request: CoordinationClaimRequest): Promise<CoordinationClaimResult> {
    const stub = await this.resolveStub(request.scope)
    try {
      return await stub.claim(request)
    } catch {
      throw new CoordinationAdapterError('COORDINATION_TRANSPORT_FAILED')
    }
  }

  async complete(
    request: CoordinationCompletionRequest,
  ): Promise<CoordinationCompletionResult> {
    const stub = await this.resolveStub(request.scope)
    try {
      return await stub.complete(request)
    } catch {
      throw new CoordinationAdapterError('COORDINATION_TRANSPORT_FAILED')
    }
  }

  private async resolveStub(
    scope: CoordinationScope,
  ): Promise<DurableObjectStub<CoordinationDurableObject>> {
    if (!this.enabled) {
      throw new CoordinationAdapterError('COORDINATION_DISABLED')
    }
    if (!hasCoordinationBinding(this.namespace)) {
      throw new CoordinationAdapterError('COORDINATION_BINDING_UNAVAILABLE')
    }

    const name = await coordinationObjectName(scope)
    return this.namespace.getByName(name)
  }
}
