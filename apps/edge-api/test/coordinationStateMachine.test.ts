import { describe, expect, it } from 'vitest'

import {
  claimCoordination,
  completeCoordination,
  createEmptyCoordinationState,
} from '../src/coordination/coordinationStateMachine'

const scope = {
  tenantId: 'tenant-petshop-001',
  resourceType: 'professional_schedule',
  resourceId: 'professional-001',
} as const

function claimRequest(overrides: Partial<{
  operationId: string
  idempotencyKey: string
  nowMs: number
  leaseDurationMs: number
}> = {}) {
  return {
    scope,
    operationId: overrides.operationId ?? 'operation-001',
    idempotencyKey: overrides.idempotencyKey ?? 'coordination-001',
    nowMs: overrides.nowMs ?? 1_000,
    leaseDurationMs: overrides.leaseDurationMs ?? 5_000,
  }
}

describe('deterministic coordination state machine', () => {
  it('deduplica o mesmo claim sem avançar o fencing token', () => {
    const first = claimCoordination(createEmptyCoordinationState(), claimRequest())
    const duplicate = claimCoordination(first.state, claimRequest({ nowMs: 1_500 }))

    expect(first.result).toEqual({
      kind: 'claimed',
      fencingToken: 1,
      leaseExpiresAtMs: 6_000,
      reclaimed: false,
    })
    expect(duplicate.result).toEqual({
      kind: 'duplicate',
      status: 'claimed',
      fencingToken: 1,
    })
    expect(duplicate.state).toBe(first.state)
    expect(duplicate.state.nextFencingToken).toBe(2)
  })

  it('bloqueia uma operação concorrente enquanto a lease está ativa', () => {
    const first = claimCoordination(createEmptyCoordinationState(), claimRequest())
    const concurrent = claimCoordination(first.state, claimRequest({
      operationId: 'operation-002',
      idempotencyKey: 'coordination-002',
      nowMs: 2_000,
    }))

    expect(concurrent.result).toEqual({
      kind: 'busy',
      leaseExpiresAtMs: 6_000,
    })
    expect(concurrent.state).toBe(first.state)
  })

  it('recupera uma lease expirada com fencing token crescente', () => {
    const first = claimCoordination(createEmptyCoordinationState(), claimRequest())
    const recovered = claimCoordination(first.state, claimRequest({
      nowMs: 6_000,
    }))

    expect(recovered.result).toEqual({
      kind: 'claimed',
      fencingToken: 2,
      leaseExpiresAtMs: 11_000,
      reclaimed: true,
    })

    const staleCompletion = completeCoordination(recovered.state, {
      scope,
      operationId: 'operation-001',
      idempotencyKey: 'coordination-001',
      fencingToken: 1,
      nowMs: 6_100,
    })

    expect(staleCompletion.result).toEqual({ kind: 'stale' })
  })

  it('conclui somente o holder atual e libera o escopo', () => {
    const claimed = claimCoordination(createEmptyCoordinationState(), claimRequest())
    const completed = completeCoordination(claimed.state, {
      scope,
      operationId: 'operation-001',
      idempotencyKey: 'coordination-001',
      fencingToken: 1,
      nowMs: 2_000,
    })

    expect(completed.result).toEqual({ kind: 'completed' })
    expect(completed.state.holder).toBeNull()

    const next = claimCoordination(completed.state, claimRequest({
      operationId: 'operation-002',
      idempotencyKey: 'coordination-002',
      nowMs: 2_100,
    }))

    expect(next.result).toMatchObject({
      kind: 'claimed',
      fencingToken: 2,
    })

    const duplicateCompletion = completeCoordination(completed.state, {
      scope,
      operationId: 'operation-001',
      idempotencyKey: 'coordination-001',
      fencingToken: 1,
      nowMs: 2_200,
    })
    expect(duplicateCompletion.result).toEqual({ kind: 'duplicate' })
  })

  it('rejeita reutilização da chave idempotente para outra operação', () => {
    const first = claimCoordination(createEmptyCoordinationState(), claimRequest())
    const conflict = claimCoordination(first.state, claimRequest({
      operationId: 'operation-different',
      nowMs: 1_100,
    }))

    expect(conflict.result).toEqual({ kind: 'conflict' })
    expect(conflict.state).toBe(first.state)
  })

  it('expira uma conclusão tardia sem liberar um holder mais novo', () => {
    const first = claimCoordination(createEmptyCoordinationState(), claimRequest())
    const second = claimCoordination(first.state, claimRequest({
      operationId: 'operation-002',
      idempotencyKey: 'coordination-002',
      nowMs: 6_000,
    }))
    const late = completeCoordination(second.state, {
      scope,
      operationId: 'operation-001',
      idempotencyKey: 'coordination-001',
      fencingToken: 1,
      nowMs: 6_100,
    })

    expect(late.result).toEqual({ kind: 'expired' })
    expect(late.state.holder).toEqual(second.state.holder)
  })
})
