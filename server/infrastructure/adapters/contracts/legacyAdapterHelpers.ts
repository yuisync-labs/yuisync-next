export type LegacyRecord = Record<string, unknown>

export class LegacyContractAdapterError extends Error {
  readonly code = 'LEGACY_CONTRACT_ADAPTER_FAILED' as const
  readonly field: string

  constructor(field: string, message: string) {
    super(message)
    this.name = 'LegacyContractAdapterError'
    this.field = field
  }

  toJSON(): { code: typeof this.code; field: string; message: string } {
    return { code: this.code, field: this.field, message: this.message }
  }
}

export function record(value: unknown, field = '$'): LegacyRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new LegacyContractAdapterError(field, 'Objeto legado inválido.')
  }
  return value as LegacyRecord
}

export function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export function requiredText(value: unknown, field: string): string {
  const parsed = text(value)
  if (!parsed) {
    throw new LegacyContractAdapterError(field, 'Campo obrigatório ausente no formato legado.')
  }
  return parsed
}

export function nullableText(value: unknown): string | null {
  return text(value) || null
}

export function finiteNumber(value: unknown, field: string, fallback?: number): number {
  const parsed = Number(value)
  if (Number.isFinite(parsed)) return parsed
  if (fallback !== undefined) return fallback
  throw new LegacyContractAdapterError(field, 'Número inválido no formato legado.')
}

export function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

export function splitLegacyAddress(value: unknown, field: string): { street: string; number: string } {
  const line = requiredText(value, field)
  const match = line.match(/^(.+?)(?:,\s*|\s+)(\d+[a-zA-Z0-9/.-]*)$/)
  if (!match) {
    throw new LegacyContractAdapterError(field, 'Endereço legado precisa conter rua e número separáveis.')
  }
  return { street: match[1].trim(), number: match[2].trim() }
}

export function normalizeCode(value: unknown): string {
  return text(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

export function inferServiceKind(value: unknown): 'banho' | 'tosa' | 'banho_e_tosa' | 'consulta' | 'vacina' | 'exame' | 'outro' {
  const normalized = normalizeCode(value)
  if (normalized.includes('banho') && normalized.includes('tosa')) return 'banho_e_tosa'
  if (normalized.includes('tosa')) return 'tosa'
  if (normalized.includes('banho')) return 'banho'
  if (normalized.includes('consulta')) return 'consulta'
  if (normalized.includes('vacina')) return 'vacina'
  if (normalized.includes('exame')) return 'exame'
  return 'outro'
}
