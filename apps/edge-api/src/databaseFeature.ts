export function isEdgeDatabaseEnabled(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === 'true'
}

export function hasD1Binding(
  binding: D1Database | undefined,
): binding is D1Database {
  return Boolean(binding)
}
