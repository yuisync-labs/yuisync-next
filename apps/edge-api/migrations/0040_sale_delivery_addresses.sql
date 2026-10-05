CREATE TABLE sale_delivery_addresses (
  tenant_id TEXT NOT NULL, module_id TEXT NOT NULL, sale_id TEXT NOT NULL,
  street TEXT NOT NULL CHECK(length(trim(street)) BETWEEN 1 AND 200),
  number TEXT NOT NULL CHECK(length(trim(number)) BETWEEN 1 AND 40),
  city TEXT NOT NULL CHECK(length(trim(city)) BETWEEN 1 AND 160),
  neighborhood TEXT NOT NULL CHECK(length(trim(neighborhood)) BETWEEN 1 AND 160),
  reference TEXT, complement TEXT, postal_code TEXT,
  fee_cents INTEGER NOT NULL CHECK(fee_cents>=0), coverage_snapshot_json TEXT NOT NULL CHECK(json_valid(coverage_snapshot_json)), created_at_ms INTEGER NOT NULL,
  PRIMARY KEY(tenant_id,module_id,sale_id),
  FOREIGN KEY(tenant_id,module_id,sale_id) REFERENCES sales(tenant_id,module_id,id) ON DELETE CASCADE
) STRICT;

-- Recheck coverage and price inside the same batch that creates the sale.
CREATE TRIGGER sale_delivery_address_quote_guard BEFORE INSERT ON sale_delivery_addresses
BEGIN
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM module_settings_extensions e, json_each(e.data_json,'$.delivery_coverage') area
    WHERE e.tenant_id=NEW.tenant_id AND e.module_id=NEW.module_id
      AND json(json_extract(e.data_json,'$.delivery_coverage'))=json(NEW.coverage_snapshot_json)
      AND json_extract(area.value,'$.active')=1
      AND json_extract(area.value,'$.city')=NEW.city
      AND json_extract(area.value,'$.neighborhood')=NEW.neighborhood
      AND json_extract(area.value,'$.fee_cents')=NEW.fee_cents
    GROUP BY e.tenant_id,e.module_id HAVING COUNT(*)=1
  ) THEN RAISE(ABORT,'DELIVERY_QUOTE_CHANGED') END;
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM sales s WHERE s.tenant_id=NEW.tenant_id AND s.module_id=NEW.module_id AND s.id=NEW.sale_id
      AND s.fulfillment_type='delivery' AND s.status='pending' AND s.transport_fee_cents=NEW.fee_cents
  ) THEN RAISE(ABORT,'DELIVERY_SALE_MISMATCH') END;
END;
