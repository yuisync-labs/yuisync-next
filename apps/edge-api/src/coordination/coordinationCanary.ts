import type {
  CoordinationClaimRequest,
  CoordinationClaimResult,
  CoordinationScope,
} from '../../../../server/application/ports/coordination'
import type { EdgeAppEnvironment } from '../types'
import { createCoordinationPort } from './createCoordinationPort'

const PROBE_ID_PATTERN = /^[a-zA-Z0-9_-]{8,96}$/

export class CoordinationCanaryInputError extends Error {
  constructor() {
    super('Coordination canary request is invalid.')
    this.name = 'CoordinationCanaryInputError'
  }
}

export type CoordinationCanaryResult = Readonly<{
  status: 'passed'
  probe_id: string
  claims: Readonly<{
    claimed: number
    busy: number
  }>
  completion: 'completed'
  duplicate_status: 'succeeded'
  fencing_token: number
}>

function secureEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false

  let difference = 0
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index)
  }
  return difference === 0
}

export function isCoordinationCanaryAuthorized(
  env: EdgeAppEnvironment['Bindings'],
  authorization: string | undefined,
): boolean {
  const token = env.EDGE_COORDINATION_CANARY_TOKEN?.trim()
  if (!token || token.length < 32 || !authorization) return false
  return secureEqual(authorization, `Bearer ${token}`)
}

function requireProbeId(value: unknown): string {
  if (typeof value !== 'string' || !PROBE_ID_PATTERN.test(value)) {
    throw new CoordinationCanaryInputError()
  }
  return value
}

function claimedResult(
  results: readonly CoordinationClaimResult[],
): { index: number; result: Extract<CoordinationClaimResult, { kind: 'claimed' }> } {
  const index = results.findIndex((result) => result.kind === 'claimed')
  const result = index >= 0 ? results[index] : undefined
  if (!result || result.kind !== 'claimed') {
    throw new Error('Coordination canary invariant failed.')
  }
  return { index, result }
}

export async function runCoordinationCanary(
  env: EdgeAppEnvironment['Bindings'],
  rawProbeId: unknown,
): Promise<CoordinationCanaryResult> {
  const probeId = requireProbeId(rawProbeId)
  const port = createCoordinationPort(env)
  const nowMs = Date.now()
  const scope: CoordinationScope = {
    tenantId: 'system-canary',
    resourceType: 'coordination-canary',
    resourceId: probeId,
  }

  const requests: readonly CoordinationClaimRequest[] = [
    {
      scope,
      operationId: `${probeId}-operation-a`,
      idempotencyKey: `${probeId}-idempotency-a`,
      nowMs,
      leaseDurationMs: 30_000,
    },
    {
      scope,
      operationId: `${probeId}-operation-b`,
      idempotencyKey: `${probeId}-idempotency-b`,
      nowMs,
      leaseDurationMs: 30_000,
    },
  ]

  const results = await Promise.all(requests.map((request) => port.claim(request)))
  const winner = claimedResult(results)
  const busyCount = results.filter((result) => result.kind === 'busy').length

  if (busyCount !== 1) {
    throw new Error('Coordination canary invariant failed.')
  }

  const winnerRequest = requests[winner.index]
  const completion = await port.complete({
    scope,
    operationId: winnerRequest.operationId,
    idempotencyKey: winnerRequest.idempotencyKey,
    fencingToken: winner.result.fencingToken,
    nowMs: nowMs + 1,
  })

  if (completion.kind !== 'completed') {
    throw new Error('Coordination canary invariant failed.')
  }

  const duplicate = await port.claim({
    ...winnerRequest,
    nowMs: nowMs + 2,
  })

  if (
    duplicate.kind !== 'duplicate' ||
    duplicate.status !== 'succeeded' ||
    duplicate.fencingToken !== winner.result.fencingToken
  ) {
    throw new Error('Coordination canary invariant failed.')
  }

  return {
    status: 'passed',
    probe_id: probeId,
    claims: {
      claimed: 1,
      busy: busyCount,
    },
    completion: 'completed',
    duplicate_status: 'succeeded',
    fencing_token: winner.result.fencingToken,
  }
}
