-- Reservations do not debit physical stock or invent payment. Native checkout
-- already excludes reserved_milliunits from availability.
CREATE TABLE pending_order_stock_reservations (
  tenant_id TEXT NOT NULL,
  module_id TEXT NOT NULL,
  sale_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  quantity_milliunits INTEGER NOT NULL CHECK(quantity_milliunits > 0),
  unit_price_cents INTEGER NOT NULL CHECK(unit_price_cents >= 0),
  created_at_ms INTEGER NOT NULL,
  PRIMARY KEY(tenant_id,module_id,sale_id,product_id),
  FOREIGN KEY(tenant_id,module_id,sale_id) REFERENCES sales(tenant_id,module_id,id) ON DELETE CASCADE,
  FOREIGN KEY(tenant_id,module_id,product_id) REFERENCES inventory_balances(tenant_id,module_id,product_id)
) STRICT;

CREATE TRIGGER pending_order_stock_reservation_guard BEFORE INSERT ON pending_order_stock_reservations
BEGIN
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM sales s
    JOIN catalog_products p ON p.tenant_id=s.tenant_id AND p.module_id=s.module_id AND p.id=NEW.product_id
    JOIN inventory_balances i ON i.tenant_id=p.tenant_id AND i.module_id=p.module_id AND i.product_id=p.id
    WHERE s.tenant_id=NEW.tenant_id AND s.module_id=NEW.module_id AND s.id=NEW.sale_id AND s.status='pending'
      AND p.status='active' AND p.price_cents=NEW.unit_price_cents
      AND i.on_hand_milliunits-i.reserved_milliunits >= NEW.quantity_milliunits
  ) THEN RAISE(ABORT,'PENDING_ORDER_STOCK_CHANGED') END;
END;

CREATE TRIGGER pending_order_stock_reservation_apply AFTER INSERT ON pending_order_stock_reservations
BEGIN
  UPDATE inventory_balances SET reserved_milliunits=reserved_milliunits+NEW.quantity_milliunits,
    version=version+1,updated_at_ms=NEW.created_at_ms
    WHERE tenant_id=NEW.tenant_id AND module_id=NEW.module_id AND product_id=NEW.product_id;
END;

CREATE TRIGGER pending_order_stock_reservation_immutable BEFORE UPDATE ON pending_order_stock_reservations
BEGIN
  SELECT RAISE(ABORT,'PENDING_ORDER_RESERVATION_IMMUTABLE');
END;

CREATE TRIGGER pending_order_stock_reservation_release AFTER DELETE ON pending_order_stock_reservations
BEGIN
  UPDATE inventory_balances SET reserved_milliunits=reserved_milliunits-OLD.quantity_milliunits,
    version=version+1
    WHERE tenant_id=OLD.tenant_id AND module_id=OLD.module_id AND product_id=OLD.product_id;
END;

CREATE TRIGGER pending_order_cancel_release AFTER UPDATE OF status ON sales
WHEN NEW.status IN ('cancelled','refunded') AND OLD.status<>NEW.status
BEGIN
  DELETE FROM pending_order_stock_reservations
    WHERE tenant_id=NEW.tenant_id AND module_id=NEW.module_id AND sale_id=NEW.id;
END;
