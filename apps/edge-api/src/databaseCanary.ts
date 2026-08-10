export type DatabaseCanaryRow = Readonly<{
  canary_value?: unknown
}>

export function isValidD1Canary(row: DatabaseCanaryRow | undefined): boolean {
  return Number(row?.canary_value) === 1
}
