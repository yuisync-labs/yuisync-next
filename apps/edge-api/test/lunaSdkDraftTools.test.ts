import { describe, expect, it } from 'vitest'
import { DRAFT_TOOL_DEFINITIONS, executeDraftTool } from '../src/luna/draftTools'
import { LunaConversationRepository } from '../src/luna/conversationRepository'
import { createLunaToolRegistry } from '../src/luna/toolRegistry'
import { createDesignedHarness } from './fixtures/luna/designedRuntimeHarness'

describe('small SDK draft tools with real local D1', () => {
  it('keeps server-owned versions, replay dedupe and independent drafts', async () => {
    const h = await createDesignedHarness(11, '-sdk-drafts')
    try {
      const context = { ...h.ctx, sourceMessageId: 'draft-message', actionIndex: 1 }
      await new LunaConversationRepository(h.db).ensureConversation(context)
      const registry = createLunaToolRegistry(h.db)
      const add = { operation_id: 'cart', kind: 'cart', item_id: 'racao-a', quantity: 1 }
      expect((await executeDraftTool(h.db, registry, 'draft_add_item', add, context)).ok).toBe(true)
      expect((await executeDraftTool(h.db, registry, 'draft_add_item', add, context)).ok).toBe(true)
      expect((await h.state()).operations.cart.version).toBe(1)
      expect(await executeDraftTool(h.db, registry, 'draft_add_item', { ...add, quantity: 2 }, context)).toMatchObject({ ok: false, code: 'OPERATION_EVENT_CONFLICT' })
      expect((await executeDraftTool(h.db, registry, 'draft_add_item', { operation_id: 'booking', kind: 'booking', item_id: 'banho', quantity: 1 }, { ...context, actionIndex: 2 })).ok).toBe(true)
      expect((await executeDraftTool(h.db, registry, 'draft_set_quantity', { ...add, quantity: 2 }, { ...context, actionIndex: 3 })).ok).toBe(true)
      expect((await h.state()).operations.booking.items).toEqual([{ id: 'banho', quantity: 1 }])
      expect((await h.state()).operations.cart.items).toEqual([{ id: 'racao-a', quantity: 2 }])
      expect(await h.db.prepare('SELECT COUNT(*) AS n FROM sales WHERE tenant_id=?1').bind(h.tenant).first()).toEqual({ n: 0 })
      expect(await h.db.prepare('SELECT COUNT(*) AS n FROM payments WHERE tenant_id=?1').bind(h.tenant).first()).toEqual({ n: 0 })
    } finally { h.close() }
  })
  it('rejects invented prices, versions, tenant IDs and foreign pets', async () => {
    const h = await createDesignedHarness(20, '-sdk-drafts')
    try {
      const context = { ...h.ctx, sourceMessageId: 'scope-message', actionIndex: 1 }
      await new LunaConversationRepository(h.db).ensureConversation(context)
      const registry = createLunaToolRegistry(h.db)
      const add = { operation_id: 'cart', kind: 'cart', item_id: 'racao-a', quantity: 1 }
      for (const extra of [{ expectedVersion: 0 }, { tenant_id: 'foreign' }, { price: 1 }]) expect(await executeDraftTool(h.db, registry, 'draft_add_item', { ...add, ...extra }, context)).toMatchObject({ ok: false, code: 'TOOL_ARGUMENTS_INVALID' })
      expect(await executeDraftTool(h.db, registry, 'draft_set_field', { operation_id: 'booking', kind: 'booking', field: 'pet_id', value: 'foreign-pet' }, context)).toMatchObject({ ok: false, code: 'CUSTOMER_SCOPE_DENIED' })
      expect((await h.state()).operations).toEqual({})
      for (const definition of DRAFT_TOOL_DEFINITIONS) expect(definition.parameters).toMatchObject({ additionalProperties: false })
    } finally { h.close() }
  })
  it('encodes pickup as counter and rejects unsupported fulfillment before persisting any event', async () => {
    const h = await createDesignedHarness(1, '-sdk-fulfillment')
    try {
      const context = { ...h.ctx, sourceMessageId: 'fulfillment-message', actionIndex: 1 }
      await new LunaConversationRepository(h.db).ensureConversation(context)
      const registry = createLunaToolRegistry(h.db)
      const args = { operation_id: 'cart', kind: 'cart', value: 'pickup' }
      expect(await executeDraftTool(h.db,registry,'draft_set_fulfillment',args,context)).toMatchObject({ok:false,code:'TOOL_ARGUMENTS_INVALID'})
      expect(await executeDraftTool(h.db,registry,'draft_set_field',{...args,field:'fulfillment_type'},context)).toMatchObject({ok:false,code:'TOOL_ARGUMENTS_INVALID'})
      expect((await h.state()).operations).toEqual({})
      expect((await executeDraftTool(h.db,registry,'draft_set_fulfillment',{...args,value:'counter'},context)).ok).toBe(true)
      expect((await h.state()).operations.cart.fields.fulfillment_type).toBe('counter')
      expect(await executeDraftTool(h.db,registry,'draft_set_fulfillment',{...args,kind:'booking',value:'counter'},{...context,actionIndex:2})).toMatchObject({ok:false,code:'TOOL_ARGUMENTS_INVALID'})
      // The legacy/internal writer cannot bypass the same domain validation.
      expect(await registry.execute('update_operation_draft',{operationId:'cart',kind:'cart',expectedVersion:1,action:'set_field',field:'fulfillment_type',value:'pickup'},{...context,actionIndex:2})).toMatchObject({ok:false})
      expect((await h.state()).operations.cart.fields.fulfillment_type).toBe('counter')
    } finally { h.close() }
  })
})
