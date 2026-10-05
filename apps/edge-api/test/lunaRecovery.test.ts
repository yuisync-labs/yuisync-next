import { env } from 'cloudflare:workers'
import { beforeAll, describe, expect, it } from 'vitest'
import { createLunaToolRegistry } from '../src/luna/toolRegistry'
import { runLunaTurn } from '../src/luna/runLunaTurn'
import { GroqProviderError } from '../src/luna/providers/groqProvider'
import { LunaConversationRepository } from '../src/luna/conversationRepository'

const db = (env as EdgeEnv & { DB: D1Database }).DB
const tenant = 'luna-recovery-fixture'
const ctx = { tenantId: tenant, moduleId: 'petshop' as const, conversationId: 'recovery-thread', customerAddress: '5532999990091', phoneNumberId: 'fixture', sourceMessageId: 'recovery-inbound', traceId: 'recovery-trace', executionMode: 'fixture' as const }
beforeAll(async () => {
  const now = Date.now()
  await db.batch([
    db.prepare(`INSERT INTO tenants(id,slug,name,status,created_at_ms,updated_at_ms) VALUES(?1,?1,'Recovery fixture','active',?2,?2)`).bind(tenant, now),
    db.prepare(`INSERT INTO clients(tenant_id,module_id,id,name,phone,status,created_at_ms,updated_at_ms) VALUES(?1,'petshop','customer','Cliente teste',?2,'active',?3,?3)`).bind(tenant, ctx.customerAddress, now),
    db.prepare(`INSERT INTO chat_threads(tenant_id,module_id,id,channel,external_thread_id,status,last_message_at_ms,created_at_ms,updated_at_ms) VALUES(?1,'petshop',?2,'whatsapp',?3,'open',?4,?4,?4)`).bind(tenant, ctx.conversationId, ctx.customerAddress, now),
    db.prepare(`INSERT INTO catalog_products(tenant_id,module_id,id,name,price_cents,status,created_at_ms,updated_at_ms) VALUES(?1,'petshop','product','Produto',1000,'active',?2,?2)`).bind(tenant, now),
    db.prepare(`INSERT INTO inventory_balances(tenant_id,module_id,product_id,on_hand_milliunits,reserved_milliunits,reorder_milliunits,version,updated_at_ms) VALUES(?1,'petshop','product',10000,0,0,1,?2)`).bind(tenant, now),
  ])
})

describe('Luna recovery on real local D1', () => {
  it('não anuncia confirmação de uma proposta invalidada dentro do mesmo turno', async () => {
    let calls=0
    const commands=[
      {name:'update_operation_draft',args:{operationId:'presentation',kind:'cart',expectedVersion:0,action:'set_field',field:'fulfillment_type',value:'counter'}},
      {name:'prepare_product_order',args:{customer_id:'customer',items:[{product_id:'product',quantity:1}],fulfillment_type:'counter',operation_id:'presentation'}},
      {name:'update_operation_draft',args:{operationId:'presentation',kind:'cart',expectedVersion:1,action:'add_item',itemId:'product',quantity:1}},
    ]
    const result=await runLunaTurn({database:db,context:{...ctx,sourceMessageId:'presentation-only'},provider:{model:'fixture',complete:async()=>{
      const command=commands[calls++]
      return{content:command?null:JSON.stringify({opening:'acknowledge',facts:[],question:'none'}),toolCalls:command?[{id:`presentation-${calls}`,type:'function' as const,function:{name:command.name,arguments:JSON.stringify(command.args)}}]:[],usage:{promptTokens:10,completionTokens:10},rateLimit:{remainingRequests:900,remainingTokens:7000,resetRequests:null,resetTokens:null},requestLimit:1000}
    }}})
    expect(result).toMatchObject({status:'replied',proposalIds:[],committedOperationIds:[]})
    expect(result.reply).not.toContain('Você confirma este resumo?')
    expect(await db.prepare(`SELECT status FROM luna_proposals WHERE tenant_id=?1 AND operation_id='presentation'`).bind(tenant).first()).toEqual({status:'invalidated'})
  })
  it('reformula no máximo uma vez e nunca envia fato inventado', async () => {
    let calls = 0
    const provider = { model: 'fixture', complete: async (input: { tools: readonly unknown[] }) => {
      calls += 1
      if (calls === 3) expect(input.tools).toEqual([])
      return {
        content: calls === 1 ? null : 'O produto está pago e custa R$ 1.',
        toolCalls: calls === 1 ? [{ id: 'stock', type: 'function' as const, function: { name: 'search_products', arguments: '{"query":"Produto"}' } }] : [],
        usage: { promptTokens: 10, completionTokens: 10 }, rateLimit: { remainingRequests: 900, remainingTokens: 7000, resetRequests: null, resetTokens: null }, requestLimit: 1000,
      }
    } }
    const result = await runLunaTurn({ database: db, context: ctx, provider })
    expect(calls).toBe(3)
    expect(result.reply).toBe('Produto: R$ 10,00; estoque disponível nesta consulta: 10.')
    expect(result.usage.modelCalls).toBe(3)
  })

  it('se a reformulação sofre timeout, entrega somente o resultado factual já verificado', async () => {
    let calls = 0
    const provider = { model: 'fixture', complete: async () => {
      calls += 1
      if (calls === 3) throw new GroqProviderError('GROQ_TIMEOUT')
      return {
        content: calls === 1 ? null : 'Tem vinte produtos e já cobrei o cartão.',
        toolCalls: calls === 1 ? [{ id: 'stock', type: 'function' as const, function: { name: 'search_products', arguments: '{"query":"Produto"}' } }] : [],
        usage: { promptTokens: 10, completionTokens: 10 }, rateLimit: { remainingRequests: 900, remainingTokens: 7000, resetRequests: null, resetTokens: null }, requestLimit: 1000,
      }
    } }
    expect(await runLunaTurn({ database: db, context: ctx, provider })).toMatchObject({ status: 'replied', reply: 'Produto: R$ 10,00; estoque disponível nesta consulta: 10.', usage: { modelCalls: 3 } })
  })

  it('preserva o rascunho em timeout, indisponibilidade e quota', async () => {
    await new LunaConversationRepository(db).ensureConversation(ctx)
    const registry = createLunaToolRegistry(db)
    expect(await registry.execute('update_operation_draft', { operationId: 'cart', kind: 'cart', expectedVersion: 0, action: 'add_item', itemId: 'product', quantity: 2 }, ctx)).toMatchObject({ ok: true })
    const before = await db.prepare(`SELECT state_json FROM luna_conversations WHERE tenant_id=?1 AND conversation_id=?2`).bind(tenant, ctx.conversationId).first()
    for (const code of ['GROQ_TIMEOUT', 'GROQ_UNAVAILABLE', 'GROQ_RATE_LIMITED'] as const) {
      const result = await runLunaTurn({ database: db, context: ctx, provider: { model: 'fixture', complete: async () => { throw new GroqProviderError(code) } } })
      expect(result.status).toBe(code === 'GROQ_RATE_LIMITED' ? 'quota_paused' : 'failed')
      const after = await db.prepare(`SELECT state_json,status FROM luna_conversations WHERE tenant_id=?1 AND conversation_id=?2`).bind(tenant, ctx.conversationId).first()
      expect(after).toMatchObject({ ...before, status: 'active' })
    }
  })

  it('reconcilia venda já gravada antes de tentar qualquer commit novamente', async () => {
    const registry = createLunaToolRegistry(db)
    const prepared = await registry.execute('prepare_product_order', { customer_id: 'customer', items: [{ product_id: 'product', quantity: 1 }], fulfillment_type: 'counter' }, ctx)
    expect(prepared.ok).toBe(true)
    const id = (prepared as { data: { proposal_id: string } }).data.proposal_id
    const now = Date.now()
    await db.batch([
      db.prepare(`UPDATE luna_proposals SET status='executing',expires_at_ms=1 WHERE tenant_id=?1 AND id=?2`).bind(tenant, id),
      db.prepare(`INSERT INTO sales(tenant_id,module_id,id,operation_key,client_id,source,fulfillment_type,subtotal_cents,discount_cents,transport_fee_cents,total_cents,status,created_at_ms,updated_at_ms) VALUES(?1,'petshop','existing-sale',?2,'customer','whatsapp','counter',1000,0,0,1000,'pending',?3,?3)`).bind(tenant, `luna-proposal:${id}`, now),
    ])
    // A lost response can be recovered even if the proposal has since expired.
    const result = await registry.execute('commit_confirmed_proposal', { proposal_id: id, proposal_version: 1 }, ctx)
    expect(result).toMatchObject({ ok: true, data: { operation_id: 'existing-sale', idempotent: true } })
    expect(await registry.execute('get_operation_status', { proposal_id: id }, ctx)).toMatchObject({ ok: true, data: { operation_id: 'existing-sale', idempotent: true } })
    expect(await db.prepare(`SELECT COUNT(*) AS count FROM sales WHERE tenant_id=?1`).bind(tenant).first()).toEqual({ count: 1 })
    expect(await registry.execute('get_operation_status', { proposal_id: id }, { ...ctx, customerAddress: '5532999990088' })).toMatchObject({ ok: false, code: 'CUSTOMER_SCOPE_DENIED' })
  })

  it('não repete uma gravação cujo resultado continua incerto', async () => {
    const registry = createLunaToolRegistry(db)
    const prepared = await registry.execute('prepare_product_order', { customer_id: 'customer', items: [{ product_id: 'product', quantity: 1 }], fulfillment_type: 'counter' }, ctx)
    const id = (prepared as { data: { proposal_id: string } }).data.proposal_id
    await db.prepare(`UPDATE luna_proposals SET status='executing' WHERE tenant_id=?1 AND id=?2`).bind(tenant, id).run()
    expect(await registry.execute('commit_confirmed_proposal', { proposal_id: id, proposal_version: 1 }, ctx)).toMatchObject({ ok: false, code: 'COMMIT_STATE_UNCERTAIN', retryable: false })
    expect(await db.prepare(`SELECT COUNT(*) AS count FROM sales WHERE tenant_id=?1`).bind(tenant).first()).toEqual({ count: 1 })
  })
})
