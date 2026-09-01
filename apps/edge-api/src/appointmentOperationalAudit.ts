import type { CompatRuntimeBindings } from './compatApiRuntime.js'

type AuditInput = {
  tenantId: string
  moduleId: string
  appointmentId: string
  eventType: 'appointment.completed' | 'appointment.reopened' | 'appointment.package_consumed' | 'appointment.package_released' | 'appointment.responsible_assigned'
  transitionVersion: number
  title: string
  description?: string
  metadata?: Record<string, unknown>
}

function auditFingerprint(input: AuditInput): string {
  return [
    'appointment-audit',
    input.tenantId,
    input.moduleId,
    input.appointmentId,
    input.eventType,
    `v${Math.max(0, Math.trunc(input.transitionVersion || 0))}`,
  ].join(':')
}

export async function appendAppointmentOperationalAudit(
  env: CompatRuntimeBindings,
  input: AuditInput,
): Promise<boolean> {
  if (!env.DB) return false
  try {
    const id = crypto.randomUUID()
    const metadata = {
      event_type: input.eventType,
      appointment_id: input.appointmentId,
      transition_version: Math.max(0, Math.trunc(input.transitionVersion || 0)),
      ...(input.metadata || {}),
    }
    await env.DB.prepare(`
      INSERT OR IGNORE INTO system_update_logs(
        id,tenant_id,module_id,category,status,source,title,description,
        metadata,fingerprint,created_by,created_at
      ) VALUES(?1,?2,?3,'agenda','info','appointment-command',?4,?5,?6,?7,NULL,?8)
    `).bind(
      id,
      input.tenantId,
      input.moduleId,
      input.title,
      input.description || null,
      JSON.stringify(metadata),
      auditFingerprint(input),
      new Date().toISOString(),
    ).run()
    return true
  } catch (error) {
    console.warn('appointment.audit.write_failed', {
      appointment_id: input.appointmentId,
      event_type: input.eventType,
      error_name: error instanceof Error ? error.name : 'Error',
    })
    return false
  }
}
