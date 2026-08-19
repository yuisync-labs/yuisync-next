import { asText, type JsonRecord } from './appointmentBillingPolicy'

const NO_TRANSPORT_MODES = new Set(['cliente_leva', 'dropoff', 'counter', 'none'])

export function billingTransportStatements(
  db: D1Database,
  input: {
    tenantId: string
    moduleId: string
    appointmentId: string
    payload: JsonRecord
    now: number
    allowDelete?: boolean
  },
): D1PreparedStatement[] {
  const mode = asText(input.payload.transport_mode)
  if (!mode) return []

  if (NO_TRANSPORT_MODES.has(mode)) {
    if (!input.allowDelete) return []
    return [
      db.prepare('DELETE FROM appointment_transport WHERE tenant_id=?1 AND module_id=?2 AND appointment_id=?3')
        .bind(input.tenantId, input.moduleId, input.appointmentId),
      db.prepare('UPDATE appointments SET transport_fee_cents=0 WHERE tenant_id=?1 AND module_id=?2 AND id=?3')
        .bind(input.tenantId, input.moduleId, input.appointmentId),
    ]
  }

  const address = asText(input.payload.transport_address) || null
  const reference = asText(input.payload.transport_reference) || null
  const contactPhone = asText(input.payload.transport_contact_phone || input.payload.contact_phone) || null

  return [
    db.prepare(`INSERT INTO appointment_transport(
      tenant_id,module_id,appointment_id,option_id,fee_cents,
      pickup_address,dropoff_address,pickup_reference,dropoff_reference,
      contact_phone,status,notes,updated_at_ms
    ) VALUES(
      ?1,?2,?3,
      (SELECT id FROM transport_options WHERE tenant_id=?1 AND module_id=?2 AND id=?4 AND status='active' LIMIT 1),
      COALESCE((SELECT fee_cents FROM transport_options WHERE tenant_id=?1 AND module_id=?2 AND id=?4 AND status='active' LIMIT 1),0),
      ?5,?5,?6,?6,?7,'pending',NULL,?8
    ) ON CONFLICT(tenant_id,module_id,appointment_id) DO UPDATE SET
      option_id=excluded.option_id,
      fee_cents=excluded.fee_cents,
      pickup_address=excluded.pickup_address,
      dropoff_address=excluded.dropoff_address,
      pickup_reference=excluded.pickup_reference,
      dropoff_reference=excluded.dropoff_reference,
      contact_phone=COALESCE(excluded.contact_phone,appointment_transport.contact_phone),
      updated_at_ms=excluded.updated_at_ms`)
      .bind(input.tenantId, input.moduleId, input.appointmentId, mode, address, reference, contactPhone, input.now),
    db.prepare(`UPDATE appointments
      SET transport_fee_cents=COALESCE((
        SELECT fee_cents FROM transport_options
        WHERE tenant_id=?1 AND module_id=?2 AND id=?4 AND status='active' LIMIT 1
      ),0)
      WHERE tenant_id=?1 AND module_id=?2 AND id=?3`)
      .bind(input.tenantId, input.moduleId, input.appointmentId, mode),
  ]
}
