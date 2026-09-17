export type LunaRole = 'system' | 'user' | 'assistant' | 'tool'

export type LunaMessage = Readonly<{
  role: LunaRole
  content: string | null
  tool_call_id?: string
  tool_calls?: readonly LunaProviderToolCall[]
}>

export type LunaProviderToolCall = Readonly<{
  id: string
  type: 'function'
  function: Readonly<{ name: string; arguments: string }>
}>

export type LunaToolDefinition = Readonly<{
  name: string
  description: string
  parameters: Readonly<Record<string, unknown>>
}>

export type LunaToolSuccess<T = unknown> = Readonly<{ ok: true; data: T }>
export type LunaToolFailure = Readonly<{
  ok: false
  code: string
  retryable: boolean
  missing_fields?: readonly string[]
}>
export type LunaToolResult<T = unknown> = LunaToolSuccess<T> | LunaToolFailure

export type LunaExecutionContext = Readonly<{
  tenantId: string
  moduleId: 'petshop'
  conversationId: string
  customerAddress: string
  phoneNumberId: string
  sourceMessageId: string
  traceId: string
  executionMode: 'fixture' | 'staging' | 'production'
}>

export type LunaProviderUsage = Readonly<{
  promptTokens: number
  completionTokens: number
}>

export type LunaProviderResponse = Readonly<{
  content: string | null
  toolCalls: readonly LunaProviderToolCall[]
  usage: LunaProviderUsage
  rateLimit: Readonly<{
    remainingRequests: number | null
    remainingTokens: number | null
    resetRequests: string | null
    resetTokens: string | null
  }>
}>

export type LunaTurnResult = Readonly<{
  status: 'replied' | 'awaiting_confirmation' | 'handoff' | 'quota_paused' | 'failed'
  reply: string | null
  proposalIds: readonly string[]
  committedOperationIds: readonly string[]
  traceId: string
  usage: Readonly<{
    modelCalls: number
    toolCalls: number
    promptTokens: number
    completionTokens: number
  }>
}>
