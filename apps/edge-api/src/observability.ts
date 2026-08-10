export type EdgeLogLevel = 'info' | 'warn' | 'error'

export type EdgeLogFields = Readonly<Record<string, string | number | boolean | null>>

export function emitEdgeLog(
  level: EdgeLogLevel,
  event: string,
  fields: EdgeLogFields,
): void {
  const entry = JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    event,
    ...fields,
  })

  if (level === 'error') {
    console.error(entry)
    return
  }
  if (level === 'warn') {
    console.warn(entry)
    return
  }
  console.log(entry)
}
