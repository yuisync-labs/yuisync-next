export function isEdgeDatabaseEnabled(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === 'true'
}

export function hasD1Binding(binding: D1Database | undefined): boolean {
  return Boolean(binding)
}
