export type DatabaseCanaryRow = Readonly<{
  transaction_read_only?: unknown
  canary_value?: unknown
}>

export function isValidReadOnlyCanary(row: DatabaseCanaryRow | undefined): boolean {
  return row?.transaction_read_only === 'on' && Number(row.canary_value) === 1
}
