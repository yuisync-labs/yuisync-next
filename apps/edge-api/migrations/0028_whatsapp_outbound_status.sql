CREATE TABLE IF NOT EXISTS whatsapp_outbound_messages (
  tenant_id TEXT NOT NULL,
  module_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  internal_message_id TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  phone_number_id TEXT NOT NULL,
  recipient TEXT NOT NULL,
  actor_type TEXT NOT NULL CHECK (actor_type IN ('assistant','human','system')),
  provider_message_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('queued','submitted','sent','delivered','read','failed')),
  error_code TEXT,
  claim_token TEXT NOT NULL,
  last_provider_status_at_ms INTEGER,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  PRIMARY KEY (tenant_id,module_id,idempotency_key),
  FOREIGN KEY (tenant_id,module_id,internal_message_id)
    REFERENCES chat_messages(tenant_id,module_id,id) ON UPDATE RESTRICT ON DELETE CASCADE,
  FOREIGN KEY (tenant_id,module_id,thread_id)
    REFERENCES chat_threads(tenant_id,module_id,id) ON UPDATE RESTRICT ON DELETE CASCADE,
  FOREIGN KEY (phone_number_id)
    REFERENCES whatsapp_phone_connections(phone_number_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CHECK (length(trim(module_id)) BETWEEN 1 AND 64),
  CHECK (module_id = lower(module_id)),
  CHECK (length(trim(idempotency_key)) BETWEEN 1 AND 160),
  CHECK (length(trim(internal_message_id)) BETWEEN 1 AND 160),
  CHECK (length(trim(thread_id)) BETWEEN 1 AND 160),
  CHECK (length(trim(phone_number_id)) BETWEEN 1 AND 160),
  CHECK (length(trim(recipient)) BETWEEN 8 AND 20),
  CHECK (provider_message_id IS NULL OR length(trim(provider_message_id)) BETWEEN 1 AND 160),
  CHECK (error_code IS NULL OR length(trim(error_code)) BETWEEN 1 AND 160),
  CHECK (length(trim(claim_token)) BETWEEN 1 AND 160)
) STRICT;

CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_outbound_internal_message_unique
  ON whatsapp_outbound_messages (tenant_id,module_id,internal_message_id);

CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_outbound_provider_message_unique
  ON whatsapp_outbound_messages (tenant_id,module_id,provider_message_id)
  WHERE provider_message_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS whatsapp_outbound_phone_status_idx
  ON whatsapp_outbound_messages (tenant_id,phone_number_id,status,updated_at_ms);

CREATE TABLE IF NOT EXISTS whatsapp_delivery_receipts (
  tenant_id TEXT NOT NULL,
  module_id TEXT NOT NULL,
  provider_message_id TEXT NOT NULL,
  phone_number_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('sent','delivered','read','failed')),
  provider_timestamp_ms INTEGER NOT NULL,
  error_code TEXT,
  received_at_ms INTEGER NOT NULL,
  PRIMARY KEY (tenant_id,module_id,provider_message_id,status,provider_timestamp_ms),
  FOREIGN KEY (tenant_id,module_id,provider_message_id)
    REFERENCES whatsapp_outbound_messages(tenant_id,module_id,provider_message_id) ON UPDATE RESTRICT ON DELETE CASCADE,
  CHECK (length(trim(provider_message_id)) BETWEEN 1 AND 160),
  CHECK (length(trim(phone_number_id)) BETWEEN 1 AND 160),
  CHECK (error_code IS NULL OR length(trim(error_code)) BETWEEN 1 AND 160)
) STRICT;

CREATE INDEX IF NOT EXISTS whatsapp_delivery_receipts_message_idx
  ON whatsapp_delivery_receipts (tenant_id,module_id,provider_message_id,provider_timestamp_ms,status);

UPDATE _yuisync_system_metadata
SET value = '28', updated_at = CURRENT_TIMESTAMP
WHERE key = 'schema_version';
