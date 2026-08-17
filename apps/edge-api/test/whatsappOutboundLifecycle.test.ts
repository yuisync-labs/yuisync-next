import { env } from 'cloudflare:workers'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { D1EncryptedWhatsAppCredentialVault } from '../src/adapters/d1EncryptedWhatsAppCredentialVault'
import { D1WhatsAppConnectionRepository } from '../src/adapters/d1WhatsAppConnectionRepository'
import {
  applyWhatsAppDeliveryStatus,
  sendWhatsAppOutboundText,
} from '../src/whatsappOutboundService'

const testEnv = env as EdgeEnv & { DB: D1Database }
const TENANT_A = 'tenant-wa-outbound-a'
const TENANT_B = 'tenant-wa-outbound-b'
const MODULE = 'petshop'
const PHONE_A = '112233445566778'
const PHONE_A_2 = '112233445566779'
const PHONE_B = '998877665544332'
const KEY = '11'.repeat(32)

async function seedTenant(id: string): Promise<void> {
  const now = 1_786_970_000_000
  await testEnv.DB.batch([
    testEnv.DB.prepare(`
      INSERT OR REPLACE INTO tenants(id,slug,name,status,created_at_ms,updated_at_ms)
      VALUES(?1,?2,?3,'active',?4,?4)
    `).bind(id, id, id, now),
    testEnv.DB.prepare(`
      INSERT OR REPLACE INTO tenant_module_settings(
        tenant_id,module_id,store_name,version,created_at_ms,updated_at_ms
      ) VALUES(?1,?2,?3,1,?4,?4)
    `).bind(id, MODULE, id, now),
  ])
}

async function connect(input: {
  tenantId: string
  phoneNumberId: string
  wabaId: string
  businessId: string
}): Promise<void> {
  const repository = new D1WhatsAppConnectionRepository(testEnv.DB, () => 1_786_970_010_000)
  await repository.save({
    type: 'whatsapp_account_connection',
    version: 1,
    tenant_id: input.tenantId,
    business_id: input.businessId,
    waba_id: input.wabaId,
    phone_number_id: input.phoneNumberId,
    display_phone_number: '+55 32 99999-9999',
    verified_name: input.tenantId,
    status: 'connected',
  })
  const vault = new D1EncryptedWhatsAppCredentialVault(testEnv.DB, KEY, () => 1_786_970_020_000)
  await vault.save({
    tenantId: input.tenantId,
    phoneNumberId: input.phoneNumberId,
    accessToken: `token-${input.phoneNumberId}`,
  })
}

beforeEach(async () => {
  await testEnv.DB.prepare(`DELETE FROM whatsapp_delivery_receipts WHERE tenant_id IN (?1,?2)`).bind(TENANT_A, TENANT_B).run()
  await testEnv.DB.prepare(`DELETE FROM whatsapp_outbound_messages WHERE tenant_id IN (?1,?2)`).bind(TENANT_A, TENANT_B).run()
  await testEnv.DB.prepare(`DELETE FROM whatsapp_access_credentials WHERE tenant_id IN (?1,?2)`).bind(TENANT_A, TENANT_B).run()
  await testEnv.DB.prepare(`DELETE FROM whatsapp_ingress_receipts WHERE tenant_id IN (?1,?2)`).bind(TENANT_A, TENANT_B).run()
  await testEnv.DB.prepare(`DELETE FROM chat_messages WHERE tenant_id IN (?1,?2)`).bind(TENANT_A, TENANT_B).run()
  await testEnv.DB.prepare(`DELETE FROM chat_threads WHERE tenant_id IN (?1,?2)`).bind(TENANT_A, TENANT_B).run()
  await testEnv.DB.prepare(`DELETE FROM whatsapp_phone_connections WHERE tenant_id IN (?1,?2)`).bind(TENANT_A, TENANT_B).run()
  await testEnv.DB.prepare(`DELETE FROM whatsapp_waba_accounts WHERE tenant_id IN (?1,?2)`).bind(TENANT_A, TENANT_B).run()
  await testEnv.DB.prepare(`DELETE FROM tenant_module_settings WHERE tenant_id IN (?1,?2)`).bind(TENANT_A, TENANT_B).run()
  await testEnv.DB.prepare(`DELETE FROM tenants WHERE id IN (?1,?2)`).bind(TENANT_A, TENANT_B).run()
  await seedTenant(TENANT_A)
  await seedTenant(TENANT_B)
  await connect({ tenantId: TENANT_A, phoneNumberId: PHONE_A, wabaId: 'waba-outbound-a', businessId: 'business-outbound-a' })
  await connect({ tenantId: TENANT_B, phoneNumberId: PHONE_B, wabaId: 'waba-outbound-b', businessId: 'business-outbound-b' })
})

afterEach(() => {
  vi.restoreAllMocks()
})

function sendInput(overrides: Record<string, unknown> = {}) {
  return {
    tenantId: TENANT_A,
    moduleId: MODULE,
    conversationId: 'wa:5532999999999',
    to: '+5532999999999',
    body: 'Mensagem pelo caminho unificado',
    idempotencyKey: 'wa-outbound-idempotency-001',
    actorType: 'human' as const,
    ...overrides,
  }
}

describe('WhatsApp outbound lifecycle', () => {
  it('envia uma única vez para a Meta quando a mesma idempotency key é repetida', async () => {
    const graph = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json({ messages: [{ id: 'wamid.outbound-001' }] }),
    )
    let clock = 1_786_970_100_000
    const now = () => (clock += 10)
    const bindings = { DB: testEnv.DB, WHATSAPP_CREDENTIAL_ENCRYPTION_KEY: KEY }

    const first = await sendWhatsAppOutboundText(bindings, sendInput(), now)
    const second = await sendWhatsAppOutboundText(bindings, sendInput(), now)

    expect(first.status).toBe('submitted')
    expect(first.provider_message_id).toBe('wamid.outbound-001')
    expect(second).toMatchObject({
      status: 'submitted',
      provider_message_id: 'wamid.outbound-001',
      idempotency_key: 'wa-outbound-idempotency-001',
    })
    expect(graph).toHaveBeenCalledTimes(1)

    const outboundCount = await testEnv.DB.prepare(`
      SELECT COUNT(*) AS count FROM whatsapp_outbound_messages WHERE tenant_id=?1
    `).bind(TENANT_A).first<{ count: number }>()
    const chatCount = await testEnv.DB.prepare(`
      SELECT COUNT(*) AS count FROM chat_messages WHERE tenant_id=?1 AND direction='outbound'
    `).bind(TENANT_A).first<{ count: number }>()
    expect(outboundCount?.count).toBe(1)
    expect(chatCount?.count).toBe(1)
  })

  it('exige seleção explícita quando o tenant possui mais de um número conectado', async () => {
    await connect({ tenantId: TENANT_A, phoneNumberId: PHONE_A_2, wabaId: 'waba-outbound-a', businessId: 'business-outbound-a' })
    const graph = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ messages: [{ id: 'wamid.never' }] }))

    await expect(sendWhatsAppOutboundText(
      { DB: testEnv.DB, WHATSAPP_CREDENTIAL_ENCRYPTION_KEY: KEY },
      sendInput({ idempotencyKey: 'wa-outbound-ambiguous' }),
    )).rejects.toMatchObject({ code: 'WHATSAPP_OUTBOUND_PHONE_SELECTION_REQUIRED' })
    expect(graph).not.toHaveBeenCalled()
  })

  it('não permite usar um phone_number_id pertencente a outro tenant', async () => {
    const graph = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ messages: [{ id: 'wamid.never' }] }))

    await expect(sendWhatsAppOutboundText(
      { DB: testEnv.DB, WHATSAPP_CREDENTIAL_ENCRYPTION_KEY: KEY },
      sendInput({ idempotencyKey: 'wa-outbound-cross-tenant', phoneNumberId: PHONE_B }),
    )).rejects.toMatchObject({ code: 'WHATSAPP_OUTBOUND_PHONE_NOT_FOUND' })
    expect(graph).not.toHaveBeenCalled()
  })

  it('avança submitted -> sent -> delivered -> read e ignora webhook atrasado', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ messages: [{ id: 'wamid.lifecycle-001' }] }))
    const bindings = { DB: testEnv.DB, WHATSAPP_CREDENTIAL_ENCRYPTION_KEY: KEY }
    await sendWhatsAppOutboundText(bindings, sendInput({ idempotencyKey: 'wa-lifecycle-001' }))

    await expect(applyWhatsAppDeliveryStatus(bindings, {
      tenantId: TENANT_A,
      moduleId: MODULE,
      wabaId: 'waba-outbound-a',
      phoneNumberId: PHONE_A,
      providerMessageId: 'wamid.lifecycle-001',
      status: 'sent',
      providerTimestampMs: 1_786_970_200_000,
    })).resolves.toMatchObject({ updated: true, status: 'sent' })

    await expect(applyWhatsAppDeliveryStatus(bindings, {
      tenantId: TENANT_A,
      moduleId: MODULE,
      wabaId: 'waba-outbound-a',
      phoneNumberId: PHONE_A,
      providerMessageId: 'wamid.lifecycle-001',
      status: 'read',
      providerTimestampMs: 1_786_970_400_000,
    })).resolves.toMatchObject({ updated: true, status: 'read' })

    await expect(applyWhatsAppDeliveryStatus(bindings, {
      tenantId: TENANT_A,
      moduleId: MODULE,
      wabaId: 'waba-outbound-a',
      phoneNumberId: PHONE_A,
      providerMessageId: 'wamid.lifecycle-001',
      status: 'delivered',
      providerTimestampMs: 1_786_970_300_000,
    })).resolves.toMatchObject({ updated: false, reason: 'stale_timestamp', status: 'read' })

    const row = await testEnv.DB.prepare(`
      SELECT status,last_provider_status_at_ms FROM whatsapp_outbound_messages
      WHERE tenant_id=?1 AND idempotency_key='wa-lifecycle-001'
    `).bind(TENANT_A).first<{ status: string; last_provider_status_at_ms: number }>()
    expect(row).toEqual({ status: 'read', last_provider_status_at_ms: 1_786_970_400_000 })
  })

  it('persiste failed e não deixa status normal sobrescrever falha terminal', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ messages: [{ id: 'wamid.failed-001' }] }))
    const bindings = { DB: testEnv.DB, WHATSAPP_CREDENTIAL_ENCRYPTION_KEY: KEY }
    await sendWhatsAppOutboundText(bindings, sendInput({ idempotencyKey: 'wa-failed-001' }))

    await expect(applyWhatsAppDeliveryStatus(bindings, {
      tenantId: TENANT_A,
      moduleId: MODULE,
      wabaId: 'waba-outbound-a',
      phoneNumberId: PHONE_A,
      providerMessageId: 'wamid.failed-001',
      status: 'failed',
      providerTimestampMs: 1_786_970_500_000,
      errorCode: '131047',
    })).resolves.toMatchObject({ updated: true, status: 'failed' })

    await expect(applyWhatsAppDeliveryStatus(bindings, {
      tenantId: TENANT_A,
      moduleId: MODULE,
      wabaId: 'waba-outbound-a',
      phoneNumberId: PHONE_A,
      providerMessageId: 'wamid.failed-001',
      status: 'sent',
      providerTimestampMs: 1_786_970_600_000,
    })).resolves.toMatchObject({ updated: false, reason: 'terminal_failed', status: 'failed' })
  })
})
