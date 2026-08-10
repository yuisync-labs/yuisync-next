CREATE TABLE IF NOT EXISTS _yuisync_event_processing (
  tenant_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  event_id TEXT NOT NULL,
  event_name TEXT NOT NULL,
  event_version INTEGER NOT NULL CHECK (event_version > 0),
  status TEXT NOT NULL CHECK (status IN ('processing', 'succeeded', 'failed')),
  attempt_count INTEGER NOT NULL DEFAULT 1 CHECK (attempt_count > 0),
  claim_token TEXT NOT NULL,
  lease_expires_at_ms INTEGER NOT NULL CHECK (lease_expires_at_ms >= 0),
  last_error_code TEXT,
  created_at_ms INTEGER NOT NULL CHECK (created_at_ms >= 0),
  updated_at_ms INTEGER NOT NULL CHECK (updated_at_ms >= 0),
  completed_at_ms INTEGER CHECK (completed_at_ms IS NULL OR completed_at_ms >= 0),
  PRIMARY KEY (tenant_id, idempotency_key),
  UNIQUE (event_id)
) STRICT;

CREATE INDEX IF NOT EXISTS idx_yuisync_event_processing_status_lease
  ON _yuisync_event_processing (status, lease_expires_at_ms);

UPDATE _yuisync_system_metadata
SET value = '2', updated_at = CURRENT_TIMESTAMP
WHERE key = 'schema_version';
