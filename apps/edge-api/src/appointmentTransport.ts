type Scope = { tenantId: string; moduleId: string; appointmentId: string }
type Guard = { nextVersion: number; marker: number }
type TransportRow = {
  option_id: string; fee_cents: number; pickup_address: string | null; dropoff_address: string | null
  pickup_reference: string | null; dropoff_reference: string | null; contact_phone: string | null
  status: string; notes: string | null
}
const text = (value: unknown) => String(value ?? '').trim() || null

export function transportDetails(notes: unknown): Record<string, unknown> {
  try {
    const value = JSON.parse(String(notes || '{}'))
    return value?.__yuisync_transport || {}
  } catch { return {} }
}

// Statements join the appointment's existing transaction; no partial transport save.
export async function appointmentTransportStatements(
  db: D1Database, scope: Scope, payload: Record<string, unknown>, currentStatus?: string, guard?: Guard,
): Promise<D1PreparedStatement[]> {
  if (!Object.prototype.hasOwnProperty.call(payload, 'transport_mode')) return []
  const mode = text(payload.transport_mode) || 'cliente_leva'
  const old = await db.prepare(`SELECT option_id,fee_cents,pickup_address,dropoff_address,pickup_reference,
    dropoff_reference,contact_phone,status,notes FROM appointment_transport
    WHERE tenant_id=?1 AND module_id=?2 AND appointment_id=?3 LIMIT 1`)
    .bind(scope.tenantId, scope.moduleId, scope.appointmentId).first<TransportRow>()
  const option = mode === 'cliente_leva' ? null : await db.prepare(`SELECT fee_cents,status FROM transport_options
    WHERE tenant_id=?1 AND module_id=?2 AND id=?3 LIMIT 1`)
    .bind(scope.tenantId, scope.moduleId, mode).first<{ fee_cents: number; status: string }>()
  if (mode !== 'cliente_leva' && (!option || (option.status !== 'active' && old?.option_id !== mode))) {
    throw new Error('TRANSPORT_OPTION_NOT_AVAILABLE')
  }
  const fee = mode === 'cliente_leva' ? 0 : old?.option_id === mode ? old.fee_cents : option!.fee_cents
  if (['completed', 'concluido'].includes(currentStatus || '') && mode !== (old?.option_id || 'cliente_leva')) {
    throw new Error('APPOINTMENT_REOPEN_REQUIRED')
  }
  const bindings = [scope.tenantId, scope.moduleId, scope.appointmentId, guard?.nextVersion ?? null, guard?.marker ?? null]
  const condition = `EXISTS(SELECT 1 FROM appointments a WHERE a.tenant_id=?1 AND a.module_id=?2 AND a.id=?3
    AND (?4 IS NULL OR (a.version=?4 AND a.updated_at_ms=?5)))`
  const statements = [db.prepare(`UPDATE appointments SET transport_fee_cents=?6
    WHERE tenant_id=?1 AND module_id=?2 AND id=?3 AND ${condition}`).bind(...bindings, fee)]
  if (mode === 'cliente_leva') {
    statements.push(db.prepare(`DELETE FROM appointment_transport WHERE tenant_id=?1 AND module_id=?2 AND appointment_id=?3 AND ${condition}`).bind(...bindings))
    return statements
  }
  let metadata: Record<string, unknown> = {}
  try { metadata = JSON.parse(old?.notes || '{}'); if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) metadata = { text: old?.notes } } catch { metadata = { text: old?.notes } }
  const details = transportDetails(old?.notes)
  metadata.__yuisync_transport = {
    neighborhood: text(payload.transport_neighborhood ?? details.neighborhood),
    city: text(payload.transport_city ?? details.city),
  }
  const address = text(payload.transport_address ?? old?.pickup_address ?? old?.dropoff_address)
  const reference = text(payload.transport_reference ?? old?.pickup_reference ?? old?.dropoff_reference)
  statements.push(db.prepare(`INSERT INTO appointment_transport(tenant_id,module_id,appointment_id,option_id,fee_cents,
    pickup_address,dropoff_address,pickup_reference,dropoff_reference,contact_phone,status,notes,updated_at_ms)
    SELECT ?1,?2,?3,?6,?7,?8,?8,?9,?9,?10,?11,?12,?13 WHERE ${condition}
    ON CONFLICT(tenant_id,module_id,appointment_id) DO UPDATE SET option_id=excluded.option_id,fee_cents=excluded.fee_cents,
      pickup_address=excluded.pickup_address,dropoff_address=excluded.dropoff_address,pickup_reference=excluded.pickup_reference,
      dropoff_reference=excluded.dropoff_reference,contact_phone=excluded.contact_phone,status=excluded.status,notes=excluded.notes,updated_at_ms=excluded.updated_at_ms`)
    .bind(...bindings, mode, fee, address, reference, text(payload.contact_phone ?? old?.contact_phone), old?.option_id === mode ? old.status : 'pending', JSON.stringify(metadata), Date.now()))
  return statements
}

export function transportCommandError(error: unknown): Response | null {
  const code = error instanceof Error ? error.message : ''
  return ['TRANSPORT_OPTION_NOT_AVAILABLE', 'APPOINTMENT_REOPEN_REQUIRED'].includes(code)
    ? Response.json({ code }, { status: 409, headers: { 'cache-control': 'no-store' } }) : null
}
