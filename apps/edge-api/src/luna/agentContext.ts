import type { LunaMessage, LunaToolResult } from './contracts'
import type { OperationalState } from './operationalState'
import type { ConversationMemory } from './conversationalMemory'

// D1 is the authoritative state, not stale snapshots in the prompt/history.
// Keep accepted options and the question target, but omit the derived summary
// that repeats every draft. Never truncate IDs, addresses or user messages.
export function agentMemory(memory: ConversationMemory): string {
  const { summary: _derived, ...accepted } = memory
  return JSON.stringify(accepted)
}

export function agentToolMessage(name: string, result: LunaToolResult): string {
  if (result.ok && ['record_turn_decision','update_operation_draft'].includes(name)) {
    const data = result.data as { state?: OperationalState }
    if (data.state) return JSON.stringify({ok:true,data:{persisted:true,version:data.state.version,commercial_effect:false}})
  }
  return JSON.stringify(result)
}

export function agentContextMessages(messages: readonly LunaMessage[], state: OperationalState): LunaMessage[] {
  return [
    ...messages.filter(m => m.role !== 'system' || !m.content?.startsWith('MEMÓRIA OPERACIONAL D1:')),
    {role:'system',content:`ESTADO ATUAL DO RASCUNHO (D1, autoritativo): ${JSON.stringify(state)}`},
  ]
}
