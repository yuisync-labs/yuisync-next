CREATE TABLE IF NOT EXISTS sales (
  tenant_id TEXT NOT NULL, module_id TEXT NOT NULL, id TEXT NOT NULL,
  operation_key TEXT NOT NULL, client_id TEXT, appointment_id TEXT,
  source TEXT NOT NULL, fulfillment_type TEXT NOT NULL,
  subtotal_cents INTEGER NOT NULL, discount_cents INTEGER NOT NULL DEFAULT 0,
  transport_fee_cents INTEGER NOT NULL DEFAULT 0, total_cents INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', notes TEXT, created_at_ms INTEGER NOT NULL, updated_at_ms INTEGER NOT NULL,
  PRIMARY KEY (tenant_id,module_id,id),
  FOREIGN KEY (tenant_id,module_id,client_id) REFERENCES clients(tenant_id,module_id,id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id,module_id,appointment_id) REFERENCES appointments(tenant_id,module_id,id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CHECK (length(trim(operation_key)) BETWEEN 1 AND 200),
  CHECK (source IN ('manual','pos','whatsapp','import')),
  CHECK (fulfillment_type IN ('counter','delivery','service')),
  CHECK (subtotal_cents >= 0 AND discount_cents >= 0 AND transport_fee_cents >= 0 AND total_cents >= 0),
  CHECK (total_cents = subtotal_cents - discount_cents + transport_fee_cents),
  CHECK (status IN ('pending','confirmed','completed','cancelled','refunded'))
) STRICT;
CREATE UNIQUE INDEX IF NOT EXISTS sales_scope_operation_unique ON sales(tenant_id,module_id,operation_key);

CREATE TABLE IF NOT EXISTS sale_items (
  tenant_id TEXT NOT NULL, module_id TEXT NOT NULL, sale_id TEXT NOT NULL, position INTEGER NOT NULL,
  item_type TEXT NOT NULL, product_id TEXT, service_id TEXT,
  item_name TEXT NOT NULL, quantity_milliunits INTEGER NOT NULL, unit_price_cents INTEGER NOT NULL,
  subtotal_cents INTEGER NOT NULL, upsell INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id,module_id,sale_id,position),
  FOREIGN KEY (tenant_id,module_id,sale_id) REFERENCES sales(tenant_id,module_id,id) ON UPDATE RESTRICT ON DELETE CASCADE,
  FOREIGN KEY (tenant_id,module_id,product_id) REFERENCES catalog_products(tenant_id,module_id,id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id,module_id,service_id) REFERENCES services(tenant_id,module_id,id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CHECK (item_type IN ('product','service')),
  CHECK ((item_type='product' AND product_id IS NOT NULL AND service_id IS NULL) OR (item_type='service' AND service_id IS NOT NULL AND product_id IS NULL)),
  CHECK (quantity_milliunits > 0), CHECK (unit_price_cents >= 0 AND subtotal_cents >= 0), CHECK (upsell IN (0,1))
) STRICT;

UPDATE _yuisync_system_metadata SET value='11', updated_at=CURRENT_TIMESTAMP WHERE key='schema_version';