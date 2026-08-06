export type CoordinationOperationStatus = 'claimed' | 'succeeded' | 'expired'

export type CoordinationScope = Readonly<{
  tenantId: string
  resourceType: string
  resourceId: string
}>

export type CoordinationClaimRequest = Readonly<{
  scope: CoordinationScope
  operationId: string
  idempotencyKey: string
  nowMs: number
  leaseDurationMs: number
}>

export type CoordinationClaimResult =
  | Readonly<{
    kind: 'claimed'
    fencingToken: number
    leaseExpiresAtMs: number
    reclaimed: boolean
  }>
  | Readonly<{
    kind: 'duplicate'
    status: 'claimed' | 'succeeded'
    fencingToken: number
  }>
  | Readonly<{
    kind: 'busy'
    leaseExpiresAtMs: number
  }>
  | Readonly<{
    kind: 'conflict'
  }>

export type CoordinationCompletionRequest = Readonly<{
  scope: CoordinationScope
  operationId: string
  idempotencyKey: string
  fencingToken: number
  nowMs: number
}>

export type CoordinationCompletionResult =
  | Readonly<{
    kind: 'completed'
  }>
  | Readonly<{
    kind: 'duplicate'
  }>
  | Readonly<{
    kind: 'expired'
  }>
  | Readonly<{
    kind: 'stale'
  }>
  | Readonly<{
    kind: 'not_found'
  }>

export interface CoordinationPort {
  claim(request: CoordinationClaimRequest): Promise<CoordinationClaimResult>
  complete(request: CoordinationCompletionRequest): Promise<CoordinationCompletionResult>
}
