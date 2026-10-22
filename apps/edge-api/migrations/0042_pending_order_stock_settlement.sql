-- Native sale completion settles reservations atomically. A received payment
-- must already exist; this migration never creates or captures a payment.
CREATE TABLE pending_order_stock_settlements (
  tenant_id TEXT NOT NULL, module_id TEXT NOT NULL, sale_id TEXT NOT NULL,
  completed_at_ms INTEGER NOT NULL,
  PRIMARY KEY(tenant_id,module_id,sale_id),
  FOREIGN KEY(tenant_id,module_id,sale_id) REFERENCES sales(tenant_id,module_id,id)
) STRICT;
CREATE TABLE pending_order_stock_settlement_lines (
  tenant_id TEXT NOT NULL, module_id TEXT NOT NULL, sale_id TEXT NOT NULL,
  product_id TEXT NOT NULL, position INTEGER NOT NULL,
  quantity_milliunits INTEGER NOT NULL CHECK(quantity_milliunits>0),
  PRIMARY KEY(tenant_id,module_id,sale_id,product_id),
  FOREIGN KEY(tenant_id,module_id,sale_id) REFERENCES pending_order_stock_settlements(tenant_id,module_id,sale_id),
  FOREIGN KEY(tenant_id,module_id,product_id) REFERENCES inventory_balances(tenant_id,module_id,product_id)
) STRICT;

CREATE TRIGGER pending_order_completion_guard BEFORE UPDATE OF status ON sales
WHEN NEW.status='completed' AND OLD.status<>'completed'
  AND EXISTS(SELECT 1 FROM pending_order_stock_reservations r
    WHERE r.tenant_id=NEW.tenant_id AND r.module_id=NEW.module_id AND r.sale_id=NEW.id)
BEGIN
  SELECT CASE WHEN COALESCE((SELECT SUM(p.amount_cents) FROM payments p
    WHERE p.tenant_id=NEW.tenant_id AND p.module_id=NEW.module_id AND p.sale_id=NEW.id
      AND p.status='received'),0)<NEW.total_cents
    THEN RAISE(ABORT,'PENDING_ORDER_PAYMENT_NOT_RECEIVED') END;
  SELECT CASE WHEN EXISTS(SELECT 1 FROM pending_order_stock_reservations r
    JOIN inventory_balances b ON b.tenant_id=r.tenant_id AND b.module_id=r.module_id AND b.product_id=r.product_id
    WHERE r.tenant_id=NEW.tenant_id AND r.module_id=NEW.module_id AND r.sale_id=NEW.id
      AND (b.on_hand_milliunits<r.quantity_milliunits OR b.reserved_milliunits<r.quantity_milliunits
        OR r.quantity_milliunits<>COALESCE((SELECT SUM(i.quantity_milliunits) FROM sale_items i
          WHERE i.tenant_id=r.tenant_id AND i.module_id=r.module_id AND i.sale_id=r.sale_id
            AND i.product_id=r.product_id),0)))
    THEN RAISE(ABORT,'PENDING_ORDER_SETTLEMENT_MISMATCH') END;
END;

CREATE TRIGGER pending_order_completion_settle AFTER UPDATE OF status ON sales
WHEN NEW.status='completed' AND OLD.status<>'completed'
  AND EXISTS(SELECT 1 FROM pending_order_stock_reservations r
    WHERE r.tenant_id=NEW.tenant_id AND r.module_id=NEW.module_id AND r.sale_id=NEW.id)
BEGIN
  INSERT INTO pending_order_stock_settlements VALUES(NEW.tenant_id,NEW.module_id,NEW.id,NEW.updated_at_ms);
  INSERT INTO pending_order_stock_settlement_lines
    SELECT r.tenant_id,r.module_id,r.sale_id,r.product_id,
      (SELECT MIN(i.position) FROM sale_items i WHERE i.tenant_id=r.tenant_id
        AND i.module_id=r.module_id AND i.sale_id=r.sale_id AND i.product_id=r.product_id),r.quantity_milliunits
    FROM pending_order_stock_reservations r
    WHERE r.tenant_id=NEW.tenant_id AND r.module_id=NEW.module_id AND r.sale_id=NEW.id;
  INSERT INTO inventory_movements(tenant_id,module_id,id,operation_key,product_id,movement_type,
    delta_milliunits,stock_before_milliunits,stock_after_milliunits,reference_type,reference_id,reason,created_at_ms)
    SELECT l.tenant_id,l.module_id,'pending-settle:'||l.sale_id||':'||l.position,
      'pending-settle:'||l.sale_id||':'||l.position,l.product_id,'sale',-l.quantity_milliunits,
      b.on_hand_milliunits,b.on_hand_milliunits-l.quantity_milliunits,'sale',l.sale_id,
      'Received payment: pending order completion',NEW.updated_at_ms
    FROM pending_order_stock_settlement_lines l
    JOIN inventory_balances b ON b.tenant_id=l.tenant_id AND b.module_id=l.module_id AND b.product_id=l.product_id
    WHERE l.tenant_id=NEW.tenant_id AND l.module_id=NEW.module_id AND l.sale_id=NEW.id;
  -- Release first so the existing reserved<=on_hand invariant remains true.
  DELETE FROM pending_order_stock_reservations
    WHERE tenant_id=NEW.tenant_id AND module_id=NEW.module_id AND sale_id=NEW.id;
  UPDATE inventory_balances SET on_hand_milliunits=on_hand_milliunits-(
    SELECT l.quantity_milliunits FROM pending_order_stock_settlement_lines l
    WHERE l.tenant_id=NEW.tenant_id AND l.module_id=NEW.module_id AND l.sale_id=NEW.id
      AND l.product_id=inventory_balances.product_id),version=version+1,updated_at_ms=NEW.updated_at_ms
    WHERE tenant_id=NEW.tenant_id AND module_id=NEW.module_id AND product_id IN(
      SELECT product_id FROM pending_order_stock_settlement_lines
      WHERE tenant_id=NEW.tenant_id AND module_id=NEW.module_id AND sale_id=NEW.id);
END;

CREATE TRIGGER pending_order_settlement_no_reopen BEFORE UPDATE OF status ON sales
WHEN NEW.status IN ('pending','confirmed') AND EXISTS(
  SELECT 1 FROM pending_order_stock_settlements s
  WHERE s.tenant_id=NEW.tenant_id AND s.module_id=NEW.module_id AND s.sale_id=NEW.id)
BEGIN
  SELECT RAISE(ABORT,'PENDING_ORDER_ALREADY_SETTLED');
END;
