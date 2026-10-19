import { env } from 'cloudflare:workers'
import { describe, expect, it, vi } from 'vitest'
import { runLunaTurn } from '../src/luna/runLunaTurn'
import { loadOperationalState } from '../src/luna/operationalState'
import { recordProposalPresentation } from '../src/luna/proposalPresentation'
import { LUNA_DESIGNED_SCENARIOS, LUNA_SCENARIO_CLOCK, LUNA_SCENARIO_FIXTURE } from './fixtures/luna/designedScenarios'
import type { LunaMessage, LunaProviderResponse } from '../src/luna/contracts'

const db = (env as EdgeEnv & { DB: D1Database }).DB

describe('Luna designed scenario 01 — real Worker/local D1/simulated provider', () => {
  it('executa as três mensagens exatas, checkpoints, apresentação e pedido pendente único', async () => {
    const scenario = LUNA_DESIGNED_SCENARIOS.find(s => s.id === 1)!
    const fixture = LUNA_SCENARIO_FIXTURE
    const start = Date.parse(LUNA_SCENARIO_CLOCK.now)
    const clock = vi.spyOn(Date, 'now').mockReturnValue(start)
    const ctx = { tenantId: fixture.tenant, moduleId: 'petshop' as const, conversationId: 'designed-01', customerAddress: fixture.phone, phoneNumberId: 'fixture-no-whatsapp', sourceMessageId: '', traceId: '', executionMode: 'fixture' as const }
    try {
      await db.batch([
        db.prepare(`INSERT INTO tenants(id,slug,name,status,created_at_ms,updated_at_ms) VALUES(?1,?1,'Cenário fictício','active',?2,?2)`).bind(fixture.tenant, start),
        db.prepare(`INSERT INTO clients(tenant_id,module_id,id,name,phone,status,created_at_ms,updated_at_ms) VALUES(?1,'petshop',?2,'Maria',?3,'active',?4,?4)`).bind(fixture.tenant, fixture.customer, fixture.phone, start),
        db.prepare(`INSERT INTO catalog_products(tenant_id,module_id,id,name,price_cents,status,created_at_ms,updated_at_ms) VALUES(?1,'petshop','racao-a','Ração A',9000,'active',?2,?2)`).bind(fixture.tenant, start),
        db.prepare(`INSERT INTO inventory_balances(tenant_id,module_id,product_id,on_hand_milliunits,reserved_milliunits,reorder_milliunits,version,updated_at_ms) VALUES(?1,'petshop','racao-a',10000,0,0,1,?2)`).bind(fixture.tenant, start),
        db.prepare(`INSERT INTO chat_threads(tenant_id,module_id,id,channel,external_thread_id,status,last_message_at_ms,created_at_ms,updated_at_ms) VALUES(?1,'petshop',?2,'whatsapp',?3,'open',?4,?4,?4)`).bind(fixture.tenant, ctx.conversationId, fixture.phone, start),
      ])
      let proposal: { proposal_id: string; proposal_version: number } | null = null
      const called: string[] = []
      const tools = (name: string, args: unknown) => ({ id: `call-${called.length}`, type: 'function' as const, function: { name, arguments: JSON.stringify(args) } })
      const toolResults = (messages: readonly LunaMessage[]) => messages.filter(m => m.role === 'tool').map(m => JSON.parse(m.content!) as { ok: boolean; data?: { proposal_id?: string; proposal_version?: number } })
      let totalCalls = 0
      for (let turn = 1; turn <= scenario.messages.length; turn++) {
        clock.mockReturnValue(start + turn * 10000)
        const inbound = `scenario-01-in-${turn}`, context = { ...ctx, sourceMessageId: inbound, traceId: `scenario-01-turn-${turn}` }
        await db.prepare(`INSERT INTO chat_messages(tenant_id,module_id,id,thread_id,external_message_id,direction,actor_type,content_text,created_at_ms) VALUES(?1,'petshop',?2,?3,?2,'inbound','customer',?4,?5)`)
          .bind(fixture.tenant, inbound, ctx.conversationId, scenario.messages[turn - 1], Date.now()).run()
        let step = 0
        const provider = {
          model: 'offline-scripted-provider',
          async complete(input: { messages: readonly LunaMessage[] }): Promise<LunaProviderResponse & { requestLimit: number | null }> {
            totalCalls++
            const results = toolResults(input.messages)
            expect(results.every(r => r.ok)).toBe(true)
            const prepared = results.find(r => r.data?.proposal_id)
            if (prepared?.data?.proposal_id) proposal = { proposal_id: prepared.data.proposal_id, proposal_version: prepared.data.proposal_version! }
            let call
            if (turn === 1) {
              if (step === 0) call = tools('get_customer_context', {})
              if (step === 1) call = tools('search_products', { query: 'Ração A' })
              if (step === 2) call = tools('update_operation_draft', { operationId: 'cart', kind: 'cart', expectedVersion: 0, action: 'add_item', itemId: 'racao-a', quantity: 1 })
            } else if (turn === 2) {
              if (step === 0) call = tools('update_operation_draft', { operationId: 'cart', kind: 'cart', expectedVersion: 1, action: 'set_field', field: 'fulfillment_type', value: 'counter' })
              if (step === 1) call = tools('prepare_product_order', { customer_id: fixture.customer, items: [{ product_id: 'racao-a', quantity: 1 }], fulfillment_type: 'counter', operation_id: 'cart' })
            } else if (step === 0) {
              expect(proposal).not.toBeNull()
              call = tools('commit_confirmed_proposal', proposal!)
            }
            step++
            if (call) {
              expect(scenario.allowedTools).toContain(call.function.name)
              expect(scenario.forbiddenTools).not.toContain(call.function.name)
              called.push(call.function.name)
            }
            return {
              content: call ? null : JSON.stringify({ opening: 'acknowledge', facts: turn === 3 ? [`call-${called.length - 1}:result`] : [], question: turn === 1 ? 'fulfillment' : 'none' }),
              toolCalls: call ? [call] : [], usage: { promptTokens: 10, completionTokens: 10 }, rateLimit: { remainingRequests: 900, remainingTokens: 7000, resetRequests: null, resetTokens: null }, requestLimit: 1000,
            }
          },
        }
        const result = await runLunaTurn({ database: db, provider, context })
        expect(result.errorCode).toBeNull()
        expect(result.status).toBe(turn === 2 ? 'awaiting_confirmation' : 'replied')
        const outbound = `scenario-01-out-${turn}`
        clock.mockReturnValue(start + turn * 10000 + 1)
        await db.prepare(`INSERT INTO chat_messages(tenant_id,module_id,id,thread_id,direction,actor_type,content_text,created_at_ms) VALUES(?1,'petshop',?2,?3,'outbound','assistant',?4,?5)`)
          .bind(fixture.tenant, outbound, ctx.conversationId, result.reply, Date.now()).run()
        await recordProposalPresentation(db, context, result.proposalIds, outbound)
        const row = await db.prepare(`SELECT state_json FROM luna_conversations WHERE tenant_id=?1 AND module_id='petshop' AND conversation_id=?2`).bind(fixture.tenant, ctx.conversationId).first<{ state_json: string }>()
        const cart = loadOperationalState(row!.state_json).operations.cart
        expect(cart.items).toEqual([{ id: 'racao-a', quantity: 1 }])
        const sales = await db.prepare(`SELECT id,total_cents,status FROM sales WHERE tenant_id=?1 AND module_id='petshop'`).bind(fixture.tenant).all()
        if (turn < 3) expect(sales.results).toEqual([])
        if (turn === 2) {
          expect(cart.fields.fulfillment_type).toBe('counter')
          expect(result.reply).toContain('Ração A × 1: R$ 90,00')
          expect(result.reply).toContain('Modalidade: retirada')
          expect(result.reply).toContain('Total: R$ 90,00')
          expect(await db.prepare(`SELECT COUNT(*) AS count FROM luna_proposal_presentations WHERE tenant_id=?1`).bind(fixture.tenant).first()).toEqual({ count: 1 })
        }
        if (turn === 3) {
          expect(sales.results).toHaveLength(1)
          expect(sales.results[0]).toMatchObject({ status: 'pending', total_cents: 9000 })
          expect(result.committedOperationIds).toEqual([sales.results[0].id])
          expect(result.reply).toContain('não significa que o pagamento foi recebido')
          expect(await db.prepare(`SELECT COUNT(*) AS count FROM payments WHERE tenant_id=?1`).bind(fixture.tenant).first()).toEqual({ count: 0 })
        }
      }
      expect(totalCalls).toBe(9)
      expect(called).toEqual(['get_customer_context', 'search_products', 'update_operation_draft', 'update_operation_draft', 'prepare_product_order', 'commit_confirmed_proposal'])
    } finally { clock.mockRestore() }
  })
})
