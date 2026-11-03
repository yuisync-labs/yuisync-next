-- A coverage area whose neighborhood is "*" covers every neighborhood of its
-- city (get_delivery_quote already quotes it); the guard accepts it too, unless
-- the neighborhood is also listed by name.
DROP TRIGGER IF EXISTS sale_delivery_address_quote_guard;
CREATE TRIGGER sale_delivery_address_quote_guard BEFORE INSERT ON sale_delivery_addresses
BEGIN
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM module_settings_extensions e, json_each(e.data_json,'$.delivery_coverage') area
    WHERE e.tenant_id=NEW.tenant_id AND e.module_id=NEW.module_id
      AND json(json_extract(e.data_json,'$.delivery_coverage'))=json(NEW.coverage_snapshot_json)
      AND json_extract(area.value,'$.active')=1
      AND json_extract(area.value,'$.city')=NEW.city
      AND json_extract(area.value,'$.fee_cents')=NEW.fee_cents
      AND (json_extract(area.value,'$.neighborhood')=NEW.neighborhood
        OR json_extract(area.value,'$.neighborhood')='*' AND NOT EXISTS(
          SELECT 1 FROM json_each(e.data_json,'$.delivery_coverage') named
          WHERE json_extract(named.value,'$.active')=1 AND json_extract(named.value,'$.city')=NEW.city
            AND json_extract(named.value,'$.neighborhood')=NEW.neighborhood))
    GROUP BY e.tenant_id,e.module_id HAVING COUNT(*)=1
  ) THEN RAISE(ABORT,'DELIVERY_QUOTE_CHANGED') END;
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM sales s WHERE s.tenant_id=NEW.tenant_id AND s.module_id=NEW.module_id AND s.id=NEW.sale_id
      AND s.fulfillment_type='delivery' AND s.status='pending' AND s.transport_fee_cents=NEW.fee_cents
  ) THEN RAISE(ABORT,'DELIVERY_SALE_MISMATCH') END;
END;
