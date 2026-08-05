const REQUEST_ID_PATTERN = /^[a-zA-Z0-9._:-]{8,160}$/

export function resolveRequestId(candidate: string | undefined): string {
  const value = candidate?.trim()
  return value && REQUEST_ID_PATTERN.test(value)
    ? value
    : crypto.randomUUID()
}
