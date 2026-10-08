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
  if (result.ok && (name.startsWith('draft_') || ['record_turn_decision','update_operation_draft'].includes(name))) {
    const data = result.data as { state?: OperationalState }
    if (data.state) return JSON.stringify({ok:true,data:{persisted:true,version:data.state.version,commercial_effect:false}})
  }
  return JSON.stringify(result)
}

export function agentContextMessages(messages: readonly LunaMessage[], state: OperationalState): LunaMessage[] {
  const missing = Object.values(state.operations).filter(d => d.status === 'active').map(d => ({operation_id:d.id,kind:d.kind,fields:d.kind==='cart'? [...(!d.items.length?['product']:[]),...(!['counter','delivery'].includes(d.fields.fulfillment_type)?['fulfillment']:[]),...(d.fields.fulfillment_type==='delivery'&&!d.fields.address?['address']:[])]:d.kind==='booking'?[...(!d.items.length?['service']:[]),...(!d.fields.pet_id?['pet']:[]),...(!d.fields.scheduled_at?['date']:[])]:[...(!d.fields.pet_name?['name']:[]),...(!d.fields.species?['species']:[])]}))
  return [
    ...messages.filter(m => m.role !== 'system' || !m.content?.startsWith('MEMÓRIA OPERACIONAL D1:')),
    {role:'system',content:`ESTADO ATUAL DO RASCUNHO (D1, autoritativo): ${JSON.stringify(state)}`},
    {role:'system',content:`CAMPOS AINDA AUSENTES (não perguntar dados presentes): ${JSON.stringify(missing)}. Rascunhos completos exigem prepare_* para apresentar resumo, nunca finish_turn como confirmação de sucesso. Perguntas paralelas não são ações de compra.`},
  ]
}
