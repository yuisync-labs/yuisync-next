CREATE TABLE IF NOT EXISTS operation_checkpoints (
  tenant_id TEXT NOT NULL, module_id TEXT NOT NULL, id TEXT NOT NULL,
  thread_id TEXT, operation_type TEXT NOT NULL, stage TEXT NOT NULL,
  facts_json TEXT NOT NULL DEFAULT '{}', pending_effect_json TEXT,
  confirmations_json TEXT NOT NULL DEFAULT '[]', status TEXT NOT NULL DEFAULT 'running',
  version INTEGER NOT NULL DEFAULT 1, updated_at_ms INTEGER NOT NULL,
  PRIMARY KEY (tenant_id,module_id,id),
  FOREIGN KEY (tenant_id,module_id,thread_id) REFERENCES chat_threads(tenant_id,module_id,id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CHECK (json_valid(facts_json)), CHECK (pending_effect_json IS NULL OR json_valid(pending_effect_json)),
  CHECK (json_valid(confirmations_json)), CHECK (status IN ('running','waiting_confirmation','completed','cancelled','failed')),
  CHECK (version >= 1)
) STRICT;
CREATE INDEX IF NOT EXISTS operation_checkpoints_thread_status_idx ON operation_checkpoints(tenant_id,module_id,thread_id,status,updated_at_ms,id);

CREATE TABLE IF NOT EXISTS operation_effects (
  tenant_id TEXT NOT NULL, module_id TEXT NOT NULL, operation_id TEXT NOT NULL,
  effect_key TEXT NOT NULL, effect_type TEXT NOT NULL, payload_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', result_json TEXT, attempt_count INTEGER NOT NULL DEFAULT 0,
  created_at_ms INTEGER NOT NULL, updated_at_ms INTEGER NOT NULL,
  PRIMARY KEY (tenant_id,module_id,operation_id,effect_key),
  FOREIGN KEY (tenant_id,module_id,operation_id) REFERENCES operation_checkpoints(tenant_id,module_id,id) ON UPDATE RESTRICT ON DELETE CASCADE,
  CHECK (json_valid(payload_json)), CHECK (result_json IS NULL OR json_valid(result_json)),
  CHECK (status IN ('pending','queued','processing','completed','failed','cancelled')), CHECK (attempt_count >= 0)
) STRICT;

UPDATE _yuisync_system_metadata SET value='14', updated_at=CURRENT_TIMESTAMP WHERE key='schema_version';