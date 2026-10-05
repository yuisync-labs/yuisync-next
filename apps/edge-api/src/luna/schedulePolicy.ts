import { isWithinBusinessHours, normalizeBusinessHours, type BusinessHours } from '../businessHours'
type ExtensionRow = { data_json: string }

type SchedulePolicy = Readonly<{
  capacity: number
  leadTimeMinutes: number
  slotIntervalMinutes: number
  businessHours: BusinessHours | null
  timezone: string | null
}>

const integer = (value: unknown, fallback: number, minimum: number, maximum: number) => {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : fallback
}

export async function loadSchedulePolicy(database: D1Database, tenantId: string, moduleId: string): Promise<SchedulePolicy> {
  const row = await database.prepare(`
    SELECT data_json FROM module_settings_extensions
    WHERE tenant_id=?1 AND module_id=?2 LIMIT 1
  `).bind(tenantId, moduleId).first<ExtensionRow>()
  let settings: Record<string, unknown> = {}
  try {
    const parsed = JSON.parse(row?.data_json || '{}')
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) settings = parsed as Record<string, unknown>
  } catch { /* malformed settings fall back to conservative defaults */ }
  let timezone = typeof settings.petbot_timezone === 'string' ? settings.petbot_timezone : null
  try { if (timezone) new Intl.DateTimeFormat('pt-BR', { timeZone: timezone }) } catch { timezone = null }
  return {
    capacity: integer(settings.petbot_booking_capacity, 1, 1, 50),
    leadTimeMinutes: integer(settings.petbot_booking_lead_time_min, 0, 0, 10_080),
    slotIntervalMinutes: integer(settings.petbot_slot_interval_min, 30, 5, 240),
    businessHours: normalizeBusinessHours(settings.petbot_business_hours),
    timezone,
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
}): Promise<{ ok: true; policy: SchedulePolicy } | { ok: false; code: 'SCHEDULE_IN_PAST' | 'BOOKING_LEAD_TIME_REQUIRED' | 'SLOT_UNAVAILABLE' | 'SCHEDULE_CONFIGURATION_UNAVAILABLE' | 'OUTSIDE_BUSINESS_HOURS' | 'SERVICE_DURATION_UNAVAILABLE' }> {
  const now = input.nowMs ?? Date.now()
  if (!Number.isFinite(input.scheduledAtMs) || input.scheduledAtMs <= now) return { ok: false, code: 'SCHEDULE_IN_PAST' }
  const policy = await loadSchedulePolicy(input.database, input.tenantId, input.moduleId)
  if (!policy.businessHours || !policy.timezone) return { ok: false, code: 'SCHEDULE_CONFIGURATION_UNAVAILABLE' }
  if (!Number.isSafeInteger(input.durationMinutes) || input.durationMinutes <= 0 || input.durationMinutes > 1440) return { ok: false, code: 'SERVICE_DURATION_UNAVAILABLE' }
  if (!isWithinBusinessHours(policy.businessHours, policy.timezone, input.scheduledAtMs, input.durationMinutes)) return { ok: false, code: 'OUTSIDE_BUSINESS_HOURS' }
  if (input.scheduledAtMs < now + policy.leadTimeMinutes * 60_000) return { ok: false, code: 'BOOKING_LEAD_TIME_REQUIRED' }
  const endsAt = input.scheduledAtMs + Math.max(15, input.durationMinutes) * 60_000
  const overlap = await input.database.prepare(`
    SELECT COUNT(*) AS count FROM (SELECT id FROM appointments
    WHERE tenant_id=?1 AND module_id=?2
      AND status IN ('scheduled','confirmed','in_progress','blocked')
      AND scheduled_at_ms >= ?3-86400000 AND scheduled_at_ms < ?4 AND (scheduled_at_ms + duration_min*60000) > ?3
      AND (?5='' OR id<>?5) LIMIT ?6)
  `).bind(input.tenantId, input.moduleId, input.scheduledAtMs, endsAt, input.ignoreAppointmentId || '', policy.capacity)
    .first<{ count: number }>()
  if (Number(overlap?.count || 0) >= policy.capacity) return { ok: false, code: 'SLOT_UNAVAILABLE' }
  return { ok: true, policy }
}
