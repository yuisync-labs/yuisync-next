CREATE TABLE IF NOT EXISTS whatsapp_access_credentials (
  tenant_id TEXT NOT NULL,
  phone_number_id TEXT NOT NULL,
  token_ciphertext TEXT NOT NULL,
  token_iv TEXT NOT NULL,
  key_version INTEGER NOT NULL DEFAULT 1 CHECK (key_version >= 1),
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  PRIMARY KEY (tenant_id, phone_number_id),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON UPDATE RESTRICT ON DELETE CASCADE,
  FOREIGN KEY (phone_number_id) REFERENCES whatsapp_phone_connections(phone_number_id) ON UPDATE RESTRICT ON DELETE CASCADE,
  CHECK (length(trim(tenant_id)) BETWEEN 1 AND 160),
  CHECK (length(trim(phone_number_id)) BETWEEN 1 AND 160),
  CHECK (length(token_ciphertext) BETWEEN 16 AND 65536),
  CHECK (length(token_iv) BETWEEN 16 AND 64)
) STRICT;

CREATE INDEX IF NOT EXISTS whatsapp_access_credentials_phone_idx
  ON whatsapp_access_credentials (phone_number_id, tenant_id);

UPDATE _yuisync_system_metadata
SET value = '27', updated_at = CURRENT_TIMESTAMP
WHERE key = 'schema_version';
