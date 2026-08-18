import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'

import { normalizeCompatChatSession } from '../src/compatApiRuntime.js'

const db = (env as EdgeEnv & { DB: D1Database }).DB

async function seedTenant(prefix: string) {
  const suffix = crypto.randomUUID()
  const tenantId = `${prefix}-${suffix}`
  const now = Date.now()
  await db.prepare("INSERT INTO tenants(id,slug,name,status,created_at_ms,updated_at_ms) VALUES(?1,?2,?3,'active',?4,?4)")
    .bind(tenantId, `${prefix}-${suffix}`, `${prefix} test`, now).run()
  return { tenantId, now }
}

async function cleanupTenant(tenantId: string) {
  await db.prepare("DELETE FROM chat_messages WHERE tenant_id=?1 AND module_id='petshop'").bind(tenantId).run()
  await db.prepare("DELETE FROM chat_threads WHERE tenant_id=?1 AND module_id='petshop'").bind(tenantId).run()
  await db.prepare("DELETE FROM cash_register WHERE tenant_id=?1 AND module_id='petshop'").bind(tenantId).run()
  await db.prepare('DELETE FROM tenants WHERE id=?1').bind(tenantId).run()
}

describe('active PetShop tab integration schema v30', () => {
  it('exposes the latest schema version', async () => {
    const row = await db.prepare("SELECT value FROM _yuisync_system_metadata WHERE key='schema_version'")
      .first<{ value: string }>()
    expect(row?.value).toBe('30')
  })

  it('round-trips canonical chat thread state through the legacy dashboard projection', async () => {
    const { tenantId, now } = await seedTenant('chat-v30')
    const threadId = `thread-${crypto.randomUUID()}`
    try {
      await db.prepare(`
        INSERT INTO chat_threads(
          tenant_id,module_id,id,channel,external_thread_id,status,last_message_at_ms,
          created_at_ms,updated_at_ms,customer_name,intent,assigned_staff_key,csat_score,closed_at_ms,context_json
        ) VALUES(?1,'petshop',?2,'web','5532999999999','open',?3,?3,?3,'Maria','banho','staff-1',5,NULL,?4)
      `).bind(tenantId, threadId, now, JSON.stringify({ legacy_channel: 'instagram', petbot: { stage: 'collecting' } })).run()

      const row = await db.prepare(`
        SELECT customer_phone,customer_name,channel,status,intent,employee_id,csat_score,context,opened_at,closed_at
        FROM compat_chat_sessions
        WHERE tenant_id=?1 AND module_id='petshop' AND id=?2
      `).bind(tenantId, threadId).first<{
        customer_phone: string
        customer_name: string
        channel: string
        status: string
        intent: string
        employee_id: string
        csat_score: number
        context: string
        opened_at: string
        closed_at: string | null
      }>()

      expect(row).toMatchObject({
        customer_phone: '5532999999999',
        customer_name: 'Maria',
        channel: 'instagram',
        status: 'bot',
        intent: 'banho',
        employee_id: 'staff-1',
        csat_score: 5,
        closed_at: null,
      })
      expect(JSON.parse(String(row?.context || '{}'))).toEqual({ legacy_channel: 'instagram', petbot: { stage: 'collecting' } })
      expect(Number.isNaN(Date.parse(String(row?.opened_at)))).toBe(false)
    } finally {
      await cleanupTenant(tenantId)
    }
  })

  it('projects message metadata, token count, turn version and sent_at for the active Chat UI', async () => {
    const { tenantId, now } = await seedTenant('message-v30')
    const threadId = `thread-${crypto.randomUUID()}`
    const messageId = `message-${crypto.randomUUID()}`
    try {
      await db.batch([
        db.prepare(`
          INSERT INTO chat_threads(tenant_id,module_id,id,channel,status,created_at_ms,updated_at_ms)
          VALUES(?1,'petshop',?2,'internal','open',?3,?3)
        `).bind(tenantId, threadId, now),
        db.prepare(`
          INSERT INTO chat_messages(
            tenant_id,module_id,id,thread_id,direction,actor_type,content_text,content_json,created_at_ms
          ) VALUES(?1,'petshop',?2,?3,'outbound','assistant','Olá',?4,?5)
        `).bind(tenantId, messageId, threadId, JSON.stringify({ tokens_used: 42, dashboard_turn_version: 7, source: 'test' }), now),
      ])

      const row = await db.prepare(`
        SELECT session_id,role,content,metadata,tokens_used,dashboard_turn_version,sent_at
        FROM compat_chat_messages
        WHERE tenant_id=?1 AND module_id='petshop' AND id=?2
      `).bind(tenantId, messageId).first<{
        session_id: string
        role: string
        content: string
        metadata: string
        tokens_used: number
        dashboard_turn_version: number
        sent_at: string
      }>()

      expect(row).toMatchObject({
        session_id: threadId,
        role: 'assistant',
        content: 'Olá',
        tokens_used: 42,
        dashboard_turn_version: 7,
      })
      expect(JSON.parse(String(row?.metadata || '{}'))).toEqual({ tokens_used: 42, dashboard_turn_version: 7, source: 'test' })
      expect(Number.isNaN(Date.parse(String(row?.sent_at)))).toBe(false)
    } finally {
      await cleanupTenant(tenantId)
    }
  })

  it('normalizes legacy Chat writes into canonical D1 values without losing UI state', () => {
    const bot = normalizeCompatChatSession({
      id: 'chat-1',
      status: 'bot',
      channel: 'instagram',
      customer_phone: '5532999999999',
      customer_name: 'Ana',
      intent: 'consulta',
      employee_id: 'staff-2',
      csat_score: 5,
      context: { source: 'dashboard' },
      opened_at: '2026-08-18T10:00:00.000Z',
    }, { tenantId: 'tenant-1', moduleId: 'petshop' }, 'chat-1', Date.parse('2026-08-18T10:00:00.000Z'))

    expect(bot).toMatchObject({
      tenant_id: 'tenant-1',
      module_id: 'petshop',
      id: 'chat-1',
      channel: 'web',
      external_thread_id: '5532999999999',
      customer_name: 'Ana',
      status: 'open',
      intent: 'consulta',
      assigned_staff_key: 'staff-2',
      csat_score: 5,
    })
    expect(JSON.parse(bot.context_json)).toEqual({ source: 'dashboard', legacy_channel: 'instagram' })

    const human = normalizeCompatChatSession({ status: 'human', channel: 'interno' }, { tenantId: 'tenant-1', moduleId: 'petshop' }, 'chat-2', 1)
    expect(human).toMatchObject({ status: 'handoff', channel: 'internal' })

    const closed = normalizeCompatChatSession({ status: 'closed', channel: 'whatsapp' }, { tenantId: 'tenant-1', moduleId: 'petshop' }, 'chat-3', 1)
    expect(closed).toMatchObject({ status: 'closed', channel: 'whatsapp' })
  })

  it('prevents a second open cash register and allows a new one after close', async () => {
    const { tenantId, now } = await seedTenant('cash-v30')
    const firstId = `cash-${crypto.randomUUID()}`
    const secondId = `cash-${crypto.randomUUID()}`
    try {
      await db.prepare(`
        INSERT INTO cash_register(tenant_id,module_id,id,opening_balance_cents,opened_at_ms)
        VALUES(?1,'petshop',?2,1000,?3)
      `).bind(tenantId, firstId, now).run()

      let duplicateError: unknown = null
      try {
        await db.prepare(`
          INSERT INTO cash_register(tenant_id,module_id,id,opening_balance_cents,opened_at_ms)
          VALUES(?1,'petshop',?2,2000,?3)
        `).bind(tenantId, secondId, now + 1).run()
      } catch (error) {
        duplicateError = error
      }
      expect(String(duplicateError)).toContain('CASH_REGISTER_ALREADY_OPEN')

      await db.prepare(`
        UPDATE cash_register SET closed_at_ms=?3,closing_balance_cents=1000
        WHERE tenant_id=?1 AND module_id='petshop' AND id=?2
      `).bind(tenantId, firstId, now + 2).run()

      await expect(db.prepare(`
        INSERT INTO cash_register(tenant_id,module_id,id,opening_balance_cents,opened_at_ms)
        VALUES(?1,'petshop',?2,2000,?3)
      `).bind(tenantId, secondId, now + 3).run()).resolves.toBeDefined()
    } finally {
      await cleanupTenant(tenantId)
    }
  })
})
