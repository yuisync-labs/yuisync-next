import type { JsonValue, ToolResultV1 } from '../../../shared/contracts/v1/common'

export type ModelMessage = Readonly<{
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  tool_call_id?: string | null
}>

export type ModelToolDefinition = Readonly<{
  name: string
  description: string
  input_schema: JsonValue
}>

export type StructuredModelRequest = Readonly<{
  tenant_id: string
  correlation_id: string
  model: string
  messages: readonly ModelMessage[]
  tools?: readonly ModelToolDefinition[]
  tool_results?: readonly ToolResultV1[]
  response_schema?: JsonValue | null
  temperature?: number
  max_output_tokens?: number
}>

export type StructuredModelResponse = Readonly<{
  content: string
  structured_output: JsonValue | null
  finish_reason: 'stop' | 'tool_call' | 'length' | 'content_filter' | 'error'
  input_tokens: number
  output_tokens: number
  provider_request_id: string | null
}>

export interface StructuredLanguageModelPort {
  generate(request: StructuredModelRequest): Promise<StructuredModelResponse>
}
