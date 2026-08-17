CREATE TABLE IF NOT EXISTS whatsapp_waba_accounts (
  waba_id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL,
  business_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'connected', 'disabled')),
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CHECK (length(trim(waba_id)) BETWEEN 1 AND 160),
  CHECK (length(trim(tenant_id)) BETWEEN 1 AND 160),
  CHECK (length(trim(business_id)) BETWEEN 1 AND 160),
  UNIQUE (waba_id, tenant_id)
) STRICT;

CREATE INDEX IF NOT EXISTS whatsapp_waba_accounts_tenant_idx
  ON whatsapp_waba_accounts (tenant_id, status, waba_id);

CREATE TABLE IF NOT EXISTS whatsapp_phone_connections (
  phone_number_id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL,
  waba_id TEXT NOT NULL,
  display_phone_number TEXT,
  verified_name TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'connected', 'disabled')),
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY (waba_id, tenant_id) REFERENCES whatsapp_waba_accounts(waba_id, tenant_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CHECK (length(trim(phone_number_id)) BETWEEN 1 AND 160),
  CHECK (display_phone_number IS NULL OR length(trim(display_phone_number)) BETWEEN 1 AND 80),
  CHECK (verified_name IS NULL OR length(trim(verified_name)) BETWEEN 1 AND 200)
) STRICT;

CREATE INDEX IF NOT EXISTS whatsapp_phone_connections_tenant_idx
  ON whatsapp_phone_connections (tenant_id, status, phone_number_id);

CREATE INDEX IF NOT EXISTS whatsapp_phone_connections_waba_idx
  ON whatsapp_phone_connections (waba_id, status, phone_number_id);

CREATE TABLE IF NOT EXISTS whatsapp_ingress_receipts (
  tenant_id TEXT NOT NULL,
  module_id TEXT NOT NULL,
  provider_message_id TEXT NOT NULL,
  waba_id TEXT NOT NULL,
  phone_number_id TEXT NOT NULL,
  claim_token TEXT NOT NULL,
  received_at_ms INTEGER NOT NULL,
  PRIMARY KEY (tenant_id, module_id, provider_message_id),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CHECK (length(trim(module_id)) BETWEEN 1 AND 64),
  CHECK (module_id = lower(module_id)),
  CHECK (length(trim(provider_message_id)) BETWEEN 1 AND 160),
  CHECK (length(trim(waba_id)) BETWEEN 1 AND 160),
  CHECK (length(trim(phone_number_id)) BETWEEN 1 AND 160),
  CHECK (length(trim(claim_token)) BETWEEN 1 AND 160)
) STRICT;

CREATE INDEX IF NOT EXISTS whatsapp_ingress_receipts_phone_idx
  ON whatsapp_ingress_receipts (phone_number_id, received_at_ms, provider_message_id);

UPDATE _yuisync_system_metadata
SET value = '26', updated_at = CURRENT_TIMESTAMP
WHERE key = 'schema_version';
