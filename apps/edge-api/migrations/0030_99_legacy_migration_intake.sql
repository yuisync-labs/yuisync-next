-- Migration intake landing zone. This remains schema version 30 and is intentionally
-- additive: it stages legacy snapshots before canonical domain import.
-- Secrets never belong in migration_source_records; they are stored only as
-- AES-GCM ciphertext in migration_secret_vault by the operator-side migration CLI.

CREATE TABLE IF NOT EXISTS migration_runs (
  id TEXT PRIMARY KEY NOT NULL,
  source_system TEXT NOT NULL,
  source_ref TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  module_id TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'bulk' CHECK (mode IN ('bulk','delta')),
  status TEXT NOT NULL DEFAULT 'prepared'
    CHECK (status IN ('prepared','running','staged','verified','failed','aborted')),
  source_snapshot_at_ms INTEGER NOT NULL,
  source_schema_fingerprint TEXT NOT NULL,
  parent_run_id TEXT,
  details_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(details_json)),
  started_at_ms INTEGER,
  completed_at_ms INTEGER,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  CHECK (length(trim(id)) BETWEEN 1 AND 160),
  CHECK (length(trim(source_system)) BETWEEN 1 AND 64),
  CHECK (length(trim(source_ref)) BETWEEN 1 AND 320),
  CHECK (length(trim(tenant_id)) BETWEEN 1 AND 160),
  CHECK (length(trim(module_id)) BETWEEN 1 AND 64),
  CHECK (module_id = lower(module_id)),
  CHECK (length(source_schema_fingerprint) = 64),
  FOREIGN KEY (parent_run_id) REFERENCES migration_runs(id) ON UPDATE RESTRICT ON DELETE RESTRICT
) STRICT;

CREATE INDEX IF NOT EXISTS migration_runs_scope_created_idx
  ON migration_runs (tenant_id,module_id,created_at_ms DESC,id);
CREATE INDEX IF NOT EXISTS migration_runs_status_idx
  ON migration_runs (status,updated_at_ms DESC,id);

CREATE TABLE IF NOT EXISTS migration_source_records (
  run_id TEXT NOT NULL,
  source_table TEXT NOT NULL,
  source_key TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  module_id TEXT,
  disposition TEXT NOT NULL
    CHECK (disposition IN ('canonical','archive','identity','secret_bridge','recompute')),
  data_class TEXT NOT NULL
    CHECK (data_class IN ('operational','pii','configuration','technical','identity')),
  destination_hint TEXT,
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  payload_checksum TEXT NOT NULL,
  secret_names_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(secret_names_json)),
  source_created_at_ms INTEGER,
  source_updated_at_ms INTEGER,
  staged_at_ms INTEGER NOT NULL,
  PRIMARY KEY (run_id,source_table,source_key),
  FOREIGN KEY (run_id) REFERENCES migration_runs(id) ON UPDATE RESTRICT ON DELETE CASCADE,
  CHECK (length(trim(source_table)) BETWEEN 1 AND 128),
  CHECK (length(trim(source_key)) BETWEEN 1 AND 1024),
  CHECK (length(trim(tenant_id)) BETWEEN 1 AND 160),
  CHECK (module_id IS NULL OR length(trim(module_id)) BETWEEN 1 AND 64),
  CHECK (module_id IS NULL OR module_id = lower(module_id)),
  CHECK (length(payload_checksum) = 64)
) STRICT;

CREATE INDEX IF NOT EXISTS migration_source_records_table_idx
  ON migration_source_records (run_id,source_table,source_key);
CREATE INDEX IF NOT EXISTS migration_source_records_scope_idx
  ON migration_source_records (tenant_id,module_id,disposition,source_table);

CREATE TABLE IF NOT EXISTS migration_secret_vault (
  run_id TEXT NOT NULL,
  source_table TEXT NOT NULL,
  source_key TEXT NOT NULL,
  secret_path TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  destination_hint TEXT,
  ciphertext_b64 TEXT NOT NULL,
  iv_b64 TEXT NOT NULL,
  auth_tag_b64 TEXT NOT NULL,
  secret_fingerprint TEXT NOT NULL,
  key_version INTEGER NOT NULL DEFAULT 1 CHECK (key_version >= 1),
  status TEXT NOT NULL DEFAULT 'sealed'
    CHECK (status IN ('sealed','consumed','rotated','discarded')),
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  PRIMARY KEY (run_id,source_table,source_key,secret_path),
  FOREIGN KEY (run_id) REFERENCES migration_runs(id) ON UPDATE RESTRICT ON DELETE CASCADE,
  CHECK (length(trim(secret_path)) BETWEEN 1 AND 1024),
  CHECK (length(ciphertext_b64) BETWEEN 4 AND 131072),
  CHECK (length(iv_b64) BETWEEN 12 AND 128),
  CHECK (length(auth_tag_b64) BETWEEN 12 AND 128),
  CHECK (length(secret_fingerprint) = 64)
) STRICT;

CREATE INDEX IF NOT EXISTS migration_secret_vault_status_idx
  ON migration_secret_vault (run_id,status,source_table,source_key);

CREATE TABLE IF NOT EXISTS migration_table_checkpoints (
  run_id TEXT NOT NULL,
  source_table TEXT NOT NULL,
  source_row_count INTEGER NOT NULL DEFAULT 0 CHECK (source_row_count >= 0),
  staged_row_count INTEGER NOT NULL DEFAULT 0 CHECK (staged_row_count >= 0),
  source_checksum TEXT,
  staged_checksum TEXT,
  cursor_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(cursor_json)),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','staged','verified','failed','ignored')),
  updated_at_ms INTEGER NOT NULL,
  PRIMARY KEY (run_id,source_table),
  FOREIGN KEY (run_id) REFERENCES migration_runs(id) ON UPDATE RESTRICT ON DELETE CASCADE,
  CHECK (source_checksum IS NULL OR length(source_checksum) = 64),
  CHECK (staged_checksum IS NULL OR length(staged_checksum) = 64)
) STRICT;

CREATE TABLE IF NOT EXISTS migration_reconciliation (
  run_id TEXT NOT NULL,
  metric_key TEXT NOT NULL,
  source_value_json TEXT NOT NULL CHECK (json_valid(source_value_json)),
  destination_value_json TEXT NOT NULL CHECK (json_valid(destination_value_json)),
  status TEXT NOT NULL CHECK (status IN ('match','mismatch','warning','not_applicable')),
  details_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(details_json)),
  checked_at_ms INTEGER NOT NULL,
  PRIMARY KEY (run_id,metric_key),
  FOREIGN KEY (run_id) REFERENCES migration_runs(id) ON UPDATE RESTRICT ON DELETE CASCADE,
  CHECK (length(trim(metric_key)) BETWEEN 1 AND 256)
) STRICT;

CREATE INDEX IF NOT EXISTS migration_reconciliation_status_idx
  ON migration_reconciliation (run_id,status,metric_key);

UPDATE _yuisync_system_metadata
SET value='30', updated_at=CURRENT_TIMESTAMP
WHERE key='schema_version';
