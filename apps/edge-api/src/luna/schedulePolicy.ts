import { isWithinBusinessHours, normalizeBusinessHours, type BusinessHours } from '../businessHours'
type ExtensionRow = { data_json: string }

type SchedulePolicy = Readonly<{
  settingsJSON: string
  capacity: number
  tosaLoad: number
  leadTimeMinutes: number
  slotIntervalMinutes: number
  businessHours: BusinessHours | null
  timezone: string | null
}>

const integer = (value: unknown, fallback: number, minimum: number, maximum: number) => {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : fallback
}

// Stores configured through the settings screen only have the store's opening
// hours and the module timezone; the booking-specific keys are optional overrides.
export async function withStoreScheduleDefaults(database: D1Database, tenantId: string, moduleId: string, settings: Record<string, unknown>) {
  const filled = { ...settings }
  if (!normalizeBusinessHours(filled.petbot_business_hours) && normalizeBusinessHours(filled.store_business_hours)) filled.petbot_business_hours = filled.store_business_hours
  if (typeof filled.petbot_timezone !== 'string' || !filled.petbot_timezone.trim()) {
    const row = await database.prepare(`SELECT timezone FROM module_operational_settings WHERE tenant_id=?1 AND module_id=?2 LIMIT 1`).bind(tenantId, moduleId).first<{ timezone: string | null }>()
    if (row?.timezone) filled.petbot_timezone = row.timezone
  }
  return filled
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
  settings = await withStoreScheduleDefaults(database, tenantId, moduleId, settings)
  let timezone = typeof settings.petbot_timezone === 'string' ? settings.petbot_timezone : null
  try { if (timezone) new Intl.DateTimeFormat('pt-BR', { timeZone: timezone }) } catch { timezone = null }
  return {
    settingsJSON: row?.data_json ?? '{}',
    capacity: integer(settings.petbot_booking_capacity, 1, 1, 50),
    tosaLoad: integer(settings.petbot_tosa_load, 1, 1, 50),
    leadTimeMinutes: integer(settings.petbot_booking_lead_time_min, 0, 0, 10_080),
    slotIntervalMinutes: integer(settings.petbot_slot_interval_min, 30, 5, 240),
    businessHours: normalizeBusinessHours(settings.petbot_business_hours),
    timezone,
  }
}

// A tosa takes more of the team than a bath: it fills `tosaLoad` of the
// simultaneous places ("4 banhos, ou 1 tosa + 1 banho"). Hygienic trims count as baths.
export const isTosaService = (name: unknown) => { const n = String(name ?? '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase(); return /\btosa\b/.test(n) && !/higien/.test(n) }
export type BookedLoad = { start: number; end: number; tosa: boolean }
export async function bookedLoads(database: D1Database, tenantId: string, moduleId: string, startMs: number, endMs: number, ignoreAppointmentId = '') {
  const rows = await database.prepare(`
    SELECT a.id,a.scheduled_at_ms,a.duration_min,group_concat(s.service_name,'|') names FROM appointments a
    LEFT JOIN appointment_services s ON s.tenant_id=a.tenant_id AND s.module_id=a.module_id AND s.appointment_id=a.id
    WHERE a.tenant_id=?1 AND a.module_id=?2 AND a.status IN ('scheduled','confirmed','in_progress','blocked')
      AND a.scheduled_at_ms>=?3-86400000 AND a.scheduled_at_ms<?4 AND a.scheduled_at_ms+a.duration_min*60000>?3 AND (?5='' OR a.id<>?5)
    GROUP BY a.id ORDER BY a.scheduled_at_ms,a.id LIMIT 501
  `).bind(tenantId, moduleId, startMs, endMs, ignoreAppointmentId).all<{ scheduled_at_ms: number; duration_min: number; names: string | null }>()
  return rows.results.map(row => ({ start: row.scheduled_at_ms, end: row.scheduled_at_ms + row.duration_min * 60_000, tosa: String(row.names ?? '').split('|').some(isTosaService) }))
}
export function slotFits(booked: readonly BookedLoad[], startMs: number, endMs: number, tosa: boolean, policy: Pick<SchedulePolicy, 'capacity' | 'tosaLoad'>) {
  const load = (t: boolean) => t ? policy.tosaLoad : 1
  const overlapping = booked.filter(b => b.start < endMs && b.end > startMs)
  return overlapping.length < policy.capacity && overlapping.reduce((sum, b) => sum + load(b.tosa), 0) + load(tosa) <= policy.capacity
}

export async function validateScheduleAvailability(input: {
  database: D1Database
  tenantId: string
  moduleId: string
  scheduledAtMs: number
  durationMinutes: number
  ignoreAppointmentId?: string
  nowMs?: number
  // Service names of the booking; a reschedule reads them from the appointment.
  serviceNames?: readonly unknown[]
}): Promise<{ ok: true; policy: SchedulePolicy } | { ok: false; code: 'SCHEDULE_IN_PAST' | 'BOOKING_LEAD_TIME_REQUIRED' | 'SLOT_UNAVAILABLE' | 'SCHEDULE_CONFIGURATION_UNAVAILABLE' | 'OUTSIDE_BUSINESS_HOURS' | 'SERVICE_DURATION_UNAVAILABLE' }> {
  const now = input.nowMs ?? Date.now()
  if (!Number.isFinite(input.scheduledAtMs) || input.scheduledAtMs <= now) return { ok: false, code: 'SCHEDULE_IN_PAST' }
  const policy = await loadSchedulePolicy(input.database, input.tenantId, input.moduleId)
  if (!policy.businessHours || !policy.timezone) return { ok: false, code: 'SCHEDULE_CONFIGURATION_UNAVAILABLE' }
  if (!Number.isSafeInteger(input.durationMinutes) || input.durationMinutes <= 0 || input.durationMinutes > 1440) return { ok: false, code: 'SERVICE_DURATION_UNAVAILABLE' }
  if (!isWithinBusinessHours(policy.businessHours, policy.timezone, input.scheduledAtMs, input.durationMinutes)) return { ok: false, code: 'OUTSIDE_BUSINESS_HOURS' }
  if (input.scheduledAtMs < now + policy.leadTimeMinutes * 60_000) return { ok: false, code: 'BOOKING_LEAD_TIME_REQUIRED' }
  const endsAt = input.scheduledAtMs + Math.max(15, input.durationMinutes) * 60_000
  let names = input.serviceNames
  if (!names && input.ignoreAppointmentId) names = (await input.database.prepare(`SELECT service_name FROM appointment_services WHERE tenant_id=?1 AND module_id=?2 AND appointment_id=?3`).bind(input.tenantId, input.moduleId, input.ignoreAppointmentId).all<{ service_name: string }>()).results.map(r => r.service_name)
  const booked = await bookedLoads(input.database, input.tenantId, input.moduleId, input.scheduledAtMs, endsAt, input.ignoreAppointmentId || '')
  if (!slotFits(booked, input.scheduledAtMs, endsAt, (names ?? []).some(isTosaService), policy)) return { ok: false, code: 'SLOT_UNAVAILABLE' }
  return { ok: true, policy }
}
