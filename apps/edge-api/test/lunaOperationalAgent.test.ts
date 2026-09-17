import { env } from 'cloudflare:workers'
import { beforeAll, describe, expect, it } from 'vitest'

import { runLunaTurn } from '../src/luna/runLunaTurn'
import type { LunaMessage, LunaProviderResponse, LunaToolDefinition } from '../src/luna/contracts'
import { createLunaToolRegistry } from '../src/luna/toolRegistry'

const testEnv = env as EdgeEnv & { DB: D1Database }
const TENANT = 'tenant-luna-agent-test'
const THREAD = 'wa:5532999990000'
const NOW = 1_789_000_000_000

beforeAll(async () => {
  await testEnv.DB.batch([
    testEnv.DB.prepare(`INSERT OR REPLACE INTO tenants(id,slug,name,status,created_at_ms,updated_at_ms) VALUES(?1,?1,'Luna Test','active',?2,?2)`).bind(TENANT, NOW),
    testEnv.DB.prepare(`INSERT OR REPLACE INTO clients(tenant_id,module_id,id,name,phone,status,created_at_ms,updated_at_ms) VALUES(?1,'petshop','client-1','Maria','5532999990000','active',?2,?2)`).bind(TENANT, NOW),
    testEnv.DB.prepare(`INSERT OR REPLACE INTO pets(tenant_id,module_id,id,client_id,name,species,status,created_at_ms,updated_at_ms) VALUES(?1,'petshop','pet-1','client-1','Mel','dog','active',?2,?2)`).bind(TENANT, NOW),
    testEnv.DB.prepare(`INSERT OR REPLACE INTO services(tenant_id,module_id,id,code,name,group_type,default_price_cents,default_duration_min,sort_order,status,created_at_ms,updated_at_ms) VALUES(?1,'petshop','service-1','banho','Banho','banho_tosa',5500,60,1,'active',?2,?2)`).bind(TENANT, NOW),
    testEnv.DB.prepare(`INSERT OR REPLACE INTO catalog_products(tenant_id,module_id,id,name,category,price_cents,status,created_at_ms,updated_at_ms) VALUES(?1,'petshop','product-1','Ração Teste','racao',9000,'active',?2,?2)`).bind(TENANT, NOW),
    testEnv.DB.prepare(`INSERT OR REPLACE INTO inventory_balances(tenant_id,module_id,product_id,on_hand_milliunits,reserved_milliunits,reorder_milliunits,version,updated_at_ms) VALUES(?1,'petshop','product-1',10000,0,0,1,?2)`).bind(TENANT, NOW),
    testEnv.DB.prepare(`INSERT OR REPLACE INTO chat_threads(tenant_id,module_id,id,channel,external_thread_id,status,last_message_at_ms,created_at_ms,updated_at_ms) VALUES(?1,'petshop',?2,'whatsapp','5532999990000','open',?3,?3,?3)`).bind(TENANT, THREAD, NOW),
    testEnv.DB.prepare(`INSERT OR REPLACE INTO chat_messages(tenant_id,module_id,id,thread_id,external_message_id,direction,actor_type,content_text,created_at_ms) VALUES(?1,'petshop','msg-1',?2,'wamid.test','inbound','customer','Quero banho para a Mel',?3)`).bind(TENANT, THREAD, NOW),
  ])
})

const context = {
  tenantId: TENANT,
  moduleId: 'petshop' as const,
  conversationId: THREAD,
  customerAddress: '5532999990000',
  phoneNumberId: '1234567890',
  sourceMessageId: 'wamid.test',
  traceId: 'trace-luna-test',
  executionMode: 'fixture' as const,
}

describe('Luna operational foundation', () => {
  it('consulta contexto e prepara pedido sem executar venda', async () => {
    const registry = createLunaToolRegistry(testEnv.DB)
    const customer = await registry.execute('get_customer_context', {}, context)
    expect(customer).toMatchObject({ ok: true, data: { customer: { id: 'client-1' }, pets: [{ id: 'pet-1' }] } })

    const order = await registry.execute('prepare_product_order', {
      customer_id: 'client-1', items: [{ product_id: 'product-1', quantity: 2 }], fulfillment_type: 'counter',
    }, context)
    expect(order).toMatchObject({ ok: true, data: { proposal_version: 1, summary: { total_cents: 18000 } } })
    const sale = await testEnv.DB.prepare(`SELECT COUNT(*) AS count FROM sales WHERE tenant_id=?1 AND source='whatsapp'`).bind(TENANT).first<{ count: number }>()
    expect(sale?.count).toBe(0)
  })

  it('executa ciclo modelo-ferramenta-modelo e registra telemetria', async () => {
    let call = 0
    const provider = {
      model: 'groq-test-model',
      async complete(_input: { messages: readonly LunaMessage[]; tools: readonly LunaToolDefinition[] }): Promise<LunaProviderResponse & { requestLimit: number | null }> {
        call += 1
        return call === 1
          ? {
              content: null,
              toolCalls: [{ id: 'tool-1', type: 'function', function: { name: 'get_customer_context', arguments: '{}' } }],
              usage: { promptTokens: 100, completionTokens: 20 },
              rateLimit: { remainingRequests: 900, remainingTokens: 7000, resetRequests: null, resetTokens: null },
              requestLimit: 1000,
            }
          : {
              content: 'Encontrei a Mel. Qual dia você prefere?', toolCalls: [],
              usage: { promptTokens: 140, completionTokens: 15 },
              rateLimit: { remainingRequests: 899, remainingTokens: 6900, resetRequests: null, resetTokens: null },
              requestLimit: 1000,
            }
      },
    }
    const result = await runLunaTurn({ database: testEnv.DB, provider, context })
    expect(result).toMatchObject({ status: 'replied', reply: 'Encontrei a Mel. Qual dia você prefere?', usage: { modelCalls: 2, toolCalls: 1 } })
    const toolRun = await testEnv.DB.prepare(`SELECT tool_name,status FROM luna_tool_runs WHERE tenant_id=?1 AND trace_id=?2 LIMIT 1`).bind(TENANT, context.traceId).first<{ tool_name: string; status: string }>()
    expect(toolRun).toEqual({ tool_name: 'get_customer_context', status: 'succeeded' })
  })

  it('só confirma pedido em mensagem posterior e não declara pagamento nem baixa estoque', async () => {
    const registry = createLunaToolRegistry(testEnv.DB)
    const prepared = await registry.execute('prepare_product_order', {
      customer_id: 'client-1', items: [{ product_id: 'product-1', quantity: 1 }], fulfillment_type: 'counter',
    }, { ...context, sourceMessageId: 'wamid.order-proposal' })
    expect(prepared.ok).toBe(true)
    const data = prepared.ok ? prepared.data as { proposal_id: string; proposal_version: number } : null
    expect(data).toBeTruthy()

    const withoutConfirmation = await registry.execute('commit_confirmed_proposal', {
      proposal_id: data!.proposal_id, proposal_version: data!.proposal_version,
    }, { ...context, sourceMessageId: 'wamid.order-proposal' })
    expect(withoutConfirmation).toMatchObject({ ok: false, code: 'CONFIRMATION_REQUIRED' })

    await testEnv.DB.prepare(`INSERT INTO chat_messages(tenant_id,module_id,id,thread_id,external_message_id,direction,actor_type,content_text,created_at_ms) VALUES(?1,'petshop',?2,?3,?4,'inbound','customer','sim',?5)`)
      .bind(TENANT, crypto.randomUUID(), THREAD, 'wamid.order-confirm', Date.now()).run()
    const committed = await registry.execute('commit_confirmed_proposal', {
      proposal_id: data!.proposal_id, proposal_version: data!.proposal_version,
    }, { ...context, sourceMessageId: 'wamid.order-confirm' })
    expect(committed).toMatchObject({ ok: true, data: { operation_kind: 'product_order_create', status: 'pending' } })
    const saleId = committed.ok ? String((committed.data as { operation_id: string }).operation_id) : ''
    const sale = await testEnv.DB.prepare(`SELECT status,total_cents FROM sales WHERE tenant_id=?1 AND id=?2`).bind(TENANT, saleId).first<{ status: string; total_cents: number }>()
    const stock = await testEnv.DB.prepare(`SELECT on_hand_milliunits FROM inventory_balances WHERE tenant_id=?1 AND product_id='product-1'`).bind(TENANT).first<{ on_hand_milliunits: number }>()
    const payments = await testEnv.DB.prepare(`SELECT COUNT(*) AS count FROM payments WHERE tenant_id=?1 AND sale_id=?2`).bind(TENANT, saleId).first<{ count: number }>()
    expect(sale).toEqual({ status: 'pending', total_cents: 9000 })
    expect(stock?.on_hand_milliunits).toBe(10000)
    expect(payments?.count).toBe(0)
  })

  it('rejeita confirmação acompanhada de correção', async () => {
    const registry = createLunaToolRegistry(testEnv.DB)
    const prepared = await registry.execute('prepare_product_order', {
      customer_id: 'client-1', items: [{ product_id: 'product-1', quantity: 1 }], fulfillment_type: 'counter',
    }, { ...context, sourceMessageId: 'wamid.changed-proposal' })
    const data = prepared.ok ? prepared.data as { proposal_id: string; proposal_version: number } : null
    await testEnv.DB.prepare(`INSERT INTO chat_messages(tenant_id,module_id,id,thread_id,external_message_id,direction,actor_type,content_text,created_at_ms) VALUES(?1,'petshop',?2,?3,?4,'inbound','customer','sim, mas quero duas',?5)`)
      .bind(TENANT, crypto.randomUUID(), THREAD, 'wamid.changed-confirm', Date.now()).run()
    const result = await registry.execute('commit_confirmed_proposal', {
      proposal_id: data!.proposal_id, proposal_version: data!.proposal_version,
    }, { ...context, sourceMessageId: 'wamid.changed-confirm' })
    expect(result).toMatchObject({ ok: false, code: 'CONFIRMATION_REQUIRED' })
  })

  it('reidrata a proposta do D1 no turno seguinte e consegue confirmá-la', async () => {
    const registry = createLunaToolRegistry(testEnv.DB)
    const proposalSource = `wamid.rehydrate-proposal-${crypto.randomUUID()}`
    const confirmationSource = `wamid.rehydrate-confirm-${crypto.randomUUID()}`
    const prepared = await registry.execute('prepare_product_order', {
      customer_id: 'client-1', items: [{ product_id: 'product-1', quantity: 1 }], fulfillment_type: 'counter',
    }, { ...context, sourceMessageId: proposalSource })
    const proposal = prepared.ok ? prepared.data as { proposal_id: string; proposal_version: number } : null
    await testEnv.DB.prepare(`INSERT INTO chat_messages(tenant_id,module_id,id,thread_id,external_message_id,direction,actor_type,content_text,created_at_ms) VALUES(?1,'petshop',?2,?3,?4,'inbound','customer','confirmo',?5)`)
      .bind(TENANT, crypto.randomUUID(), THREAD, confirmationSource, Date.now()).run()
    let call = 0
    const provider = {
      model: 'groq-test-model',
      async complete(input: { messages: readonly LunaMessage[] }): Promise<LunaProviderResponse & { requestLimit: number | null }> {
        call += 1
        if (call === 1) {
          expect(input.messages.some((message) => message.role === 'system' && message.content?.includes(proposal!.proposal_id))).toBe(true)
          return {
            content: null,
            toolCalls: [{ id: 'tool-confirm', type: 'function', function: { name: 'commit_confirmed_proposal', arguments: JSON.stringify(proposal) } }],
            usage: { promptTokens: 120, completionTokens: 20 },
            rateLimit: { remainingRequests: 900, remainingTokens: 7000, resetRequests: null, resetTokens: null },
            requestLimit: 1000,
          }
        }
        return {
          content: 'Pedido registrado e aguardando pagamento.', toolCalls: [],
          usage: { promptTokens: 140, completionTokens: 18 },
          rateLimit: { remainingRequests: 899, remainingTokens: 6900, resetRequests: null, resetTokens: null },
          requestLimit: 1000,
        }
      },
    }
    const result = await runLunaTurn({ database: testEnv.DB, provider, context: { ...context, sourceMessageId: confirmationSource, traceId: crypto.randomUUID() } })
    expect(result).toMatchObject({ status: 'replied', reply: 'Pedido registrado e aguardando pagamento.' })
    expect(result.committedOperationIds).toHaveLength(1)
  })

  it('confirma agendamento usando a transação operacional existente', async () => {
    const registry = createLunaToolRegistry(testEnv.DB)
    const scheduled = new Date(Date.now() + 7 * 24 * 60 * 60_000).toISOString()
    const prepared = await registry.execute('prepare_appointment', {
      customer_id: 'client-1', pet_id: 'pet-1', service_ids: ['service-1'], scheduled_at: scheduled, notes: null,
    }, { ...context, sourceMessageId: 'wamid.appointment-proposal' })
    const data = prepared.ok ? prepared.data as { proposal_id: string; proposal_version: number } : null
    expect(data).toBeTruthy()
    await testEnv.DB.prepare(`INSERT INTO chat_messages(tenant_id,module_id,id,thread_id,external_message_id,direction,actor_type,content_text,created_at_ms) VALUES(?1,'petshop',?2,?3,?4,'inbound','customer','pode agendar',?5)`)
      .bind(TENANT, crypto.randomUUID(), THREAD, 'wamid.appointment-confirm', Date.now()).run()
    const committed = await registry.execute('commit_confirmed_proposal', {
      proposal_id: data!.proposal_id, proposal_version: data!.proposal_version,
    }, { ...context, sourceMessageId: 'wamid.appointment-confirm' })
    expect(committed).toMatchObject({ ok: true, data: { operation_kind: 'appointment_create' } })
    const appointmentId = committed.ok ? String((committed.data as { operation_id: string }).operation_id) : ''
    const appointment = await testEnv.DB.prepare(`SELECT status,source,subtotal_cents FROM appointments WHERE tenant_id=?1 AND id=?2`).bind(TENANT, appointmentId).first<{ status: string; source: string; subtotal_cents: number }>()
    expect(appointment).toEqual({ status: 'scheduled', source: 'whatsapp', subtotal_cents: 5500 })
  })

  it('reagenda com confirmação posterior e controle otimista de versão', async () => {
    const registry = createLunaToolRegistry(testEnv.DB)
    const appointmentId = `appointment-reschedule-${crypto.randomUUID()}`
    const original = Date.now() + 20 * 24 * 60 * 60_000
    const target = Date.now() + 21 * 24 * 60 * 60_000
    await testEnv.DB.prepare(`
      INSERT INTO appointments(tenant_id,module_id,id,client_id,pet_id,scheduled_at_ms,duration_min,service_group,status,source,subtotal_cents,transport_fee_cents,notes,version,created_at_ms,updated_at_ms)
      VALUES(?1,'petshop',?2,'client-1','pet-1',?3,60,'banho_tosa','scheduled','whatsapp',5500,0,NULL,1,?4,?4)
    `).bind(TENANT, appointmentId, original, Date.now()).run()
    const prepared = await registry.execute('prepare_appointment_reschedule', {
      customer_id: 'client-1', appointment_id: appointmentId, scheduled_at: new Date(target).toISOString(),
    }, { ...context, sourceMessageId: 'wamid.reschedule-proposal' })
    const data = prepared.ok ? prepared.data as { proposal_id: string; proposal_version: number } : null
    expect(data).toBeTruthy()
    await testEnv.DB.prepare(`INSERT INTO chat_messages(tenant_id,module_id,id,thread_id,external_message_id,direction,actor_type,content_text,created_at_ms) VALUES(?1,'petshop',?2,?3,?4,'inbound','customer','confirmo',?5)`)
      .bind(TENANT, crypto.randomUUID(), THREAD, 'wamid.reschedule-confirm', Date.now()).run()
    const committed = await registry.execute('commit_confirmed_proposal', {
      proposal_id: data!.proposal_id, proposal_version: data!.proposal_version,
    }, { ...context, sourceMessageId: 'wamid.reschedule-confirm' })
    expect(committed).toMatchObject({ ok: true, data: { operation_kind: 'appointment_reschedule', operation_id: appointmentId } })
    const row = await testEnv.DB.prepare(`SELECT scheduled_at_ms,version FROM appointments WHERE tenant_id=?1 AND id=?2`).bind(TENANT, appointmentId).first<{ scheduled_at_ms: number; version: number }>()
    expect(row).toEqual({ scheduled_at_ms: target, version: 2 })
  })

  it('cancela somente após confirmação e dispara a liberação operacional', async () => {
    const registry = createLunaToolRegistry(testEnv.DB)
    const appointmentId = `appointment-cancel-${crypto.randomUUID()}`
    const scheduled = Date.now() + 30 * 24 * 60 * 60_000
    await testEnv.DB.prepare(`
      INSERT INTO appointments(tenant_id,module_id,id,client_id,pet_id,scheduled_at_ms,duration_min,service_group,status,source,subtotal_cents,transport_fee_cents,notes,version,created_at_ms,updated_at_ms)
      VALUES(?1,'petshop',?2,'client-1','pet-1',?3,60,'banho_tosa','confirmed','whatsapp',5500,0,NULL,1,?4,?4)
    `).bind(TENANT, appointmentId, scheduled, Date.now()).run()
    const prepared = await registry.execute('prepare_appointment_cancellation', {
      customer_id: 'client-1', appointment_id: appointmentId, reason: 'Não poderei comparecer',
    }, { ...context, sourceMessageId: 'wamid.cancel-proposal' })
    const data = prepared.ok ? prepared.data as { proposal_id: string; proposal_version: number } : null
    expect(data).toBeTruthy()
    await testEnv.DB.prepare(`INSERT INTO chat_messages(tenant_id,module_id,id,thread_id,external_message_id,direction,actor_type,content_text,created_at_ms) VALUES(?1,'petshop',?2,?3,?4,'inbound','customer','sim',?5)`)
      .bind(TENANT, crypto.randomUUID(), THREAD, 'wamid.cancel-confirm', Date.now()).run()
    const committed = await registry.execute('commit_confirmed_proposal', {
      proposal_id: data!.proposal_id, proposal_version: data!.proposal_version,
    }, { ...context, sourceMessageId: 'wamid.cancel-confirm' })
    expect(committed).toMatchObject({ ok: true, data: { operation_kind: 'appointment_cancel', status: 'cancelled' } })
    const row = await testEnv.DB.prepare(`SELECT status,version,notes FROM appointments WHERE tenant_id=?1 AND id=?2`).bind(TENANT, appointmentId).first<{ status: string; version: number; notes: string }>()
    expect(row).toMatchObject({ status: 'cancelled', version: 2 })
    expect(row?.notes).toContain('Cancelado pela Luna')
  })
})
