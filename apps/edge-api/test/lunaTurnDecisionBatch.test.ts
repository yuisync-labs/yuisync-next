import { describe, expect, it } from 'vitest'
import { createDesignedHarness } from './fixtures/luna/designedRuntimeHarness'
import { createLunaToolRegistry } from '../src/luna/toolRegistry'
import { LunaConversationRepository } from '../src/luna/conversationRepository'

describe('native turn decision batch', () => {
  it('explains a kind used as focus without persisting it; corrected exact ID succeeds', async () => {
    const h=await createDesignedHarness(1,'-focus-contract'),ctx={...h.ctx,sourceMessageId:'focus-message'},registry=createLunaToolRegistry(h.db)
    const args={intents:[{operation_id:'op-cart-1',kind:'cart',goal:'create'}],focus:'cart',events:[{operationId:'op-cart-1',kind:'cart',expectedVersion:0,action:'add_item',itemId:'racao-a',quantity:1}]}
    try {
      await new LunaConversationRepository(h.db).ensureConversation(ctx)
      await h.db.prepare(`INSERT INTO chat_messages(tenant_id,module_id,id,thread_id,external_message_id,direction,actor_type,content_text,created_at_ms) VALUES(?1,'petshop','focus-message',?2,'focus-message','inbound','customer','Comprar uma ração',?3)`).bind(h.tenant,ctx.conversationId,Date.now()).run()
      expect(await registry.execute('record_turn_decision',args,ctx)).toMatchObject({ok:false,code:'TURN_DECISION_INVALID',validation_errors:[{field:'focus'}]})
      expect((await h.state()).operations).toEqual({})
      expect((await registry.execute('record_turn_decision',{...args,focus:'op-cart-1'},ctx)).ok).toBe(true)
      expect((await h.state()).operations['op-cart-1'].items).toEqual([{id:'racao-a',quantity:1}])
      expect(await registry.execute('prepare_product_order',{customer_id:'cliente-maria',items:[{product_id:'racao-a',quantity:1}],fulfillment_type:'counter',operation_id:'op-order-1'},ctx)).toMatchObject({ok:false,code:'OPERATION_DRAFT_INVALID',validation_errors:[{field:'operation_id'}]})
      expect((await h.state()).operations['op-cart-1'].items).toEqual([{id:'racao-a',quantity:1}])
    } finally { h.close() }
  })
  for (const invalid of [false, true]) it(`external message identity; atomic draft events (invalid=${invalid})`, async () => {
    const h = await createDesignedHarness(11, invalid ? '-batch-invalid' : '-batch-replay')
    const ctx = { ...h.ctx, sourceMessageId: 'external-provider-id', actionIndex: 3 }
    const registry = createLunaToolRegistry(h.db)
    const args = { intents: [{ operation_id: 'cart', kind: 'cart', goal: 'create' }, { operation_id: 'booking', kind: 'booking', goal: 'create' }], focus: 'booking', events: [
      { operationId: 'cart', kind: 'cart', expectedVersion: 0, action: 'add_item', itemId: 'racao-a', quantity: 1 },
      { operationId: 'booking', kind: 'booking', expectedVersion: invalid ? 4 : 0, action: 'set_field', field: 'pet_id', value: 'mel' },
    ] }
    try {
      await new LunaConversationRepository(h.db).ensureConversation(ctx)
      await h.db.prepare(`INSERT INTO chat_messages(tenant_id,module_id,id,thread_id,external_message_id,direction,actor_type,content_text,created_at_ms) VALUES(?1,'petshop','database-message-id',?2,?3,'inbound','customer','Banho e ração',?4)`).bind(h.tenant,ctx.conversationId,ctx.sourceMessageId,Date.now()).run()
      const result = await registry.execute('record_turn_decision', args, ctx)
      if (invalid) {
        expect(result).toMatchObject({ ok: false, code: 'OPERATION_VERSION_STALE' })
        expect((await h.state()).operations).toEqual({})
        expect(await h.db.prepare(`SELECT COUNT(*) AS n FROM luna_turn_decisions WHERE tenant_id=?1`).bind(h.tenant).first()).toEqual({n:0})
      } else {
        expect(result.ok).toBe(true)
        expect((await h.state()).focus).toBe('booking')
        // A repeated delivery can assign another runtime action index, but cannot duplicate events.
        expect((await registry.execute('record_turn_decision', args, { ...ctx, actionIndex: 7 })).ok).toBe(true)
        expect(await h.db.prepare(`SELECT COUNT(*) AS n FROM luna_operation_events WHERE tenant_id=?1`).bind(h.tenant).first()).toEqual({n:2})
        expect((await h.state()).operations.cart.version).toBe(1)
        const conflict = structuredClone(args); conflict.events[0].quantity = 2
        expect(await registry.execute('record_turn_decision', conflict, ctx)).toMatchObject({ok:false,code:'OPERATION_EVENT_CONFLICT'})
        expect((await h.state()).operations.cart.items).toEqual([{id:'racao-a',quantity:1}])
        expect(await registry.execute('record_turn_decision', args, {...ctx,conversationId:'other-thread'})).toMatchObject({ok:false,code:'TURN_MESSAGE_MISSING'})
      }
    } finally { h.close() }
  })
  it('prevalidates every catalog identity before applying any event', async () => {
    const h=await createDesignedHarness(11,'-batch-catalog'),ctx={...h.ctx,sourceMessageId:'external-catalog'},r=createLunaToolRegistry(h.db)
    try{
      await new LunaConversationRepository(h.db).ensureConversation(ctx)
      await h.db.prepare(`INSERT INTO chat_messages(tenant_id,module_id,id,thread_id,external_message_id,direction,actor_type,content_text,created_at_ms) VALUES(?1,'petshop','msg',?2,?3,'inbound','customer','Comprar',?4)`).bind(h.tenant,ctx.conversationId,ctx.sourceMessageId,Date.now()).run()
      expect(await r.execute('record_turn_decision',{intents:[{operation_id:'cart',kind:'cart',goal:'create'}],focus:'cart',events:[
        {operationId:'cart',kind:'cart',expectedVersion:0,action:'add_item',itemId:'racao-a'},
        {operationId:'cart',kind:'cart',expectedVersion:1,action:'add_item',itemId:'invented-id'},
      ]},ctx)).toMatchObject({ok:false,code:'CATALOG_ITEM_NOT_FOUND'})
      expect((await h.state()).operations).toEqual({})
    }finally{h.close()}
  })
})
