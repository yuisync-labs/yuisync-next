import { env } from 'cloudflare:workers'
import { expect, it } from 'vitest'
import { appointmentTransportStatements } from '../src/appointmentTransport'

it('grava transporte com a reserva atomicamente e respeita a versão no faturamento', async () => {
  const db = (env as EdgeEnv & { DB: D1Database }).DB
  const tenantId = `transport-${crypto.randomUUID()}`, now = Date.now()
  const scope = { tenantId, moduleId: 'petshop', appointmentId: 'appt' }
  await db.batch([
    db.prepare("INSERT INTO tenants(id,slug,name,status,created_at_ms,updated_at_ms) VALUES(?1,?1,'Transport','active',?2,?2)").bind(tenantId, now),
    db.prepare("INSERT INTO clients(tenant_id,module_id,id,name,status,created_at_ms,updated_at_ms) VALUES(?1,'petshop','owner','Tutor','active',?2,?2)").bind(tenantId, now),
    db.prepare("INSERT INTO pets(tenant_id,module_id,id,client_id,name,species,status,created_at_ms,updated_at_ms) VALUES(?1,'petshop','pet','owner','Mel','dog','active',?2,?2)").bind(tenantId, now),
    db.prepare("INSERT INTO transport_options(tenant_id,module_id,id,label,fee_cents,pickup_required,dropoff_required,status) VALUES(?1,'petshop','somente_buscar','Buscar',1500,1,0,'active')").bind(tenantId),
  ])
  const insert = () => db.prepare("INSERT INTO appointments(tenant_id,module_id,id,client_id,pet_id,scheduled_at_ms,duration_min,status,source,subtotal_cents,transport_fee_cents,version,created_at_ms,updated_at_ms) VALUES(?1,'petshop','appt','owner','pet',?2,60,'scheduled','manual',5500,0,1,?2,?2)").bind(tenantId, now)
  const payload = { transport_mode: 'somente_buscar', transport_address: 'Rua A, 10' }
  const transport = () => db.prepare("SELECT option_id,pickup_address FROM appointment_transport WHERE tenant_id=?1 AND module_id='petshop' AND appointment_id='appt'").bind(tenantId).first()
  try {
    const pending = await appointmentTransportStatements(db, scope, payload)
    // Um erro posterior no mesmo lote desfaz também a reserva e o transporte.
    await expect(db.batch([insert(), ...pending, insert()])).rejects.toThrow()
    expect(await transport()).toBeNull()
    await db.batch([insert(), ...await appointmentTransportStatements(db, scope, payload)])
    expect(await transport()).toMatchObject({ option_id: 'somente_buscar', pickup_address: 'Rua A, 10' })
    const stale = await appointmentTransportStatements(db, scope, { ...payload, transport_address: 'Não aplicar' }, 'scheduled', { nextVersion: 2, marker: now + 1 })
    await db.batch(stale)
    expect(await transport()).toMatchObject({ pickup_address: 'Rua A, 10' })
    await db.batch([
      db.prepare("UPDATE appointments SET version=2,updated_at_ms=?2 WHERE tenant_id=?1 AND module_id='petshop' AND id='appt'").bind(tenantId, now + 1),
      ...await appointmentTransportStatements(db, scope, { ...payload, transport_address: 'Rua B, 20' }, 'scheduled', { nextVersion: 2, marker: now + 1 }),
    ])
    expect(await transport()).toMatchObject({ pickup_address: 'Rua B, 20' })
    await expect(appointmentTransportStatements(db, scope, { transport_mode: 'cliente_leva' }, 'completed')).rejects.toThrow('APPOINTMENT_REOPEN_REQUIRED')
  } finally {
    await db.prepare('DELETE FROM appointment_transport WHERE tenant_id=?1').bind(tenantId).run()
    await db.prepare('DELETE FROM appointments WHERE tenant_id=?1').bind(tenantId).run()
    await db.prepare('DELETE FROM transport_options WHERE tenant_id=?1').bind(tenantId).run()
    await db.prepare('DELETE FROM pets WHERE tenant_id=?1').bind(tenantId).run()
    await db.prepare('DELETE FROM clients WHERE tenant_id=?1').bind(tenantId).run()
    await db.prepare('DELETE FROM tenants WHERE id=?1').bind(tenantId).run()
  }
})
