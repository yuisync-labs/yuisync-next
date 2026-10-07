// Worker-safe evolution of the legacy reducer invariants: CAS, immutable
// transitions, replay deduplication, terminal states and catalog-backed items.
// Drafts deliberately contain no prices: preparation resolves commercial facts.
export type DraftKind = 'cart' | 'booking' | 'registration'
export type Draft = {
  id: string; kind: DraftKind; version: number; status: 'active' | 'paused' | 'cancelled'
  fields: Record<string, string>; items: { id: string; quantity: number }[]
}
export type OperationalState = {
  schemaVersion: 1; version: number; focus: string | null; operations: Record<string, Draft>
}
export type DraftEvent = {
  operationId: string; kind: DraftKind; expectedVersion: number
  action: 'set_field' | 'add_item' | 'remove_item' | 'replace_item' | 'set_quantity' | 'pause' | 'resume' | 'cancel'
  field?: string; value?: string; itemId?: string; replacementId?: string; quantity?: number
}
const fields: Record<DraftKind, Set<string>> = {
  cart: new Set(['fulfillment_type', 'address', 'reference', 'payment_preference']),
  booking: new Set(['pet_id', 'scheduled_at', 'period', 'transport_mode', 'address', 'reference', 'notes', 'machine_number']),
  registration: new Set(['customer_name', 'pet_name', 'species', 'breed', 'weight_kg']),
}
export const CART_FULFILLMENT_VALUES = ['counter', 'delivery'] as const
export function validDraftFieldValue(kind: DraftKind, field: string, value: unknown): value is string {
  return typeof value === 'string' && value.length <= 1000 && fields[kind]?.has(field) === true
    && (kind !== 'cart' || field !== 'fulfillment_type' || CART_FULFILLMENT_VALUES.some(option => option === value))
}
export function loadOperationalState(raw: string): OperationalState {
  const value = JSON.parse(raw) as Record<string, unknown>
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('OPERATION_STATE_UNKNOWN')
  if (Object.keys(value).length === 0) return { schemaVersion: 1, version: 0, focus: null, operations: {} }
  if (value.schemaVersion !== 1 || !Number.isSafeInteger(value.version) || Number(value.version) < 0 || !value.operations || typeof value.operations !== 'object' || Array.isArray(value.operations)) throw new Error('OPERATION_STATE_UNKNOWN')
  const state = value as OperationalState
  if (Object.keys(state.operations).length > 12) throw new Error('OPERATION_STATE_UNKNOWN')
  if (state.focus !== null && (typeof state.focus !== 'string' || !Object.hasOwn(state.operations, state.focus))) throw new Error('OPERATION_STATE_UNKNOWN')
  for (const [id, draft] of Object.entries(state.operations)) {
    if (!draft || id !== draft.id || !Object.hasOwn(fields, draft.kind) || !Number.isSafeInteger(draft.version) || draft.version < 1 || !['active', 'paused', 'cancelled'].includes(draft.status) || !draft.fields || typeof draft.fields !== 'object' || Array.isArray(draft.fields) || !Array.isArray(draft.items) || draft.items.length > 12) throw new Error('OPERATION_STATE_UNKNOWN')
    if (Object.entries(draft.fields).some(([key, val]) => !validDraftFieldValue(draft.kind, key, val))) throw new Error('OPERATION_STATE_UNKNOWN')
    if (draft.items.some((item) => !item || typeof item.id !== 'string' || !Number.isSafeInteger(item.quantity) || item.quantity < 1 || item.quantity > 100)) throw new Error('OPERATION_STATE_UNKNOWN')
    if (new Set(draft.items.map((item) => item.id)).size !== draft.items.length) throw new Error('OPERATION_STATE_UNKNOWN')
  }
  return state
}
export function reduceDraft(state: OperationalState, event: DraftEvent): OperationalState {
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(event.operationId) || ['__proto__', 'constructor', 'prototype'].includes(event.operationId) || !Object.hasOwn(fields, event.kind)) throw new Error('OPERATION_EVENT_INVALID')
  const current = state.operations[event.operationId]
  if ((current?.version ?? 0) !== event.expectedVersion) throw new Error('OPERATION_VERSION_STALE')
  if (current && (current.kind !== event.kind || current.status === 'cancelled')) throw new Error('OPERATION_TERMINAL')
  if (!current && Object.keys(state.operations).length >= 12) throw new Error('OPERATION_LIMIT')
  const next = structuredClone(current ?? { id: event.operationId, kind: event.kind, version: 0, status: 'active' as const, fields: {}, items: [] })
  if (event.action === 'set_field') {
    if (!event.field || !validDraftFieldValue(event.kind, event.field, event.value)) throw new Error('OPERATION_FIELD_INVALID')
    next.fields[event.field] = event.value
    if(event.kind==='booking'&&event.field==='pet_id'&&current?.fields.pet_id!==event.value)delete next.fields.machine_number
  } else if (['add_item', 'remove_item', 'replace_item', 'set_quantity'].includes(event.action)) {
    if (event.kind === 'registration' || !event.itemId) throw new Error('OPERATION_ITEM_INVALID')
    const index = next.items.findIndex((item) => item.id === event.itemId)
    if (event.action === 'remove_item') {
      if (index < 0) throw new Error('OPERATION_ITEM_NOT_FOUND')
      next.items.splice(index, 1)
    } else {
      if (event.action !== 'add_item' && index < 0) throw new Error('OPERATION_ITEM_NOT_FOUND')
      const quantity = event.quantity ?? (index >= 0 ? next.items[index].quantity : 1)
      if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 100) throw new Error('OPERATION_QUANTITY_INVALID')
      const id = event.action === 'replace_item' ? event.replacementId : event.itemId
      if (!id || next.items.some((item, i) => i !== index && item.id === id)) throw new Error('OPERATION_ITEM_DUPLICATE')
      if (index < 0) next.items.push({ id, quantity }); else next.items[index] = { id, quantity }
      if (next.items.length > 12) throw new Error('OPERATION_ITEM_LIMIT')
    }
    if(event.kind==='booking'&&JSON.stringify(current?.items??[])!==JSON.stringify(next.items))delete next.fields.machine_number
  } else if (event.action === 'pause') next.status = 'paused'
  else if (event.action === 'resume') next.status = 'active'
  else if (event.action === 'cancel') next.status = 'cancelled'
  else throw new Error('OPERATION_EVENT_INVALID')
  if (current && JSON.stringify(current) === JSON.stringify(next)) return state
  next.version += 1
  return { ...state, version: state.version + 1, focus: next.status === 'active' ? next.id : state.focus === next.id ? null : state.focus, operations: { ...state.operations, [next.id]: next } }
}
