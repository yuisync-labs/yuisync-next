import { DurableObject } from 'cloudflare:workers'

import type {
  CoordinationClaimRequest,
  CoordinationClaimResult,
  CoordinationCompletionRequest,
  CoordinationCompletionResult,
  CoordinationOperationStatus,
  CoordinationScope,
} from '../../../../server/application/ports/coordination'
import {
  claimCoordination,
  completeCoordination,
  type CoordinationHolder,
  type CoordinationOperation,
  type CoordinationState,
} from './coordinationStateMachine'

export type CoordinationDurableObjectErrorCode =
  | 'COORDINATION_SCOPE_MISMATCH'
  | 'COORDINATION_STATE_CORRUPT'

export class CoordinationDurableObjectError extends Error {
  readonly code: CoordinationDurableObjectErrorCode

  constructor(code: CoordinationDurableObjectErrorCode) {
    super(
      code === 'COORDINATION_SCOPE_MISMATCH'
        ? 'Coordination scope mismatch.'
        : 'Coordination state is unavailable.',
    )
    this.name = 'CoordinationDurableObjectError'
    this.code = code
  }
}

type MetadataRow = Readonly<{
  next_fencing_token: number
  tenant_id: string | null
  resource_type: string | null
  resource_id: string | null
}>

type OperationRow = Readonly<{
  operation_id: string
  idempotency_key: string
  status: string
  fencing_token: number
  lease_expires_at_ms: number
  completed_at_ms: number | null
}>

type HolderRow = Readonly<{
  operation_id: string
  idempotency_key: string
  fencing_token: number
  lease_expires_at_ms: number
}>

type PersistedCoordination = Readonly<{
  scope: CoordinationScope | null
  state: CoordinationState
}>

function requireSafeInteger(value: number, minimum: number): number {
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new CoordinationDurableObjectError('COORDINATION_STATE_CORRUPT')
  }
  return value
}

function parseOperationStatus(value: string): CoordinationOperationStatus {
  if (value === 'claimed' || value === 'succeeded' || value === 'expired') {
    return value
  }
  throw new CoordinationDurableObjectError('COORDINATION_STATE_CORRUPT')
}

function sameOperation(
  left: CoordinationOperation | undefined,
  right: CoordinationOperation,
): boolean {
  return Boolean(
    left &&
    left.operationId === right.operationId &&
    left.idempotencyKey === right.idempotencyKey &&
    left.status === right.status &&
    left.fencingToken === right.fencingToken &&
    left.leaseExpiresAtMs === right.leaseExpiresAtMs &&
    left.completedAtMs === right.completedAtMs,
  )
}

export class CoordinationDurableObject extends DurableObject<EdgeEnv> {
  constructor(ctx: DurableObjectState, env: EdgeEnv) {
    super(ctx, env)

    const sql = this.ctx.storage.sql
    sql.exec(`
      CREATE TABLE IF NOT EXISTS coordination_metadata (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        next_fencing_token INTEGER NOT NULL CHECK (next_fencing_token >= 1),
        tenant_id TEXT,
        resource_type TEXT,
        resource_id TEXT,
        CHECK (
          (tenant_id IS NULL AND resource_type IS NULL AND resource_id IS NULL) OR
          (tenant_id IS NOT NULL AND resource_type IS NOT NULL AND resource_id IS NOT NULL)
        )
      )
    `)
    sql.exec(`
      INSERT OR IGNORE INTO coordination_metadata (
        singleton,
        next_fencing_token,
        tenant_id,
        resource_type,
        resource_id
      ) VALUES (1, 1, NULL, NULL, NULL)
    `)
    sql.exec(`
      CREATE TABLE IF NOT EXISTS coordination_operations (
        idempotency_key TEXT PRIMARY KEY,
        operation_id TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('claimed', 'succeeded', 'expired')),
        fencing_token INTEGER NOT NULL CHECK (fencing_token >= 1),
        lease_expires_at_ms INTEGER NOT NULL CHECK (lease_expires_at_ms >= 0),
        completed_at_ms INTEGER
      )
    `)
    sql.exec(`
      CREATE TABLE IF NOT EXISTS coordination_holder (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        operation_id TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        fencing_token INTEGER NOT NULL CHECK (fencing_token >= 1),
        lease_expires_at_ms INTEGER NOT NULL CHECK (lease_expires_at_ms >= 0)
      )
    `)
  }

  async claim(request: CoordinationClaimRequest): Promise<CoordinationClaimResult> {
    return this.ctx.storage.transactionSync(() => {
      const persisted = this.loadPersistedCoordination()
      this.bindOrValidateScope(persisted.scope, request.scope)

      const transition = claimCoordination(persisted.state, request)
      this.persistState(persisted.state, transition.state)
      return transition.result
    })
  }

  async complete(
    request: CoordinationCompletionRequest,
  ): Promise<CoordinationCompletionResult> {
    return this.ctx.storage.transactionSync(() => {
      const persisted = this.loadPersistedCoordination()
      this.bindOrValidateScope(persisted.scope, request.scope)

      const transition = completeCoordination(persisted.state, request)
      this.persistState(persisted.state, transition.state)
      return transition.result
    })
  }

  private loadPersistedCoordination(): PersistedCoordination {
    const metadataRows = this.ctx.storage.sql
      .exec<MetadataRow>(`
        SELECT next_fencing_token, tenant_id, resource_type, resource_id
        FROM coordination_metadata
        WHERE singleton = 1
      `)
      .toArray()

    if (metadataRows.length !== 1) {
      throw new CoordinationDurableObjectError('COORDINATION_STATE_CORRUPT')
    }

    const metadata = metadataRows[0]
    const nextFencingToken = requireSafeInteger(metadata.next_fencing_token, 1)
    const scopeValues = [metadata.tenant_id, metadata.resource_type, metadata.resource_id]
    const nullScopeValues = scopeValues.filter((value) => value === null).length

    if (nullScopeValues !== 0 && nullScopeValues !== scopeValues.length) {
      throw new CoordinationDurableObjectError('COORDINATION_STATE_CORRUPT')
    }

    const scope = nullScopeValues === scopeValues.length
      ? null
      : {
        tenantId: metadata.tenant_id as string,
        resourceType: metadata.resource_type as string,
        resourceId: metadata.resource_id as string,
      }

    const operations = new Map<string, CoordinationOperation>()
    let largestFencingToken = 0

    for (const row of this.ctx.storage.sql
      .exec<OperationRow>(`
        SELECT
          operation_id,
          idempotency_key,
          status,
          fencing_token,
          lease_expires_at_ms,
          completed_at_ms
        FROM coordination_operations
      `)
      .toArray()) {
      const operation: CoordinationOperation = {
        operationId: row.operation_id,
        idempotencyKey: row.idempotency_key,
        status: parseOperationStatus(row.status),
        fencingToken: requireSafeInteger(row.fencing_token, 1),
        leaseExpiresAtMs: requireSafeInteger(row.lease_expires_at_ms, 0),
        completedAtMs: row.completed_at_ms === null
          ? null
          : requireSafeInteger(row.completed_at_ms, 0),
      }
      operations.set(operation.idempotencyKey, operation)
      largestFencingToken = Math.max(largestFencingToken, operation.fencingToken)
    }

    if (nextFencingToken <= largestFencingToken) {
      throw new CoordinationDurableObjectError('COORDINATION_STATE_CORRUPT')
    }

    const holderRows = this.ctx.storage.sql
      .exec<HolderRow>(`
        SELECT operation_id, idempotency_key, fencing_token, lease_expires_at_ms
        FROM coordination_holder
        WHERE singleton = 1
      `)
      .toArray()

    if (holderRows.length > 1) {
      throw new CoordinationDurableObjectError('COORDINATION_STATE_CORRUPT')
    }

    let holder: CoordinationHolder | null = null
    if (holderRows.length === 1) {
      const row = holderRows[0]
      holder = {
        operationId: row.operation_id,
        idempotencyKey: row.idempotency_key,
        fencingToken: requireSafeInteger(row.fencing_token, 1),
        leaseExpiresAtMs: requireSafeInteger(row.lease_expires_at_ms, 0),
      }

      const operation = operations.get(holder.idempotencyKey)
      if (
        !operation ||
        operation.status !== 'claimed' ||
        operation.operationId !== holder.operationId ||
        operation.fencingToken !== holder.fencingToken ||
        operation.leaseExpiresAtMs !== holder.leaseExpiresAtMs
      ) {
        throw new CoordinationDurableObjectError('COORDINATION_STATE_CORRUPT')
      }
    }

    return {
      scope,
      state: {
        nextFencingToken,
        holder,
        operations,
      },
    }
  }

  private bindOrValidateScope(
    persistedScope: CoordinationScope | null,
    requestedScope: CoordinationScope,
  ): void {
    if (!persistedScope) {
      this.ctx.storage.sql.exec(
        `
          UPDATE coordination_metadata
          SET tenant_id = ?, resource_type = ?, resource_id = ?
          WHERE singleton = 1
        `,
        requestedScope.tenantId,
        requestedScope.resourceType,
        requestedScope.resourceId,
      )
      return
    }

    if (
      persistedScope.tenantId !== requestedScope.tenantId ||
      persistedScope.resourceType !== requestedScope.resourceType ||
      persistedScope.resourceId !== requestedScope.resourceId
    ) {
      throw new CoordinationDurableObjectError('COORDINATION_SCOPE_MISMATCH')
    }
  }

  private persistState(previous: CoordinationState, next: CoordinationState): void {
    if (previous.nextFencingToken !== next.nextFencingToken) {
      this.ctx.storage.sql.exec(
        `
          UPDATE coordination_metadata
          SET next_fencing_token = ?
          WHERE singleton = 1
        `,
        next.nextFencingToken,
      )
    }

    this.ctx.storage.sql.exec('DELETE FROM coordination_holder WHERE singleton = 1')
    if (next.holder) {
      this.ctx.storage.sql.exec(
        `
          INSERT INTO coordination_holder (
            singleton,
            operation_id,
            idempotency_key,
            fencing_token,
            lease_expires_at_ms
          ) VALUES (1, ?, ?, ?, ?)
        `,
        next.holder.operationId,
        next.holder.idempotencyKey,
        next.holder.fencingToken,
        next.holder.leaseExpiresAtMs,
      )
    }

    for (const operation of next.operations.values()) {
      if (sameOperation(previous.operations.get(operation.idempotencyKey), operation)) {
        continue
      }

      this.ctx.storage.sql.exec(
        `
          INSERT INTO coordination_operations (
            operation_id,
            idempotency_key,
            status,
            fencing_token,
            lease_expires_at_ms,
            completed_at_ms
          ) VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(idempotency_key) DO UPDATE SET
            operation_id = excluded.operation_id,
            status = excluded.status,
            fencing_token = excluded.fencing_token,
            lease_expires_at_ms = excluded.lease_expires_at_ms,
            completed_at_ms = excluded.completed_at_ms
        `,
        operation.operationId,
        operation.idempotencyKey,
        operation.status,
        operation.fencingToken,
        operation.leaseExpiresAtMs,
        operation.completedAtMs,
      )
    }
  }
}
