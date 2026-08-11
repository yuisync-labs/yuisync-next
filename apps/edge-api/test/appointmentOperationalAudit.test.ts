import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'

import { appendAppointmentOperationalAudit } from '../src/appointmentOperationalAudit'

const db = (env as EdgeEnv & { DB: D1Database }).DB

describe('appointment operational audit', () => {
  it('stores lifecycle events in system_update_logs and deduplicates the same transition version', async () => {
    const suffix = crypto.randomUUID()
    const tenantId = `tenant-audit-${suffix}`
    const appointmentId = `appointment-audit-${suffix}`
    const now = Date.now()

    await db.prepare("INSERT INTO tenants(id,slug,name,status,created_at_ms,updated_at_ms) VALUES(?1,?2,'Audit Tenant','active',?3,?3)")
      .bind(tenantId, `audit-${suffix}`, now).run()

    try {
      const input = {
        tenantId,
        moduleId: 'petshop',
        appointmentId,
        eventType: 'appointment.completed' as const,
        transitionVersion: 7,
        title: 'Atendimento concluído',
        metadata: { from_status: 'scheduled', to_status: 'completed' },
      }

      await expect(appendAppointmentOperationalAudit({ DB: db }, input)).resolves.toBe(true)
      await expect(appendAppointmentOperationalAudit({ DB: db }, input)).resolves.toBe(true)
      await expect(appendAppointmentOperationalAudit({ DB: db }, {
        ...input,
        eventType: 'appointment.package_consumed',
        title: 'Benefício de pacote consumido',
      })).resolves.toBe(true)

      const logs = await db.prepare(`
        SELECT category,status,source,title,metadata,fingerprint
        FROM system_update_logs
        WHERE tenant_id=?1 AND module_id='petshop'
        ORDER BY title
      `).bind(tenantId).all<{
        category:string
        status:string
        source:string
        title:string
        metadata:string
        fingerprint:string
      }>()

      expect(logs.results).toHaveLength(2)
      expect(logs.results.every((row) => row.category === 'agenda')).toBe(true)
      expect(logs.results.every((row) => row.status === 'info')).toBe(true)
      expect(logs.results.every((row) => row.source === 'appointment-command')).toBe(true)
      expect(new Set(logs.results.map((row) => row.fingerprint)).size).toBe(2)
      for (const row of logs.results) {
        const metadata = JSON.parse(row.metadata)
        expect(metadata.appointment_id).toBe(appointmentId)
        expect(metadata.transition_version).toBe(7)
      }
    } finally {
      await db.prepare('DELETE FROM system_update_logs WHERE tenant_id=?1').bind(tenantId).run()
      await db.prepare('DELETE FROM tenants WHERE id=?1').bind(tenantId).run()
    }
  })
})
