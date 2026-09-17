type ExtensionRow = { data_json: string }

type SchedulePolicy = Readonly<{
  capacity: number
  leadTimeMinutes: number
  slotIntervalMinutes: number
}>

const integer = (value: unknown, fallback: number, minimum: number, maximum: number) => {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : fallback
}

async function loadPolicy(database: D1Database, tenantId: string, moduleId: string): Promise<SchedulePolicy> {
  const row = await database.prepare(`
    SELECT data_json FROM module_settings_extensions
    WHERE tenant_id=?1 AND module_id=?2 LIMIT 1
  `).bind(tenantId, moduleId).first<ExtensionRow>()
  let settings: Record<string, unknown> = {}
  try {
    const parsed = JSON.parse(row?.data_json || '{}')
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) settings = parsed as Record<string, unknown>
  } catch { /* malformed settings fall back to conservative defaults */ }
  return {
    capacity: integer(settings.petbot_booking_capacity, 1, 1, 50),
    leadTimeMinutes: integer(settings.petbot_booking_lead_time_min, 0, 0, 10_080),
    slotIntervalMinutes: integer(settings.petbot_slot_interval_min, 30, 5, 240),
  }
}

export async function validateScheduleAvailability(input: {
  database: D1Database
  tenantId: string
  moduleId: string
  scheduledAtMs: number
  durationMinutes: number
  ignoreAppointmentId?: string
  nowMs?: number
}): Promise<{ ok: true; policy: SchedulePolicy } | { ok: false; code: 'SCHEDULE_IN_PAST' | 'BOOKING_LEAD_TIME_REQUIRED' | 'SLOT_UNAVAILABLE' }> {
  const now = input.nowMs ?? Date.now()
  if (!Number.isFinite(input.scheduledAtMs) || input.scheduledAtMs <= now) return { ok: false, code: 'SCHEDULE_IN_PAST' }
  const policy = await loadPolicy(input.database, input.tenantId, input.moduleId)
  if (input.scheduledAtMs < now + policy.leadTimeMinutes * 60_000) return { ok: false, code: 'BOOKING_LEAD_TIME_REQUIRED' }
  const endsAt = input.scheduledAtMs + Math.max(15, input.durationMinutes) * 60_000
  const overlap = await input.database.prepare(`
    SELECT COUNT(*) AS count FROM appointments
    WHERE tenant_id=?1 AND module_id=?2
      AND status IN ('scheduled','confirmed','in_progress','blocked')
      AND scheduled_at_ms < ?4 AND (scheduled_at_ms + duration_min*60000) > ?3
      AND (?5='' OR id<>?5)
  `).bind(input.tenantId, input.moduleId, input.scheduledAtMs, endsAt, input.ignoreAppointmentId || '')
    .first<{ count: number }>()
  if (Number(overlap?.count || 0) >= policy.capacity) return { ok: false, code: 'SLOT_UNAVAILABLE' }
  return { ok: true, policy }
}
