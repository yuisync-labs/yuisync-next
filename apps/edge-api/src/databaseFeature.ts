export function isEdgeDatabaseEnabled(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === 'true'
}

export function hasHyperdriveBinding(
  binding: { connectionString?: string } | undefined,
): boolean {
  return Boolean(binding?.connectionString?.trim())
}
