// Native-domain statement, deliberately outside the agent runtime. Insert in
// the same D1 batch as the pending sale and its lines. The DB guard closes the
// race between the earlier availability read and the commercial write.
export function reservePendingOrderStock(db: D1Database, input: {
  tenantId: string; moduleId: string; saleId: string; productId: string;
  quantityMilliunits: number; unitPriceCents: number; now: number
}): D1PreparedStatement {
  return db.prepare(`INSERT INTO pending_order_stock_reservations(tenant_id,module_id,sale_id,product_id,quantity_milliunits,unit_price_cents,created_at_ms)
    VALUES(?1,?2,?3,?4,?5,?6,?7)`)
    .bind(input.tenantId,input.moduleId,input.saleId,input.productId,input.quantityMilliunits,input.unitPriceCents,input.now)
}
