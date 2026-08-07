CREATE TABLE IF NOT EXISTS fiscal_documents (
  tenant_id TEXT NOT NULL, module_id TEXT NOT NULL, id TEXT NOT NULL, sale_id TEXT NOT NULL,
  operation_key TEXT NOT NULL, document_type TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
  issuer_reference TEXT, access_key TEXT, request_hash TEXT NOT NULL,
  authorized_at_ms INTEGER, cancelled_at_ms INTEGER, created_at_ms INTEGER NOT NULL, updated_at_ms INTEGER NOT NULL,
  PRIMARY KEY (tenant_id,module_id,id),
  FOREIGN KEY (tenant_id,module_id,sale_id) REFERENCES sales(tenant_id,module_id,id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CHECK (document_type IN ('nfe','nfce','nfse')), CHECK (status IN ('pending','queued','processing','authorized','rejected','cancelled','failed')),
  CHECK (length(request_hash)=64)
) STRICT;
CREATE UNIQUE INDEX IF NOT EXISTS fiscal_documents_operation_unique ON fiscal_documents(tenant_id,module_id,operation_key);
CREATE UNIQUE INDEX IF NOT EXISTS fiscal_documents_access_key_unique ON fiscal_documents(tenant_id,module_id,access_key) WHERE access_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS effect_outbox (
  tenant_id TEXT NOT NULL, module_id TEXT NOT NULL, id TEXT NOT NULL, operation_key TEXT NOT NULL,
  aggregate_type TEXT NOT NULL, aggregate_id TEXT NOT NULL, event_type TEXT NOT NULL,
  payload_json TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', attempt_count INTEGER NOT NULL DEFAULT 0,
  available_at_ms INTEGER NOT NULL, created_at_ms INTEGER NOT NULL, updated_at_ms INTEGER NOT NULL,
  PRIMARY KEY (tenant_id,module_id,id),
  CHECK (json_valid(payload_json)), CHECK (status IN ('pending','queued','processing','completed','failed','dead_letter')),
  CHECK (attempt_count >= 0)
) STRICT;
CREATE UNIQUE INDEX IF NOT EXISTS effect_outbox_operation_event_unique ON effect_outbox(tenant_id,module_id,operation_key,event_type);
CREATE INDEX IF NOT EXISTS effect_outbox_dispatch_idx ON effect_outbox(status,available_at_ms,id);

UPDATE _yuisync_system_metadata SET value='15', updated_at=CURRENT_TIMESTAMP WHERE key='schema_version';