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
  it('keeps a chat without messages on the first page when the list asks for NULLS FIRST', async () => {
    const db = env.DB!
    const scope = { tenantId: crypto.randomUUID(), moduleId: 'petshop' }
    const now = Date.now()
    const ids = { old: crypto.randomUUID(), fresh: crypto.randomUUID() }
    for (const [id, last] of [[ids.old, now - 60_000], [ids.fresh, null]] as const) {
      const row = normalizeCompatChatSession({ id, customer_phone: id, channel: 'interno', status: 'bot' }, scope, id, now)
      await db.prepare(`INSERT INTO chat_threads
        (tenant_id,module_id,id,channel,external_thread_id,status,context_json,last_message_at_ms,created_at_ms,updated_at_ms)
        VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)`)
        .bind(row.tenant_id,row.module_id,row.id,row.channel,row.external_thread_id,row.status,row.context_json,last,row.created_at_ms,row.updated_at_ms)
        .run()
    }
    const config = { read: 'compat_chat_sessions', write: 'chat_threads' }
    const order = (nullsFirst: boolean) => selectRows(db, 'chat_sessions', config, { orders: [{ column: 'last_message_at', ascending: false, nullsFirst }], limit: 1 }, scope)
    expect((await order(true)).rows[0].id).toBe(ids.fresh)
    // Browsers read zone-less SQLite text as local time; reads must carry UTC.
    expect((await order(true)).rows[0].opened_at).toBe(new Date(Math.floor(now / 1000) * 1000).toISOString())
    expect((await order(false)).rows[0].id).toBe(ids.old)
    const since = (ms: number) => selectRows(db, 'chat_sessions', config, { filters: [{ op: 'or', expression: `last_message_at.gte.${new Date(ms).toISOString().slice(0, 19).replace('T', ' ')},opened_at.gte.${new Date(ms).toISOString().slice(0, 19).replace('T', ' ')}` }] }, scope)
    expect((await since(now - 3_600_000)).rows).toHaveLength(2)
    expect((await since(now + 3_600_000)).rows).toHaveLength(0)
  })
})
