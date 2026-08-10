import type {
  CoordinationClaimRequest,
  CoordinationClaimResult,
  CoordinationCompletionRequest,
  CoordinationCompletionResult,
  CoordinationOperationStatus,
} from '../../../../server/application/ports/coordination'

export type CoordinationStateErrorCode = 'INVALID_COORDINATION_REQUEST'

export class CoordinationStateError extends Error {
  readonly code: CoordinationStateErrorCode

  constructor(code: CoordinationStateErrorCode) {
    super('Coordination request is invalid.')
    this.name = 'CoordinationStateError'
    this.code = code
  }
}

export type CoordinationHolder = Readonly<{
  operationId: string
  idempotencyKey: string
  fencingToken: number
  leaseExpiresAtMs: number
}>

export type CoordinationOperation = Readonly<{
  operationId: string
  idempotencyKey: string
  status: CoordinationOperationStatus
  fencingToken: number
  leaseExpiresAtMs: number
  completedAtMs: number | null
}>

export type CoordinationState = Readonly<{
  nextFencingToken: number
  holder: CoordinationHolder | null
  operations: ReadonlyMap<string, CoordinationOperation>
}>

export type CoordinationTransition<Result> = Readonly<{
  state: CoordinationState
  result: Result
}>

export function createEmptyCoordinationState(): CoordinationState {
  return {
    nextFencingToken: 1,
    holder: null,
    operations: new Map(),
  }
}

function requireIdentifier(value: string): void {
  if (value.length < 1 || value.length > 160 || value.trim() !== value) {
    throw new CoordinationStateError('INVALID_COORDINATION_REQUEST')
  }
}

function requireTimestamp(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new CoordinationStateError('INVALID_COORDINATION_REQUEST')
  }
}

function validateScope(request: CoordinationClaimRequest | CoordinationCompletionRequest): void {
  requireIdentifier(request.scope.tenantId)
  requireIdentifier(request.scope.resourceType)
  requireIdentifier(request.scope.resourceId)
  requireIdentifier(request.operationId)
  requireIdentifier(request.idempotencyKey)
  requireTimestamp(request.nowMs)
}

function expireHolder(
  state: CoordinationState,
  nowMs: number,
): CoordinationState {
  const holder = state.holder
  if (!holder || holder.leaseExpiresAtMs > nowMs) {
    return state
  }

  const operations = new Map(state.operations)
  const operation = operations.get(holder.idempotencyKey)

  if (
    operation &&
    operation.status === 'claimed' &&
    operation.fencingToken === holder.fencingToken
  ) {
    operations.set(holder.idempotencyKey, {
      ...operation,
      status: 'expired',
    })
  }

  return {
    ...state,
    holder: null,
    operations,
  }
}

export function claimCoordination(
  currentState: CoordinationState,
  request: CoordinationClaimRequest,
): CoordinationTransition<CoordinationClaimResult> {
  validateScope(request)

  if (!Number.isSafeInteger(request.leaseDurationMs) || request.leaseDurationMs < 1) {
    throw new CoordinationStateError('INVALID_COORDINATION_REQUEST')
  }

  let state = expireHolder(currentState, request.nowMs)
  const existing = state.operations.get(request.idempotencyKey)

  if (existing && existing.operationId !== request.operationId) {
    return {
      state,
      result: { kind: 'conflict' },
    }
  }

  if (existing?.status === 'succeeded') {
    return {
      state,
      result: {
        kind: 'duplicate',
        status: 'succeeded',
        fencingToken: existing.fencingToken,
      },
    }
  }

  if (
    existing?.status === 'claimed' &&
    state.holder?.idempotencyKey === request.idempotencyKey &&
    state.holder.operationId === request.operationId
  ) {
    return {
      state,
      result: {
        kind: 'duplicate',
        status: 'claimed',
        fencingToken: existing.fencingToken,
      },
    }
  }

  if (state.holder) {
    return {
      state,
      result: {
        kind: 'busy',
        leaseExpiresAtMs: state.holder.leaseExpiresAtMs,
      },
    }
  }

  const fencingToken = state.nextFencingToken
  const leaseExpiresAtMs = request.nowMs + request.leaseDurationMs

  if (!Number.isSafeInteger(leaseExpiresAtMs)) {
    throw new CoordinationStateError('INVALID_COORDINATION_REQUEST')
  }

  const operations = new Map(state.operations)
  operations.set(request.idempotencyKey, {
    operationId: request.operationId,
    idempotencyKey: request.idempotencyKey,
    status: 'claimed',
    fencingToken,
    leaseExpiresAtMs,
    completedAtMs: null,
  })

  state = {
    nextFencingToken: fencingToken + 1,
    holder: {
      operationId: request.operationId,
      idempotencyKey: request.idempotencyKey,
      fencingToken,
      leaseExpiresAtMs,
    },
    operations,
  }

  return {
    state,
    result: {
      kind: 'claimed',
      fencingToken,
      leaseExpiresAtMs,
      reclaimed: existing?.status === 'expired',
    },
  }
}

export function completeCoordination(
  currentState: CoordinationState,
  request: CoordinationCompletionRequest,
): CoordinationTransition<CoordinationCompletionResult> {
  validateScope(request)

  if (!Number.isSafeInteger(request.fencingToken) || request.fencingToken < 1) {
    throw new CoordinationStateError('INVALID_COORDINATION_REQUEST')
  }

  const state = expireHolder(currentState, request.nowMs)
  const operation = state.operations.get(request.idempotencyKey)

  if (!operation) {
    return {
      state,
      result: { kind: 'not_found' },
    }
  }

  if (operation.operationId !== request.operationId) {
    return {
      state,
      result: { kind: 'stale' },
    }
  }

  if (operation.status === 'succeeded') {
    return {
      state,
      result: { kind: 'duplicate' },
    }
  }

  if (operation.status === 'expired') {
    return {
      state,
      result: { kind: 'expired' },
    }
  }

  const holder = state.holder
  if (
    !holder ||
    holder.operationId !== request.operationId ||
    holder.idempotencyKey !== request.idempotencyKey ||
    holder.fencingToken !== request.fencingToken ||
    operation.fencingToken !== request.fencingToken
  ) {
    return {
      state,
      result: { kind: 'stale' },
    }
  }

  const operations = new Map(state.operations)
  operations.set(request.idempotencyKey, {
    ...operation,
    status: 'succeeded',
    completedAtMs: request.nowMs,
  })

  return {
    state: {
      ...state,
      holder: null,
      operations,
    },
    result: { kind: 'completed' },
  }
}
