import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'
import { normalizeCompatChatSession, selectRows } from '../src/compatApiRuntime.js'

describe('D1 chat creation compatibility', () => {
  it('can select the newly created chat even when a tenant has other chats', async () => {
    const db = env.DB!
    const scope = { tenantId: crypto.randomUUID(), moduleId: 'petshop' }
    const firstId = crypto.randomUUID()
    const secondId = crypto.randomUUID()
    const now = Date.now()
    for (const [id, name] of [[firstId, 'Primeiro teste'], [secondId, 'Segundo teste']]) {
      const row = normalizeCompatChatSession({
        id,
        customer_name: name,
        customer_phone: id,
        channel: 'interno',
        status: 'bot',
      }, scope, id, now)
      expect(row.status).toBe('open')
      expect(row.channel).toBe('internal')
      await db.prepare(`INSERT INTO chat_threads
        (tenant_id,module_id,id,channel,external_thread_id,client_id,pet_id,customer_name,status,intent,assigned_staff_key,csat_score,closed_at_ms,context_json,last_message_at_ms,created_at_ms,updated_at_ms)
        VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17)`)
        .bind(row.tenant_id,row.module_id,row.id,row.channel,row.external_thread_id,row.client_id,row.pet_id,row.customer_name,row.status,row.intent,row.assigned_staff_key,row.csat_score,row.closed_at_ms,row.context_json,row.last_message_at_ms,row.created_at_ms,row.updated_at_ms)
        .run()
    }
    const config = { read: 'compat_chat_sessions', write: 'chat_threads' }
    const unfiltered = await selectRows(db, 'chat_sessions', config, {}, scope)
    expect(unfiltered.rows).toHaveLength(2)
    const selected = await selectRows(db, 'chat_sessions', config, {
      filters: [{ op: 'eq', column: 'id', value: secondId }],
      columns: 'id,customer_name',
    }, scope)
    expect(selected.rows).toHaveLength(1)
    expect(selected.rows[0]).toMatchObject({ id: secondId, customer_name: 'Segundo teste', status: 'bot' })
    const differentTenant = await selectRows(db, 'chat_sessions', config, {
      filters: [{ op: 'eq', column: 'id', value: secondId }],
    }, { tenantId: crypto.randomUUID(), moduleId: scope.moduleId })
    expect(differentTenant.rows).toHaveLength(0)
  })
})
