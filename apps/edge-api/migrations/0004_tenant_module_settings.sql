CREATE TABLE IF NOT EXISTS tenant_module_settings (
  tenant_id TEXT NOT NULL,
  module_id TEXT NOT NULL,
  store_name TEXT NOT NULL DEFAULT '',
  store_phone TEXT NOT NULL DEFAULT '',
  store_address TEXT NOT NULL DEFAULT '',
  store_neighborhood TEXT NOT NULL DEFAULT '',
  store_city TEXT NOT NULL DEFAULT '',
  bot_prompt TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  PRIMARY KEY (tenant_id, module_id),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CHECK (length(trim(module_id)) BETWEEN 1 AND 64),
  CHECK (module_id = lower(module_id)),
  CHECK (version >= 1),
  CHECK (length(store_name) <= 160),
  CHECK (length(store_phone) <= 80),
  CHECK (length(store_address) <= 240),
  CHECK (length(store_neighborhood) <= 120),
  CHECK (length(store_city) <= 120),
  CHECK (length(bot_prompt) <= 12000)
) STRICT;

CREATE INDEX IF NOT EXISTS tenant_module_settings_module_idx
  ON tenant_module_settings (module_id, tenant_id);

UPDATE _yuisync_system_metadata
SET value = '4', updated_at = CURRENT_TIMESTAMP
WHERE key = 'schema_version';
