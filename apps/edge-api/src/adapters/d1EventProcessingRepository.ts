import { parseDomainEventEnvelopeV1 } from '../../../../shared/contracts/v1/index'
import type {
  EventProcessingClaimRequest,
  EventProcessingClaimResult,
  EventProcessingFailureRequest,
  EventProcessingRepositoryPort,
  EventProcessingStatus,
  EventProcessingTransitionRequest,
} from '../../../../server/application/ports/messaging'

const MAX_LEASE_DURATION_MS = 15 * 60 * 1_000

const CLAIM_EVENT_SQL = `
INSERT INTO _yuisync_event_processing (
  tenant_id,
  idempotency_key,
  event_id,
  event_name,
  event_version,
  status,
  attempt_count,
  claim_token,
  lease_expires_at_ms,
  last_error_code,
  created_at_ms,
  updated_at_ms,
  completed_at_ms
) VALUES (?, ?, ?, ?, ?, 'processing', 1, ?, ?, NULL, ?, ?, NULL)
ON CONFLICT(tenant_id, idempotency_key) DO UPDATE SET
  status = 'processing',
  attempt_count = _yuisync_event_processing.attempt_count + 1,
  claim_token = excluded.claim_token,
  lease_expires_at_ms = excluded.lease_expires_at_ms,
  last_error_code = NULL,
  updated_at_ms = excluded.updated_at_ms,
  completed_at_ms = NULL
WHERE _yuisync_event_processing.event_id = excluded.event_id
  AND _yuisync_event_processing.event_name = excluded.event_name
  AND _yuisync_event_processing.event_version = excluded.event_version
  AND (
    _yuisync_event_processing.status = 'failed'
    OR (
      _yuisync_event_processing.status = 'processing'
      AND _yuisync_event_processing.lease_expires_at_ms <= excluded.updated_at_ms
    )
  )
RETURNING attempt_count, lease_expires_at_ms;
`

const FIND_EVENT_SQL = `
SELECT event_id, event_name, event_version, status, attempt_count
FROM _yuisync_event_processing
WHERE tenant_id = ? AND idempotency_key = ?;
`

const MARK_SUCCEEDED_SQL = `
UPDATE _yuisync_event_processing
SET
  status = 'succeeded',
  lease_expires_at_ms = ?,
  last_error_code = NULL,
  updated_at_ms = ?,
  completed_at_ms = ?
WHERE tenant_id = ?
  AND idempotency_key = ?
  AND status = 'processing'
  AND claim_token = ?
RETURNING idempotency_key;
`

const MARK_FAILED_SQL = `
UPDATE _yuisync_event_processing
SET
  status = 'failed',
  lease_expires_at_ms = ?,
  last_error_code = ?,
  updated_at_ms = ?,
  completed_at_ms = NULL
WHERE tenant_id = ?
  AND idempotency_key = ?
  AND status = 'processing'
  AND claim_token = ?
RETURNING idempotency_key;
`

type ClaimedRow = Readonly<{
  attempt_count: number
  lease_expires_at_ms: number
}>

type ExistingRow = Readonly<{
  event_id: string
  event_name: string
  event_version: number
  status: EventProcessingStatus
  attempt_count: number
}>

export type EventProcessingRepositoryErrorCode =
  | 'DATABASE_NOT_CONFIGURED'
  | 'DATABASE_UNAVAILABLE'
  | 'IDEMPOTENCY_CONFLICT'
  | 'INVALID_ARGUMENT'

export class EventProcessingRepositoryError extends Error {
  readonly code: EventProcessingRepositoryErrorCode

  constructor(code: EventProcessingRepositoryErrorCode) {
    super('Asynchronous event processing state could not be persisted.')
    this.name = 'EventProcessingRepositoryError'
    this.code = code
  }
}

function assertIdentifier(value: string): void {
  if (!value.trim() || value.length > 160) {
    throw new EventProcessingRepositoryError('INVALID_ARGUMENT')
  }
}

function assertTimestamp(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new EventProcessingRepositoryError('INVALID_ARGUMENT')
  }
}

function normalizeErrorCode(value: string): string {
  const normalized = value.trim().toUpperCase()
  return /^[A-Z][A-Z0-9_]{0,79}$/.test(normalized)
    ? normalized
    : 'PROCESSING_FAILED'
}

export class D1EventProcessingRepository implements EventProcessingRepositoryPort {
  private readonly database?: D1Database

  constructor(database?: D1Database) {
    this.database = database
  }

  async claim(request: EventProcessingClaimRequest): Promise<EventProcessingClaimResult> {
    const database = this.requireDatabase()
    const event = parseDomainEventEnvelopeV1(request.event)
    assertIdentifier(request.claimToken)
    assertTimestamp(request.nowMs)

    if (
      !Number.isSafeInteger(request.leaseDurationMs)
      || request.leaseDurationMs <= 0
      || request.leaseDurationMs > MAX_LEASE_DURATION_MS
    ) {
      throw new EventProcessingRepositoryError('INVALID_ARGUMENT')
    }

    const leaseExpiresAtMs = request.nowMs + request.leaseDurationMs
    if (!Number.isSafeInteger(leaseExpiresAtMs)) {
      throw new EventProcessingRepositoryError('INVALID_ARGUMENT')
    }

    try {
      const claimed = await database
        .prepare(CLAIM_EVENT_SQL)
        .bind(
          event.tenant_id,
          event.idempotency_key,
          event.event_id,
          event.event_name,
          event.event_version,
          request.claimToken,
          leaseExpiresAtMs,
          request.nowMs,
          request.nowMs,
        )
        .first<ClaimedRow>()

      if (claimed) {
        return {
          kind: 'claimed',
          attemptCount: claimed.attempt_count,
          leaseExpiresAtMs: claimed.lease_expires_at_ms,
        }
      }

      const existing = await database
        .prepare(FIND_EVENT_SQL)
        .bind(event.tenant_id, event.idempotency_key)
        .first<ExistingRow>()

      if (!existing) {
        throw new EventProcessingRepositoryError('DATABASE_UNAVAILABLE')
      }

      if (
        existing.event_id !== event.event_id
        || existing.event_name !== event.event_name
        || existing.event_version !== event.event_version
      ) {
        throw new EventProcessingRepositoryError('IDEMPOTENCY_CONFLICT')
      }

      if (existing.status !== 'processing' && existing.status !== 'succeeded') {
        throw new EventProcessingRepositoryError('DATABASE_UNAVAILABLE')
      }

      return {
        kind: 'duplicate',
        status: existing.status,
        attemptCount: existing.attempt_count,
      }
    } catch (error) {
      if (error instanceof EventProcessingRepositoryError) {
        throw error
      }
      throw new EventProcessingRepositoryError('DATABASE_UNAVAILABLE')
    }
  }

  async markSucceeded(request: EventProcessingTransitionRequest): Promise<boolean> {
    this.validateTransition(request)
    const database = this.requireDatabase()

    try {
      const row = await database
        .prepare(MARK_SUCCEEDED_SQL)
        .bind(
          request.nowMs,
          request.nowMs,
          request.nowMs,
          request.tenantId,
          request.idempotencyKey,
          request.claimToken,
        )
        .first<{ idempotency_key: string }>()

      return Boolean(row)
    } catch {
      throw new EventProcessingRepositoryError('DATABASE_UNAVAILABLE')
    }
  }

  async markFailed(request: EventProcessingFailureRequest): Promise<boolean> {
    this.validateTransition(request)
    const database = this.requireDatabase()

    try {
      const row = await database
        .prepare(MARK_FAILED_SQL)
        .bind(
          request.nowMs,
          normalizeErrorCode(request.errorCode),
          request.nowMs,
          request.tenantId,
          request.idempotencyKey,
          request.claimToken,
        )
        .first<{ idempotency_key: string }>()

      return Boolean(row)
    } catch {
      throw new EventProcessingRepositoryError('DATABASE_UNAVAILABLE')
    }
  }

  private requireDatabase(): D1Database {
    if (!this.database) {
      throw new EventProcessingRepositoryError('DATABASE_NOT_CONFIGURED')
    }
    return this.database
  }

  private validateTransition(request: EventProcessingTransitionRequest): void {
    assertIdentifier(request.tenantId)
    assertIdentifier(request.idempotencyKey)
    assertIdentifier(request.claimToken)
    assertTimestamp(request.nowMs)
  }
}
