export type JsonRecord = Record<string, unknown>
export const asObject = (value: unknown): JsonRecord => value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {}
export const asText = (value: unknown) => String(value ?? '').trim()
export const asNumber = (value: unknown, fallback = 0) => { const n = Number(value); return Number.isFinite(n) ? n : fallback }

export function requestedServiceCodes(payload: JsonRecord): string[] {
  const raw = Array.isArray(payload.services) ? payload.services : Array.isArray(payload.service_items) ? payload.service_items : []
  const codes = raw.map((entry) => { const item = asObject(entry); return asText(item.code || item.service_code || item.service_type || item.id) }).filter(Boolean)
  if (!codes.length && asText(payload.service_type)) codes.push(asText(payload.service_type))
  return [...new Set(codes)]
}

export function normalizeStatus(value: unknown) {
  const status = asText(value).toLowerCase()
  return ({ agendado:'scheduled', confirmado:'confirmed', em_andamento:'in_progress', concluido:'completed', cancelado:'cancelled' } as Record<string,string>)[status] || status || 'scheduled'
}

export function appointmentEpoch(value: unknown, fallback = Date.now()) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  const parsed = Date.parse(asText(value))
  return Number.isFinite(parsed) ? parsed : fallback
}
