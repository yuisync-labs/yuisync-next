import type { LunaExecutionContext, LunaToolDefinition, LunaToolResult } from './contracts'
import type { LunaToolRegistry } from './toolRegistry'
import { LunaConversationRepository } from './conversationRepository'
import { matchesToolSchema } from './toolSchema'

// Model-facing commands have one purpose. Versions, identity and event IDs are
// server-owned; the existing domain command still enforces CAS and catalog scope.
const common = {
  operation_id: { type: 'string', minLength: 1, maxLength: 100 },
  kind: { type: 'string', enum: ['cart', 'booking', 'registration'] },
}
const item = { type: 'string', minLength: 1, maxLength: 160 }
const quantity = { type: 'integer', minimum: 1, maximum: 100 }
const commands = [
  ['add_item', { item_id: item, quantity }],
  ['remove_item', { item_id: item }],
  ['replace_item', { item_id: item, replacement_id: item, quantity }],
  ['set_quantity', { item_id: item, quantity }],
  ['set_field', { field: { type: 'string', enum: ['fulfillment_type', 'address', 'reference', 'payment_preference', 'pet_id', 'scheduled_at', 'period', 'transport_mode', 'notes', 'machine_number', 'customer_name', 'pet_name', 'species', 'breed', 'weight_kg'] }, value: { type: 'string', maxLength: 1000 } }],
  ['pause', {}], ['resume', {}], ['cancel', {}],
] as const

export const DRAFT_TOOL_DEFINITIONS: readonly LunaToolDefinition[] = commands.map(([action, fields]) => ({
  name: `draft_${action}`,
  description: `Altera somente o rascunho: ${action}. Reutilize operation_id estável e IDs reais consultados. Sem preço, pagamento ou reserva. A versão é resolvida e validada no servidor.`,
  parameters: { type: 'object', additionalProperties: false, properties: { ...common, ...fields }, required: [...Object.keys(common), ...Object.keys(fields)] },
}))

export async function executeDraftTool(database: D1Database, registry: LunaToolRegistry, name: string, args: unknown, context: LunaExecutionContext): Promise<LunaToolResult> {
  const definition = DRAFT_TOOL_DEFINITIONS.find(d => d.name === name)
  if (!definition || !matchesToolSchema(args, definition.parameters)) return { ok: false, code: 'TOOL_ARGUMENTS_INVALID', retryable: false }
  const data = args as Record<string, unknown>
  const loaded = await new LunaConversationRepository(database).loadState(context)
  // Replay must use the original version, not today's version. The downstream
  // event fingerprint rejects a replay with altered content at the same index.
  const prior = await database.prepare(`SELECT previous_version FROM luna_operation_events WHERE tenant_id=?1 AND module_id=?2 AND conversation_id=?3 AND event_id=?4`)
    .bind(context.tenantId, context.moduleId, context.conversationId, `${context.sourceMessageId}:${context.actionIndex ?? 0}`).first<{ previous_version: number }>()
  return registry.execute('update_operation_draft', {
    operationId: data.operation_id, kind: data.kind,
    expectedVersion: prior?.previous_version ?? loaded.state.operations[String(data.operation_id)]?.version ?? 0,
    action: name.slice('draft_'.length),
    ...('item_id' in data ? { itemId: data.item_id } : {}),
    ...('replacement_id' in data ? { replacementId: data.replacement_id } : {}),
    ...('quantity' in data ? { quantity: data.quantity } : {}),
    ...('field' in data ? { field: data.field, value: data.value } : {}),
  }, context)
}
