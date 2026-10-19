export type DeliverySnapshot = {
  street: string; number: string; city: string; neighborhood: string;
  reference: string|null; complement: string|null; postal_code: string|null;
  fee_cents: number; coverage_snapshot_json: string
}
export function saleDeliveryAddressStatement(db:D1Database,input:{tenantId:string;moduleId:string;saleId:string;address:DeliverySnapshot;now:number}):D1PreparedStatement {
  const {address:a}=input
  return db.prepare(`INSERT INTO sale_delivery_addresses(tenant_id,module_id,sale_id,street,number,city,neighborhood,reference,complement,postal_code,fee_cents,coverage_snapshot_json,created_at_ms)
    VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13)`)
    .bind(input.tenantId,input.moduleId,input.saleId,a.street,a.number,a.city,a.neighborhood,a.reference,a.complement,a.postal_code,a.fee_cents,a.coverage_snapshot_json,input.now)
}
