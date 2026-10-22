import { env } from 'cloudflare:workers'
import { beforeAll, describe, expect, it } from 'vitest'
import { LunaConversationRepository } from '../src/luna/conversationRepository'
import { createLunaToolRegistry } from '../src/luna/toolRegistry'
import { matchesToolSchema } from '../src/luna/toolSchema'
import { loadOperationalState, reduceDraft } from '../src/luna/operationalState'
import { sanitizeLunaTelemetry } from '../src/luna/telemetrySanitizer'
import type { LunaExecutionContext } from '../src/luna/contracts'

const database = (env as EdgeEnv & { DB: D1Database }).DB
const context: LunaExecutionContext = { tenantId: 'luna-state-test', moduleId: 'petshop', conversationId: 'luna-state-thread', customerAddress: '5532999990011', phoneNumberId: 'fixture', sourceMessageId: 'state-message-1', traceId: 'state-trace', executionMode: 'fixture' }
beforeAll(async () => {
  const now = Date.now()
  await database.batch([
    database.prepare(`INSERT INTO tenants(id,slug,name,status,created_at_ms,updated_at_ms) VALUES(?1,?1,'Fixture','active',?2,?2)`).bind(context.tenantId, now),
    database.prepare(`INSERT INTO chat_threads(tenant_id,module_id,id,channel,external_thread_id,status,last_message_at_ms,created_at_ms,updated_at_ms) VALUES(?1,'petshop',?2,'whatsapp',?3,'open',?4,?4,?4)`).bind(context.tenantId, context.conversationId, context.customerAddress, now),
    ...['5532999990011', '5532999990022'].map((phone, index) => database.prepare(`INSERT INTO clients(tenant_id,module_id,id,name,phone,status,created_at_ms,updated_at_ms) VALUES(?1,'petshop',?2,'Fixture',?3,'active',?4,?4)`).bind(context.tenantId, `client-${index}`, phone, now)),
  ])
  await new LunaConversationRepository(database).ensureConversation(context)
})

describe('Luna persistent state and trust boundaries', () => {
  it('rejects extra fields, bad quantities and unsupported schemas', () => {
    const schema = { type: 'object', properties: { quantity: { type: 'integer', minimum: 1, maximum: 100 } }, required: ['quantity'], additionalProperties: false }
    expect(matchesToolSchema({ quantity: 1 }, schema)).toBe(true)
    for (const value of [{ quantity: '1' }, { quantity: 1.5 }, { quantity: 0 }, { quantity: 101 }, { quantity: 1, price: 1 }, {}]) expect(matchesToolSchema(value, schema)).toBe(false)
    expect(matchesToolSchema({}, { type: 'object', oneOf: [] })).toBe(false)
  })
  it('refuses another customer in the same tenant before consulting appointments', async () => {
    const result = await createLunaToolRegistry(database).execute('get_customer_appointments', { customer_id: 'client-1' }, context)
    expect(result).toEqual({ ok: false, code: 'CUSTOMER_SCOPE_DENIED', retryable: false })
  })
  it('redacts free text and identifiers recursively while retaining error codes', () => {
    const raw = { name: 'Maria', address: 'Rua Particular', args: { customer_id: 'private-id' }, code: 'CUSTOMER_SCOPE_DENIED', quantity: 2 }
    const sanitized = JSON.stringify(sanitizeLunaTelemetry(raw))
    for (const text of ['Maria', 'Rua Particular', 'private-id']) expect(sanitized).not.toContain(text)
    expect(sanitized).toContain('CUSTOMER_SCOPE_DENIED')
  })
  it('preserves separate operations and forbids price fields, stale versions and terminal edits', () => {
    let state = loadOperationalState('{}')
    state = reduceDraft(state, { operationId: 'cart', kind: 'cart', expectedVersion: 0, action: 'add_item', itemId: 'feed', quantity: 2 })
    state = reduceDraft(state, { operationId: 'booking', kind: 'booking', expectedVersion: 0, action: 'set_field', field: 'period', value: 'manhã' })
    expect(state.operations.cart.items).toEqual([{ id: 'feed', quantity: 2 }])
    expect(() => reduceDraft(state, { operationId: 'cart', kind: 'cart', expectedVersion: 0, action: 'pause' })).toThrow('OPERATION_VERSION_STALE')
    expect(() => reduceDraft(state, { operationId: 'cart', kind: 'cart', expectedVersion: 1, action: 'set_field', field: 'price', value: '1' })).toThrow('OPERATION_FIELD_INVALID')
    state = reduceDraft(state, { operationId: 'cart', kind: 'cart', expectedVersion: 1, action: 'cancel' })
    expect(() => reduceDraft(state, { operationId: 'cart', kind: 'cart', expectedVersion: 2, action: 'resume' })).toThrow('OPERATION_TERMINAL')
  })
  it('fails closed on unknown persisted schema without replacing it', () => {
    expect(() => loadOperationalState('{"schemaVersion":99}')).toThrow('OPERATION_STATE_UNKNOWN')
  })
  it('persists partial state and deduplicates a replay before checking its old version', async () => {
    const repository = new LunaConversationRepository(database)
    const event = { operationId: 'draft-cart', kind: 'cart' as const, expectedVersion: 0, action: 'set_field' as const, field: 'fulfillment_type', value: 'counter' }
    const first = await repository.applyDraftEvent(context, event, 0)
    const replay = await repository.applyDraftEvent(context, event, 0)
    expect(replay).toEqual(first)
    await expect(repository.applyDraftEvent(context, { ...event, value: 'delivery' }, 0)).rejects.toThrow('OPERATION_EVENT_CONFLICT')
    expect((await repository.loadState(context)).state.operations['draft-cart'].version).toBe(1)
    const count = await database.prepare(`SELECT COUNT(*) AS count FROM luna_operation_events WHERE tenant_id=?1`).bind(context.tenantId).first<{ count: number }>()
    expect(count?.count).toBe(1)
  })
  it('does not invalidate or version a draft for an identical field value', () => {
    const event = { operationId: 'cart', kind: 'cart' as const, expectedVersion: 0, action: 'set_field' as const, field: 'fulfillment_type', value: 'counter' }
    const state = reduceDraft(loadOperationalState('{}'), event)
    expect(reduceDraft(state, { ...event, expectedVersion: 1 })).toBe(state)
  })
})
