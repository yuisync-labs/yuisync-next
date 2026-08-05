import { type ZodIssue, type ZodType } from 'zod'

export type ContractIssueV1 = Readonly<{
  path: string
  code: string
  message: string
}>

export type ContractErrorBodyV1 = Readonly<{
  code: 'CONTRACT_VALIDATION_FAILED'
  contract: string
  version: number
  issues: readonly ContractIssueV1[]
}>

function issuePath(issue: ZodIssue): string {
  if (!issue.path.length) return '$'
  return issue.path.reduce<string>((path, segment) => (
    typeof segment === 'number'
      ? `${path}[${segment}]`
      : path === '$' ? `$.${segment}` : `${path}.${segment}`
  ), '$')
}

function safeIssueMessage(issue: ZodIssue): string {
  switch (issue.code) {
    case 'invalid_type':
      return 'Tipo de valor inválido.'
    case 'invalid_value':
      return 'Valor fora das opções permitidas.'
    case 'invalid_format':
      return 'Formato inválido.'
    case 'too_small':
      return 'Valor abaixo do limite permitido.'
    case 'too_big':
      return 'Valor acima do limite permitido.'
    case 'unrecognized_keys':
      return 'Campo não permitido.'
    default:
      return 'Valor inválido.'
  }
}

function sanitizeIssues(issues: readonly ZodIssue[]): readonly ContractIssueV1[] {
  return issues.map((issue) => Object.freeze({
    path: issuePath(issue),
    code: issue.code,
    message: safeIssueMessage(issue),
  }))
}

export class ContractValidationError extends Error {
  readonly code = 'CONTRACT_VALIDATION_FAILED' as const
  readonly contract: string
  readonly version: number
  readonly issues: readonly ContractIssueV1[]

  constructor(options: {
    contract: string
    version: number
    issues: readonly ZodIssue[]
  }) {
    super(`Contrato inválido: ${options.contract} v${options.version}`)
    this.name = 'ContractValidationError'
    this.contract = options.contract
    this.version = options.version
    this.issues = sanitizeIssues(options.issues)
  }

  toJSON(): ContractErrorBodyV1 {
    return {
      code: this.code,
      contract: this.contract,
      version: this.version,
      issues: this.issues,
    }
  }
}

export function parseContract<TOutput>(options: {
  contract: string
  version: number
  schema: ZodType<TOutput>
  input: unknown
}): TOutput {
  const parsed = options.schema.safeParse(options.input)
  if (parsed.success) return parsed.data

  throw new ContractValidationError({
    contract: options.contract,
    version: options.version,
    issues: parsed.error.issues,
  })
}
