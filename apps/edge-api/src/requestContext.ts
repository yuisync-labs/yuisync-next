const REQUEST_ID_PATTERN = /^[a-zA-Z0-9._:-]{8,160}$/

// Fixed route families avoid logging arbitrary path identifiers and reset tokens.
export function requestRouteFamily(url: string): string {
  const path = new URL(url).pathname
  if (path === '/health' || path === '/ready') return path
  const family = /^\/api\/(auth|petshop|app|compat|admin|support|chat|analytics|ai-lab)(?:\/|$)/.exec(path)
  if (family) return `/api/${family[1]}`
  return path.startsWith('/internal/') ? '/internal' : '/other'
}

export function resolveRequestId(candidate: string | undefined): string {
  const value = candidate?.trim()
  return value && REQUEST_ID_PATTERN.test(value)
    ? value
    : crypto.randomUUID()
}
