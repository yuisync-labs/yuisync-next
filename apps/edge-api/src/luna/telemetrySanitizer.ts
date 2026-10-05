// Telemetry contains structure/counters, never commercial snapshots or free text.
export function sanitizeLunaTelemetry(value: unknown, depth = 0): unknown {
  if (depth > 8) return '[truncated]'
  if (value === null || typeof value === 'boolean') return value
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string') return '[redacted]'
  if (Array.isArray(value)) return value.slice(0, 30).map((item) => sanitizeLunaTelemetry(item, depth + 1))
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).slice(0, 50).map(([key, item]) => [
    /^[a-z_]{1,64}$/i.test(key) ? key : '[redacted_key]',
    key === 'code' && typeof item === 'string' && /^[A-Z_]{1,80}$/.test(item) ? item : sanitizeLunaTelemetry(item, depth + 1),
  ]))
  return null
}
