CREATE TABLE IF NOT EXISTS catalog_products (
  tenant_id TEXT NOT NULL,
  module_id TEXT NOT NULL,
  id TEXT NOT NULL,
  name TEXT NOT NULL,
  barcode TEXT,
  category TEXT,
  description TEXT,
  price_cents INTEGER NOT NULL DEFAULT 0,
  cost_cents INTEGER NOT NULL DEFAULT 0,
  species_target TEXT,
  upsell_product_id TEXT,
  image_url TEXT,
  bot_metadata_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'active',
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  PRIMARY KEY (tenant_id, module_id, id),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, module_id, upsell_product_id)
    REFERENCES catalog_products(tenant_id, module_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CHECK (length(trim(module_id)) BETWEEN 1 AND 64 AND module_id = lower(module_id)),
  CHECK (length(trim(id)) BETWEEN 1 AND 160),
  CHECK (length(trim(name)) BETWEEN 1 AND 300),
  CHECK (barcode IS NULL OR length(barcode) <= 64),
  CHECK (price_cents >= 0 AND cost_cents >= 0),
  CHECK (json_valid(bot_metadata_json)),
  CHECK (status IN ('active','inactive'))
) STRICT;

CREATE UNIQUE INDEX IF NOT EXISTS catalog_products_scope_barcode_unique
  ON catalog_products (tenant_id, module_id, barcode) WHERE barcode IS NOT NULL AND barcode <> '';
CREATE INDEX IF NOT EXISTS catalog_products_scope_status_name_idx
  ON catalog_products (tenant_id, module_id, status, name, id);

CREATE TABLE IF NOT EXISTS services (
  tenant_id TEXT NOT NULL,
  module_id TEXT NOT NULL,
  id TEXT NOT NULL,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  category TEXT,
  description TEXT,
  group_type TEXT NOT NULL,
  default_price_cents INTEGER NOT NULL DEFAULT 0,
  default_duration_min INTEGER NOT NULL DEFAULT 60,
  commission_type TEXT NOT NULL DEFAULT 'percentage',
  commission_basis_points INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 999,
  icon TEXT,
  source_product_id TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  PRIMARY KEY (tenant_id, module_id, id),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, module_id, source_product_id)
    REFERENCES catalog_products(tenant_id, module_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CHECK (length(trim(code)) BETWEEN 1 AND 160),
  CHECK (length(trim(name)) BETWEEN 1 AND 300),
  CHECK (group_type IN ('banho_tosa','veterinaria','motoboy','outro')),
  CHECK (default_price_cents >= 0),
  CHECK (default_duration_min BETWEEN 15 AND 1440),
  CHECK (commission_type = 'percentage'),
  CHECK (commission_basis_points BETWEEN 0 AND 10000),
  CHECK (status IN ('active','inactive'))
) STRICT;

CREATE UNIQUE INDEX IF NOT EXISTS services_scope_code_unique
  ON services (tenant_id, module_id, code);
CREATE UNIQUE INDEX IF NOT EXISTS services_scope_source_product_unique
  ON services (tenant_id, module_id, source_product_id) WHERE source_product_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS services_scope_group_status_idx
  ON services (tenant_id, module_id, group_type, status, sort_order, id);

UPDATE _yuisync_system_metadata SET value = '6', updated_at = CURRENT_TIMESTAMP WHERE key = 'schema_version';