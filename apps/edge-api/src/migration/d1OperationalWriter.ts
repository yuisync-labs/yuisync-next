const PROJECTION = 'phase8-operational/v1'
const MAX_BATCH_STATEMENTS = 40

type Row = Record<string, unknown>
type TableSpec = Readonly<{ columns: readonly string[]; key: readonly string[] }>

const TABLES: Readonly<Record<string, TableSpec>> = Object.freeze({
  catalog_products:{ columns:['tenant_id','module_id','id','name','barcode','category','description','price_cents','cost_cents','species_target','upsell_product_id','image_url','bot_metadata_json','status','created_at_ms','updated_at_ms'], key:['tenant_id','module_id','id'] },
  services:{ columns:['tenant_id','module_id','id','code','name','category','description','group_type','default_price_cents','default_duration_min','commission_type','commission_basis_points','sort_order','icon','source_product_id','status','created_at_ms','updated_at_ms'], key:['tenant_id','module_id','id'] },
  inventory_balances:{ columns:['tenant_id','module_id','product_id','on_hand_milliunits','reserved_milliunits','reorder_milliunits','version','updated_at_ms'], key:['tenant_id','module_id','product_id'] },
  inventory_movements:{ columns:['tenant_id','module_id','id','operation_key','product_id','movement_type','delta_milliunits','stock_before_milliunits','stock_after_milliunits','unit_cost_cents','reference_type','reference_id','reason','created_at_ms'], key:['tenant_id','module_id','id'] },
  module_operational_settings:{ columns:['tenant_id','module_id','timezone','booking_horizon_days','booking_lead_time_min','default_service_duration_min','max_services_per_appointment','autonomy_mode','version','updated_at_ms'], key:['tenant_id','module_id'] },
  booking_hours:{ columns:['tenant_id','module_id','weekday','open_minute','close_minute','active'], key:['tenant_id','module_id','weekday'] },
  payment_method_settings:{ columns:['tenant_id','module_id','method','enabled','sort_order'], key:['tenant_id','module_id','method'] },
  appointments:{ columns:['tenant_id','module_id','id','operation_key','client_id','pet_id','scheduled_at_ms','duration_min','service_group','status','source','subtotal_cents','transport_fee_cents','notes','version','created_at_ms','updated_at_ms'], key:['tenant_id','module_id','id'] },
  appointment_services:{ columns:['tenant_id','module_id','appointment_id','position','service_id','service_code','service_name','service_group','unit_price_cents','duration_min','benefit_used'], key:['tenant_id','module_id','appointment_id','position'] },
  transport_options:{ columns:['tenant_id','module_id','id','label','fee_cents','max_weight_grams','pickup_required','dropoff_required','outside_city','status','sort_order'], key:['tenant_id','module_id','id'] },
  appointment_transport:{ columns:['tenant_id','module_id','appointment_id','option_id','fee_cents','pickup_address','dropoff_address','pickup_reference','dropoff_reference','contact_phone','status','notes','updated_at_ms'], key:['tenant_id','module_id','appointment_id'] },
  sales:{ columns:['tenant_id','module_id','id','operation_key','client_id','appointment_id','source','fulfillment_type','subtotal_cents','discount_cents','transport_fee_cents','total_cents','status','notes','created_at_ms','updated_at_ms'], key:['tenant_id','module_id','id'] },
  sale_items:{ columns:['tenant_id','module_id','sale_id','position','item_type','product_id','service_id','item_name','quantity_milliunits','unit_price_cents','subtotal_cents','upsell'], key:['tenant_id','module_id','sale_id','position'] },
  payments:{ columns:['tenant_id','module_id','id','sale_id','operation_key','method','amount_cents','status','provider','provider_reference','received_at_ms','created_at_ms','updated_at_ms'], key:['tenant_id','module_id','id'] },
  payment_splits:{ columns:['tenant_id','module_id','payment_id','position','recipient_type','recipient_id','amount_cents','status','provider_reference','updated_at_ms'], key:['tenant_id','module_id','payment_id','position'] },
  chat_threads:{ columns:['tenant_id','module_id','id','channel','external_thread_id','client_id','pet_id','status','last_message_at_ms','created_at_ms','updated_at_ms'], key:['tenant_id','module_id','id'] },
  chat_messages:{ columns:['tenant_id','module_id','id','thread_id','external_message_id','direction','actor_type','content_text','content_json','created_at_ms'], key:['tenant_id','module_id','id'] },
  fiscal_documents:{ columns:['tenant_id','module_id','id','sale_id','operation_key','document_type','status','issuer_reference','access_key','request_hash','authorized_at_ms','cancelled_at_ms','created_at_ms','updated_at_ms'], key:['tenant_id','module_id','id'] },
})

export type OperationalWriterErrorCode = 'INVALID_SNAPSHOT'|'DESTINATION_DIVERGED'|'DATABASE_UNAVAILABLE'|'WRITE_FAILED'
export class OperationalWriterError extends Error {
  readonly code: OperationalWriterErrorCode
  constructor(code: OperationalWriterErrorCode) { super('Operational migration could not be applied.'); this.name='OperationalWriterError'; this.code=code }
}

function object(value: unknown): Row {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new OperationalWriterError('INVALID_SNAPSHOT')
  return value as Row
}
function scalar(value: unknown): string|number|null {
  if (value === null || typeof value === 'string' || typeof value === 'number') return value
  throw new OperationalWriterError('INVALID_SNAPSHOT')
}
function keyOf(row: Row, spec: TableSpec): string { return JSON.stringify(spec.key.map((name) => scalar(row[name]))) }
function sameRow(left: Row, right: Row, spec: TableSpec): boolean {
  return spec.columns.every((column) => scalar(left[column]) === scalar(right[column]))
}
function validateRow(raw: unknown, spec: TableSpec, tenantId: string, moduleId: string): Row {
  const row=object(raw); const keys=Object.keys(row).sort(); const expected=[...spec.columns].sort()
  if (JSON.stringify(keys)!==JSON.stringify(expected)) throw new OperationalWriterError('INVALID_SNAPSHOT')
  if (row.tenant_id!==tenantId || row.module_id!==moduleId) throw new OperationalWriterError('INVALID_SNAPSHOT')
  for (const column of spec.columns) scalar(row[column])
  return row
}

function validateSnapshot(snapshot: unknown) {
  const root=object(snapshot); if (root.projection!==PROJECTION) throw new OperationalWriterError('INVALID_SNAPSHOT')
  const scope=object(root.scope); const tenantId=String(scope.tenant_id||'').trim(); const moduleId=String(scope.module_id||'').trim().toLowerCase()
  if (!tenantId || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(moduleId)) throw new OperationalWriterError('INVALID_SNAPSHOT')
  const collections=object(root.collections); const projected:Record<string,Row[]>={}
  for (const [table,spec] of Object.entries(TABLES)) {
    const raw=collections[table]; if (!Array.isArray(raw)) throw new OperationalWriterError('INVALID_SNAPSHOT')
    projected[table]=raw.map((row)=>validateRow(row,spec,tenantId,moduleId))
    const seen=new Set<string>(); for (const row of projected[table]) { const key=keyOf(row,spec); if (seen.has(key)) throw new OperationalWriterError('INVALID_SNAPSHOT'); seen.add(key) }
  }
  return { tenantId,moduleId,collections:projected }
}

async function preflight(database:D1Database, tenantId:string, moduleId:string, collections:Record<string,Row[]>) {
  const missing:Record<string,Row[]>={}
  for (const [table,spec] of Object.entries(TABLES)) {
    let destination:D1Result<Row>
    try { destination=await database.prepare(`SELECT ${spec.columns.join(',')} FROM ${table} WHERE tenant_id=?1 AND module_id=?2`).bind(tenantId,moduleId).all<Row>() }
    catch { throw new OperationalWriterError('DATABASE_UNAVAILABLE') }
    const sourceByKey=new Map(collections[table].map((row)=>[keyOf(row,spec),row]))
    const destByKey=new Map(destination.results.map((row)=>[keyOf(row,spec),row]))
    for (const [key,dest] of destByKey) { const source=sourceByKey.get(key); if (!source || !sameRow(source,dest,spec)) throw new OperationalWriterError('DESTINATION_DIVERGED') }
    missing[table]=collections[table].filter((row)=>!destByKey.has(keyOf(row,spec)))
  }
  return missing
}

function insertStatement(database:D1Database, table:string, spec:TableSpec, row:Row):D1PreparedStatement {
  const placeholders=spec.columns.map((_,index)=>`?${index+1}`).join(',')
  return database.prepare(`INSERT INTO ${table}(${spec.columns.join(',')}) VALUES(${placeholders})`)
    .bind(...spec.columns.map((column)=>scalar(row[column])))
}

export async function applyOperationalSnapshotToD1({ database, snapshot }:{ database?:D1Database; snapshot:unknown }) {
  if (!database) throw new OperationalWriterError('DATABASE_UNAVAILABLE')
  const validated=validateSnapshot(snapshot)
  const missing=await preflight(database,validated.tenantId,validated.moduleId,validated.collections)
  let inserted=0; let batches=0
  for (const [table,spec] of Object.entries(TABLES)) {
    const statements=missing[table].map((row)=>insertStatement(database,table,spec,row))
    for (let offset=0; offset<statements.length; offset+=MAX_BATCH_STATEMENTS) {
      try { await database.batch(statements.slice(offset,offset+MAX_BATCH_STATEMENTS)) }
      catch { throw new OperationalWriterError('WRITE_FAILED') }
      inserted+=Math.min(MAX_BATCH_STATEMENTS,statements.length-offset); batches+=1
    }
  }
  return Object.freeze({ status:'applied', tenantId:validated.tenantId, moduleId:validated.moduleId, insertedRows:inserted, batchCount:batches,
    rowCounts:Object.fromEntries(Object.entries(validated.collections).map(([name,rows])=>[name,rows.length])) })
}

export { TABLES as OPERATIONAL_TABLE_SPECS }
