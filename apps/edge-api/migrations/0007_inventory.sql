CREATE TABLE IF NOT EXISTS inventory_balances (
  tenant_id TEXT NOT NULL,
  module_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  on_hand_milliunits INTEGER NOT NULL DEFAULT 0,
  reserved_milliunits INTEGER NOT NULL DEFAULT 0,
  reorder_milliunits INTEGER NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 1,
  updated_at_ms INTEGER NOT NULL,
  PRIMARY KEY (tenant_id, module_id, product_id),
  FOREIGN KEY (tenant_id, module_id, product_id)
    REFERENCES catalog_products(tenant_id, module_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CHECK (on_hand_milliunits >= 0),
  CHECK (reserved_milliunits >= 0 AND reserved_milliunits <= on_hand_milliunits),
  CHECK (reorder_milliunits >= 0),
  CHECK (version >= 1)
) STRICT;

CREATE TABLE IF NOT EXISTS inventory_movements (
  tenant_id TEXT NOT NULL,
  module_id TEXT NOT NULL,
  id TEXT NOT NULL,
  operation_key TEXT NOT NULL,
  product_id TEXT NOT NULL,
  movement_type TEXT NOT NULL,
  delta_milliunits INTEGER NOT NULL,
  stock_before_milliunits INTEGER NOT NULL,
  stock_after_milliunits INTEGER NOT NULL,
  unit_cost_cents INTEGER,
  reference_type TEXT,
  reference_id TEXT,
  reason TEXT,
  created_at_ms INTEGER NOT NULL,
  PRIMARY KEY (tenant_id, module_id, id),
  FOREIGN KEY (tenant_id, module_id, product_id)
    REFERENCES catalog_products(tenant_id, module_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CHECK (length(trim(operation_key)) BETWEEN 1 AND 200),
  CHECK (movement_type IN ('sale','purchase','adjustment','return','reservation','release')),
  CHECK (delta_milliunits <> 0),
  CHECK (stock_before_milliunits >= 0 AND stock_after_milliunits >= 0),
  CHECK (stock_before_milliunits + delta_milliunits = stock_after_milliunits),
  CHECK (unit_cost_cents IS NULL OR unit_cost_cents >= 0)
) STRICT;

CREATE UNIQUE INDEX IF NOT EXISTS inventory_movements_scope_operation_unique
  ON inventory_movements (tenant_id, module_id, operation_key);
CREATE INDEX IF NOT EXISTS inventory_movements_product_created_idx
  ON inventory_movements (tenant_id, module_id, product_id, created_at_ms, id);

UPDATE _yuisync_system_metadata SET value='7', updated_at=CURRENT_TIMESTAMP WHERE key='schema_version';