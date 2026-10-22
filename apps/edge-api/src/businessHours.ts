export type BusinessHours = Record<string, Array<{ open: string; close: string }>>
const TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/

// Shared with assisted provisioning. Missing/malformed hours never become
// assumed opening hours. Existing persisted values are not rewritten.
export function normalizeBusinessHours(value: unknown): BusinessHours | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const source = value as Record<string, unknown>, result: BusinessHours = {}
  let openDays = 0
  for (let weekday = 1; weekday <= 7; weekday += 1) {
    const rows = source[String(weekday)]
    if (!Array.isArray(rows) || rows.length > 4) return null
    const normalizedRows: Array<{ open: string; close: string }> = []
    for (const raw of rows) {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
      const row = raw as Record<string, unknown>
      const open = String(row.open ?? '').trim(), close = String(row.close ?? '').trim()
      if (!TIME.test(open) || !TIME.test(close) || open >= close) return null
      normalizedRows.push({ open, close })
    }
    if (normalizedRows.length) openDays += 1
    result[String(weekday)] = normalizedRows
  }
  return openDays ? result : null
}

export function isWithinBusinessHours(hours: BusinessHours, timezone: string, start: number, durationMinutes: number): boolean {
  const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
  const parts = (ms: number) => Object.fromEntries(formatter.formatToParts(ms).map(part => [part.type, part.value]))
  const first = parts(start), last = parts(start + durationMinutes * 60_000)
  const date = (p: Record<string, string>) => `${p.year}-${p.month}-${p.day}`
  if (date(first) !== date(last)) return false
  const weekday = new Date(`${date(first)}T12:00:00Z`).getUTCDay() || 7
  const open = `${first.hour}:${first.minute}`, close = `${last.hour}:${last.minute}`
  return hours[String(weekday)].some(period => open >= period.open && (close < period.close || (close === period.close && (start + durationMinutes * 60000) % 60000 === 0)))
}
