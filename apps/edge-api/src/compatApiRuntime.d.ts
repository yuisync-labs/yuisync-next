import type { BetterAuthRuntimeBindings } from './auth/betterAuthRuntime'

export type CompatRuntimeBindings = BetterAuthRuntimeBindings & { DB?: D1Database }
export type CompatChatScope = { tenantId: string; moduleId: string }
export type CompatChatSessionCanonical = {
  tenant_id: string
  module_id: string
  id: string
  channel: string
  external_thread_id: string | null
  client_id: string | null
  pet_id: string | null
  customer_name: string | null
  status: string
  intent: string | null
  assigned_staff_key: string | null
  csat_score: number | null
  closed_at_ms: number | null
  context_json: string
  last_message_at_ms: number | null
  created_at_ms: number
  updated_at_ms: number
}

export function normalizeCompatChatSession(
  raw: Record<string, unknown>,
  scope: CompatChatScope,
  id?: string,
  now?: number,
): CompatChatSessionCanonical
export function handleCompatApiRequest(request: Request, env: CompatRuntimeBindings): Promise<Response | null>
export const COMPAT_TABLE_NAMES: readonly string[]
export function selectRows(
  db: Pick<D1Database, 'prepare'>,
  table: string,
  config: { read: string; global?: boolean },
  body: Record<string, unknown>,
  scope: CompatChatScope,
): Promise<{ rows: Record<string, unknown>[]; count: number | null }>
