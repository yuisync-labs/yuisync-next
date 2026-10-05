import { env } from 'cloudflare:workers'
import { describe, expect, it, vi } from 'vitest'
import { runLunaTurn } from '../src/luna/runLunaTurn'
import { loadOperationalState } from '../src/luna/operationalState'
import { recordProposalPresentation } from '../src/luna/proposalPresentation'
import { LUNA_DESIGNED_SCENARIOS, LUNA_SCENARIO_CLOCK, LUNA_SCENARIO_FIXTURE } from './fixtures/luna/designedScenarios'
import type { LunaMessage, LunaProviderResponse } from '../src/luna/contracts'

const db = (env as EdgeEnv & { DB: D1Database }).DB
type Command = { name: string; args: Record<string, unknown> }

describe('Luna designed cart scenarios — real Worker/local D1/simulated provider', () => {
  for (const id of [2,3,4,6,7,9,13]) it(`cenário ${id}: mensagens exatas, checkpoints e resultado persistido`, async () => {
    const scenario = LUNA_DESIGNED_SCENARIOS.find(s => s.id === id)!
    const start = Date.parse(LUNA_SCENARIO_CLOCK.now), tenant = `${LUNA_SCENARIO_FIXTURE.tenant}-${id}`
    const clock = vi.spyOn(Date, 'now').mockReturnValue(start)
    const ctx = { tenantId: tenant, moduleId: 'petshop' as const, conversationId: `scenario-${id}`, customerAddress: LUNA_SCENARIO_FIXTURE.phone, phoneNumberId: 'fixture-no-whatsapp', sourceMessageId: '', traceId: '', executionMode: 'fixture' as const }
    try {
      await db.batch([
        db.prepare(`INSERT INTO tenants(id,slug,name,status,created_at_ms,updated_at_ms) VALUES(?1,?1,'Cenário fictício','active',?2,?2)`).bind(tenant,start),
        db.prepare(`INSERT INTO clients(tenant_id,module_id,id,name,phone,status,created_at_ms,updated_at_ms) VALUES(?1,'petshop',?2,'Maria',?3,'active',?4,?4)`).bind(tenant,LUNA_SCENARIO_FIXTURE.customer,ctx.customerAddress,start),
        db.prepare(`INSERT INTO chat_threads(tenant_id,module_id,id,channel,external_thread_id,status,last_message_at_ms,created_at_ms,updated_at_ms) VALUES(?1,'petshop',?2,'whatsapp',?3,'open',?4,?4,?4)`).bind(tenant,ctx.conversationId,ctx.customerAddress,start),
        ...LUNA_SCENARIO_FIXTURE.products.flatMap(p => [
          db.prepare(`INSERT INTO catalog_products(tenant_id,module_id,id,name,price_cents,status,created_at_ms,updated_at_ms) VALUES(?1,'petshop',?2,?3,?4,'active',?5,?5)`).bind(tenant,p.id,p.name,p.priceCents,start),
          db.prepare(`INSERT INTO inventory_balances(tenant_id,module_id,product_id,on_hand_milliunits,reserved_milliunits,reorder_milliunits,version,updated_at_ms) VALUES(?1,'petshop',?2,?3,0,0,1,?4)`).bind(tenant,p.id,p.units*1000,start),
        ]),
      ])
      if (id === 6 || id === 9) {
        const hours = Object.fromEntries(Array.from({length:7},(_,i)=>[String(i+1),i<5?[{open:'08:00',close:'18:00'}]:[]]))
        await db.batch([
          db.prepare(`INSERT INTO tenant_module_settings(tenant_id,module_id,store_name,store_city,created_at_ms,updated_at_ms) VALUES(?1,'petshop','Loja fictícia','Cidade Teste',?2,?2)`).bind(tenant,start),
          db.prepare(`INSERT INTO module_settings_extensions(tenant_id,module_id,data_json,updated_at_ms) VALUES(?1,'petshop',?2,?3)`).bind(tenant,JSON.stringify({petbot_timezone:'America/Sao_Paulo',store_business_hours:hours,delivery_coverage:[{city:'Cidade Teste',neighborhood:'Centro',active:true,fee_cents:1500}]}),start),
          db.prepare(`UPDATE clients SET city='Cidade Teste',neighborhood='Centro' WHERE tenant_id=?1`).bind(tenant),
        ])
      }
      if (id === 7) for (let previous=1;previous<=40;previous++) await db.batch([
        db.prepare(`INSERT INTO chat_messages(tenant_id,module_id,id,thread_id,direction,actor_type,content_text,created_at_ms) VALUES(?1,'petshop',?2,?3,'inbound','customer','Mensagem neutra anterior',?4)`).bind(tenant,`previous-in-${previous}`,ctx.conversationId,start-100000+previous*1000),
        db.prepare(`INSERT INTO chat_messages(tenant_id,module_id,id,thread_id,direction,actor_type,content_text,created_at_ms) VALUES(?1,'petshop',?2,?3,'outbound','assistant','Resposta neutra anterior',?4)`).bind(tenant,`previous-out-${previous}`,ctx.conversationId,start-100000+previous*1000+1),
      ])
      let version = 0, reference: { proposal_id: string; proposal_version: number } | null = null
      const executed: string[] = []
      const draft = (action: string, fields: Record<string,unknown>): Command => ({ name: 'update_operation_draft', args: { operationId: 'cart', kind: 'cart', expectedVersion: version++, action, ...fields } })
      const expectedItems = id === 2 ? [{ id: 'racao-a', quantity: 1 }, { id: 'racao-b', quantity: 1 }, { id: 'sache', quantity: 2 }] : id === 3 ? [{ id: 'sache', quantity: 2 }, { id: 'racao-b', quantity: 1 }] : [{ id: 'racao-a', quantity: id === 4 ? 2 : 1 }]
      const expectedTotal = id === 2 ? 21600 : id === 3 ? 12600 : id === 4 ? 18000 : 9000
      const finalTurn = scenario.messages.length
      for (let turn = 1; turn <= scenario.messages.length; turn++) {
        clock.mockReturnValue(start+turn*10000)
        const context = { ...ctx, sourceMessageId: `in-${turn}`, traceId: `trace-${turn}` }
        await db.prepare(`INSERT INTO chat_messages(tenant_id,module_id,id,thread_id,external_message_id,direction,actor_type,content_text,created_at_ms) VALUES(?1,'petshop',?2,?3,?2,'inbound','customer',?4,?5)`).bind(tenant,context.sourceMessageId,ctx.conversationId,scenario.messages[turn-1],Date.now()).run()
        let step = 0, lastCall = ''
        const commands: Command[] = []
        let prepares = false
        const prepare = (items = expectedItems) => { prepares = true; commands.push({ name: 'prepare_product_order', args: { customer_id: LUNA_SCENARIO_FIXTURE.customer, items: items.map(i => ({ product_id: i.id, quantity: i.quantity })), fulfillment_type: 'counter', operation_id: 'cart' } }) }
        if (turn === 1) {
          commands.push({ name: 'get_customer_context', args: {} }, { name: 'search_products', args: { query: 'Ração' } })
          if (id <= 4) commands.push({ name: 'search_products', args: { query: 'Sachê' } })
          commands.push(draft('add_item',{ itemId: 'racao-a', quantity: 1 }))
          if (id <= 4) commands.push(draft('add_item',id === 2 ? { itemId: 'racao-b', quantity: 1 } : { itemId: 'sache', quantity: id === 3 ? 2 : 3 }))
          if (id === 7 || id === 13) { commands.push(draft('set_field',{field:'fulfillment_type',value:'counter'})); prepare() }
          if (id === 9) commands.push(draft('set_field',{field:'fulfillment_type',value:'delivery'}),draft('set_field',{field:'address',value:'Rua Teste, 10'}))
        }
        if (turn === 2) {
          if (id === 2) commands.push(draft('add_item',{ itemId: 'sache', quantity: 2 }))
          if (id === 3) commands.push(draft('remove_item',{ itemId: 'racao-a' }),draft('add_item',{ itemId: 'racao-b', quantity: 1 }))
          if (id === 4) commands.push(draft('remove_item',{ itemId: 'sache' }),draft('set_quantity',{ itemId: 'racao-a', quantity: 2 }))
          if (id === 6) commands.push({name:'get_store_information',args:{}})
          if (id === 7) commands.push(draft('pause',{}))
          if (id === 13) { commands.push(draft('set_quantity',{itemId:'racao-a',quantity:2})); prepare([{id:'racao-a',quantity:2}]) }
          if (id === 9) commands.push(draft('set_field',{field:'address',value:'Rua Teste, 20'}),draft('set_field',{field:'reference',value:'portão azul'}))
        }
        if (id === 9 && turn <= 2) {
          prepares = true
          commands.push({name:'get_delivery_quote',args:{city:'Cidade Teste',neighborhood:'Centro'}},{name:'prepare_product_order',args:{customer_id:LUNA_SCENARIO_FIXTURE.customer,items:[{product_id:'racao-a',quantity:1}],fulfillment_type:'delivery',delivery_address:{street:'Rua Teste',number:turn===1?'10':'20',city:'Cidade Teste',neighborhood:'Centro',reference:turn===1?null:'portão azul'},operation_id:'cart'}})
        }
        if (turn === 3 && (id <= 4 || id === 6 || id === 9)) { commands.push(draft('set_field',{field:'fulfillment_type',value:'counter'})); prepare() }
        if (turn === 3 && id === 13) commands.push(draft('set_quantity',{itemId:'racao-a',quantity:1}))
        if (turn === 4 && id === 13) prepare()
        if (turn === 5 && id === 7) { commands.push(draft('resume',{})); prepare() }
        if (turn === finalTurn) { expect(reference).not.toBeNull(); commands.push({ name: 'commit_confirmed_proposal', args: reference! }) }
        const provider = { model: 'offline-scripted-provider', async complete(input: { messages: readonly LunaMessage[] }): Promise<LunaProviderResponse & {requestLimit:number}> {
          const results = input.messages.filter(m => m.role === 'tool').map(m => JSON.parse(m.content!))
          expect(results.every(r => r.ok)).toBe(true)
          const prepared = results.find(r => r.data?.proposal_id)
          if (prepared) reference = { proposal_id: prepared.data.proposal_id, proposal_version: prepared.data.proposal_version }
          // The provider is scripted for offline integration, not evidence of LLM understanding.
          const batch = step++ === 0 ? commands : []
          const toolCalls = batch.map((command,index) => {
            expect(scenario.allowedTools).toContain(command.name)
            expect(scenario.forbiddenTools).not.toContain(command.name)
            executed.push(command.name)
            lastCall = `call-${turn}-${index}`
            return { id: lastCall, type: 'function' as const, function: { name: command.name, arguments: JSON.stringify(command.args) } }
          })
          return { content: toolCalls.length ? null : JSON.stringify({ opening: id===7&&turn===2?'pause':id===7&&turn===5?'resume':'acknowledge', facts: turn === finalTurn ? [`${lastCall}:result`] : id===6&&turn===2?[`${lastCall}:hours.2`]:[], question: id===6&&turn===2?'city':'none' }), toolCalls, usage: { promptTokens: 10, completionTokens: 10 }, rateLimit: { remainingRequests: 900, remainingTokens: 7000, resetRequests: null, resetTokens: null }, requestLimit: 1000 }
        } }
        const result = await runLunaTurn({ database: db, provider, context })
        expect(result.errorCode).toBeNull()
        expect(result.status).toBe(prepares ? 'awaiting_confirmation' : 'replied')
        clock.mockReturnValue(Date.now()+1)
        const outbound = `out-${turn}`
        await db.prepare(`INSERT INTO chat_messages(tenant_id,module_id,id,thread_id,direction,actor_type,content_text,created_at_ms) VALUES(?1,'petshop',?2,?3,'outbound','assistant',?4,?5)`).bind(tenant,outbound,ctx.conversationId,result.reply,Date.now()).run()
        await recordProposalPresentation(db,context,result.proposalIds,outbound)
        const row = await db.prepare(`SELECT state_json FROM luna_conversations WHERE tenant_id=?1 AND conversation_id=?2`).bind(tenant,ctx.conversationId).first<{state_json:string}>()
        const cart = loadOperationalState(row!.state_json).operations.cart
        if (turn >= 2) expect(cart.items).toEqual(id===13&&turn===2?[{id:'racao-a',quantity:2}]:expectedItems)
        if(id===7) expect(cart.status).toBe(turn>=2&&turn<=4?'paused':'active')
        if(id===6&&turn===2){expect(result.reply).toContain('terça-feira: 08:00–18:00');expect(result.reply).toContain('cidade e bairro')}
        if(id===9&&turn===2){expect(cart.fields.address).toBe('Rua Teste, 20');expect(cart.fields.reference).toBe('portão azul');expect(result.reply).toContain('Taxa de entrega: R$ 15,00');expect(result.reply).toContain('Referência: portão azul')}
        if(id===9&&turn===3){expect(result.reply).not.toContain('Taxa de entrega');expect(result.reply).toContain('Modalidade: retirada')}
        if(id===13&&turn===3) expect(await db.prepare(`SELECT id FROM luna_proposals WHERE tenant_id=?1 AND status='awaiting_confirmation'`).bind(tenant).all()).toMatchObject({results:[]})
        const sales = await db.prepare('SELECT total_cents,status FROM sales WHERE tenant_id=?1').bind(tenant).all()
        if (turn < finalTurn) expect(sales.results).toEqual([])
        else expect(sales.results).toEqual([{ total_cents: expectedTotal, status: 'pending' }])
        if (prepares) expect(result.reply).toContain(`Total: R$ ${((id===13&&turn===2?18000:id===9&&turn<=2?10500:expectedTotal)/100).toFixed(2).replace('.',',')}`)
      }
      expect(executed).toContain('commit_confirmed_proposal')
      expect(await db.prepare('SELECT COUNT(*) AS count FROM payments WHERE tenant_id=?1').bind(tenant).first()).toEqual({ count: 0 })
      if(id===9) expect(await db.prepare('SELECT COUNT(*) AS count FROM sale_delivery_addresses WHERE tenant_id=?1').bind(tenant).first()).toEqual({count:0})
      const stock = await db.prepare('SELECT product_id,on_hand_milliunits,reserved_milliunits FROM inventory_balances WHERE tenant_id=?1').bind(tenant).all<{product_id:string;on_hand_milliunits:number;reserved_milliunits:number}>()
      for (const row of stock.results) {
        expect(row.on_hand_milliunits).toBe(LUNA_SCENARIO_FIXTURE.products.find(p=>p.id===row.product_id)!.units*1000)
        expect(row.reserved_milliunits).toBe((expectedItems.find(i=>i.id===row.product_id)?.quantity??0)*1000)
      }
    } finally { clock.mockRestore() }
  })
})
