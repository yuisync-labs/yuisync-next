import { env } from 'cloudflare:workers'
import { beforeEach, describe, expect, it } from 'vitest'

import { parseWhatsAppAccountConnectionV1 } from '../../../shared/contracts/v1/index'
import { D1WhatsAppConnectionRepository } from '../src/adapters/d1WhatsAppConnectionRepository'
import {
  extractWhatsappEvents,
  handleWhatsappApiRequest,
  verifyMetaSignature,
  type WhatsappRuntimeBindings,
} from '../src/whatsappApi'

const testEnv = env as EdgeEnv & { DB: D1Database }
const APP_SECRET = 'meta-app-secret-test'
const VERIFY_TOKEN = 'verify-token-test'
const TENANT_A = 'tenant-whatsapp-test-a'
const TENANT_B = 'tenant-whatsapp-test-b'
const BUSINESS_A = '100000000000001'
const BUSINESS_B = '100000000000002'
const WABA_A = '200000000000001'
const WABA_B = '200000000000002'
const PHONE_A = '300000000000001'
const PHONE_B = '300000000000002'

function hex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((value) => value.toString(16).padStart(2, '0')).join('')
}

async function signature(raw: ArrayBuffer): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(APP_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  return `sha256=${hex(await crypto.subtle.sign('HMAC', key, raw))}`
}

function bindings(database: D1Database): WhatsappRuntimeBindings {
  return {
    DB: database,
    WHATSAPP_VERIFY_TOKEN: VERIFY_TOKEN,
    WHATSAPP_APP_SECRET: APP_SECRET,
  }
}

function webhookPayload(input: Readonly<{
  wabaId?: string
  phoneNumberId?: string
  messageId?: string
  from?: string
  text?: string
}> = {}) {
  const from = input.from ?? '5532985205279'
  return {
    object: 'whatsapp_business_account',
    entry: [{
      id: input.wabaId ?? WABA_A,
      changes: [{
        field: 'messages',
        value: {
          metadata: { phone_number_id: input.phoneNumberId ?? PHONE_A },
          contacts: [{ wa_id: from, profile: { name: 'Cliente Teste' } }],
          messages: [{
            from,
            id: input.messageId ?? 'wamid.test-001',
            timestamp: '1786723200',
            type: 'text',
            text: { body: input.text ?? 'Quero agendar um banho' },
          }],
        },
      }],
    }],
  }
}

async function signedRequest(payload: unknown): Promise<Request> {
  const body = JSON.stringify(payload)
  const raw = new TextEncoder().encode(body).buffer
  return new Request('https://edge.test/api/whatsapp/webhook', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-hub-signature-256': await signature(raw),
    },
    body,
  })
}

async function seedTenant(tenantId: string): Promise<void> {
  const now = 1_786_966_000_000
  await testEnv.DB.batch([
    testEnv.DB.prepare(`
      INSERT OR REPLACE INTO tenants(id,slug,name,status,created_at_ms,updated_at_ms)
      VALUES(?1,?2,?3,'active',?4,?4)
    `).bind(tenantId, tenantId, tenantId, now),
    testEnv.DB.prepare(`
      INSERT OR REPLACE INTO tenant_module_settings(
        tenant_id,module_id,store_name,store_phone,store_address,store_neighborhood,store_city,bot_prompt,version,created_at_ms,updated_at_ms
      ) VALUES(?1,'petshop','','','','','','',1,?2,?2)
    `).bind(tenantId, now),
  ])
}

async function seedConnections(): Promise<void> {
  const repository = new D1WhatsAppConnectionRepository(testEnv.DB, () => 1_786_966_100_000)
  await repository.save(parseWhatsAppAccountConnectionV1({
    type: 'whatsapp_account_connection',
    version: 1,
    tenant_id: TENANT_A,
    business_id: BUSINESS_A,
    waba_id: WABA_A,
    phone_number_id: PHONE_A,
    status: 'connected',
  }))
  await repository.save(parseWhatsAppAccountConnectionV1({
    type: 'whatsapp_account_connection',
    version: 1,
    tenant_id: TENANT_B,
    business_id: BUSINESS_B,
    waba_id: WABA_B,
    phone_number_id: PHONE_B,
    status: 'connected',
  }))
}

beforeEach(async () => {
  await testEnv.DB.prepare('DELETE FROM whatsapp_ingress_receipts WHERE tenant_id IN (?1,?2)').bind(TENANT_A, TENANT_B).run()
  await testEnv.DB.prepare('DELETE FROM chat_messages WHERE tenant_id IN (?1,?2)').bind(TENANT_A, TENANT_B).run()
  await testEnv.DB.prepare('DELETE FROM chat_threads WHERE tenant_id IN (?1,?2)').bind(TENANT_A, TENANT_B).run()
  await testEnv.DB.prepare('DELETE FROM whatsapp_phone_connections WHERE tenant_id IN (?1,?2)').bind(TENANT_A, TENANT_B).run()
  await testEnv.DB.prepare('DELETE FROM whatsapp_waba_accounts WHERE tenant_id IN (?1,?2)').bind(TENANT_A, TENANT_B).run()
  await testEnv.DB.prepare('DELETE FROM tenant_module_settings WHERE tenant_id IN (?1,?2)').bind(TENANT_A, TENANT_B).run()
  await testEnv.DB.prepare('DELETE FROM tenants WHERE id IN (?1,?2)').bind(TENANT_A, TENANT_B).run()
  await seedTenant(TENANT_A)
  await seedTenant(TENANT_B)
  await seedConnections()
})

describe('Cloudflare-native WhatsApp transport', () => {
  it('valida assinatura HMAC SHA-256 com Web Crypto sobre o raw body', async () => {
    const raw = new TextEncoder().encode(JSON.stringify(webhookPayload())).buffer
    expect(await verifyMetaSignature(raw, await signature(raw), APP_SECRET)).toBe(true)
    expect(await verifyMetaSignature(raw, 'sha256=' + '0'.repeat(64), APP_SECRET)).toBe(false)
  })

  it('extrai WABA, mensagem, contato e phone number id do payload da Meta', () => {
    expect(extractWhatsappEvents(webhookPayload())).toEqual([expect.objectContaining({
      wabaId: WABA_A,
      phoneNumberId: PHONE_A,
      from: '5532985205279',
      messageId: 'wamid.test-001',
      type: 'text',
      text: 'Quero agendar um banho',
      profileName: 'Cliente Teste',
    })])
  })

  it('responde ao challenge somente com verify token correto', async () => {
    const accepted = await handleWhatsappApiRequest(
      new Request(`https://edge.test/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=${VERIFY_TOKEN}&hub.challenge=123456`),
      bindings(testEnv.DB),
    )
    expect(accepted?.status).toBe(200)
    expect(await accepted?.text()).toBe('123456')

    const rejected = await handleWhatsappApiRequest(
      new Request('https://edge.test/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=123456'),
      bindings(testEnv.DB),
    )
    expect(rejected?.status).toBe(403)
  })

  it('persiste webhook uma vez e reconhece retry antes de repetir efeitos', async () => {
    const runtime = bindings(testEnv.DB)
    const payload = webhookPayload()

    const first = await handleWhatsappApiRequest(await signedRequest(payload), runtime)
    expect(first?.status).toBe(200)
    expect(await first?.json()).toMatchObject({
      ok: true,
      processed: 1,
      results: [{ accepted: true, message_id: 'wamid.test-001' }],
    })

    const firstReceipt = await testEnv.DB.prepare(`
      SELECT claim_token FROM whatsapp_ingress_receipts
      WHERE tenant_id=?1 AND module_id='petshop' AND provider_message_id='wamid.test-001'
    `).bind(TENANT_A).first<{ claim_token: string }>()
    expect(firstReceipt?.claim_token).toBeTruthy()

    const second = await handleWhatsappApiRequest(await signedRequest(payload), runtime)
    expect(second?.status).toBe(200)
    expect(await second?.json()).toMatchObject({
      ok: true,
      processed: 1,
      results: [{ duplicate: true, message_id: 'wamid.test-001' }],
    })

    const counts = await testEnv.DB.prepare(`
      SELECT
        (SELECT count(*) FROM whatsapp_ingress_receipts WHERE tenant_id=?1 AND provider_message_id='wamid.test-001') AS receipts,
        (SELECT count(*) FROM chat_messages WHERE tenant_id=?1 AND external_message_id='wamid.test-001') AS messages
    `).bind(TENANT_A).first<{ receipts: number; messages: number }>()
    expect(counts).toEqual({ receipts: 1, messages: 1 })
    const finalReceipt = await testEnv.DB.prepare(`
      SELECT claim_token FROM whatsapp_ingress_receipts
      WHERE tenant_id=?1 AND module_id='petshop' AND provider_message_id='wamid.test-001'
    `).bind(TENANT_A).first<{ claim_token: string }>()
    expect(finalReceipt?.claim_token).toBe(firstReceipt?.claim_token)
  })

  it('rejeita assinatura inválida antes de consultar ou persistir tenant', async () => {
    const response = await handleWhatsappApiRequest(new Request('https://edge.test/api/whatsapp/webhook', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-hub-signature-256': `sha256=${'0'.repeat(64)}` },
      body: JSON.stringify(webhookPayload()),
    }), bindings(testEnv.DB))
    expect(response?.status).toBe(401)

    const count = await testEnv.DB.prepare('SELECT count(*) AS count FROM whatsapp_ingress_receipts WHERE tenant_id=?1')
      .bind(TENANT_A).first<{ count: number }>()
    expect(count?.count).toBe(0)
  })

  it('faz ACK seguro para phone_number_id desconhecido sem efeito no chat', async () => {
    const response = await handleWhatsappApiRequest(await signedRequest(webhookPayload({
      phoneNumberId: '399999999999999',
      messageId: 'wamid.unknown-phone',
    })), bindings(testEnv.DB))

    expect(response?.status).toBe(200)
    expect(await response?.json()).toMatchObject({
      results: [{ ignored: true, reason: 'unknown_phone_number_id', message_id: 'wamid.unknown-phone' }],
    })
    const stored = await testEnv.DB.prepare('SELECT id FROM chat_messages WHERE external_message_id=?1')
      .bind('wamid.unknown-phone').first()
    expect(stored).toBeNull()
  })

  it('não aceita phone_number_id válido quando o WABA do envelope não corresponde', async () => {
    const response = await handleWhatsappApiRequest(await signedRequest(webhookPayload({
      wabaId: WABA_B,
      phoneNumberId: PHONE_A,
      messageId: 'wamid.waba-mismatch',
    })), bindings(testEnv.DB))

    expect(response?.status).toBe(200)
    expect(await response?.json()).toMatchObject({
      results: [{ ignored: true, reason: 'waba_mismatch' }],
    })
  })

  it('mantém dois tenants isolados pelo phone_number_id sem qualquer binding global de tenant ou número', async () => {
    const runtime = bindings(testEnv.DB)

    const first = await handleWhatsappApiRequest(await signedRequest(webhookPayload({
      wabaId: WABA_A,
      phoneNumberId: PHONE_A,
      messageId: 'wamid.tenant-a',
      from: '5532000000001',
      text: 'Mensagem A',
    })), runtime)
    const second = await handleWhatsappApiRequest(await signedRequest(webhookPayload({
      wabaId: WABA_B,
      phoneNumberId: PHONE_B,
      messageId: 'wamid.tenant-b',
      from: '5532000000002',
      text: 'Mensagem B',
    })), runtime)

    expect(first?.status).toBe(200)
    expect(second?.status).toBe(200)

    const rows = await testEnv.DB.prepare(`
      SELECT tenant_id,external_message_id,content_text
      FROM chat_messages
      WHERE external_message_id IN ('wamid.tenant-a','wamid.tenant-b')
      ORDER BY external_message_id ASC
    `).all<{ tenant_id: string; external_message_id: string; content_text: string }>()

    expect(rows.results).toEqual([
      { tenant_id: TENANT_A, external_message_id: 'wamid.tenant-a', content_text: 'Mensagem A' },
      { tenant_id: TENANT_B, external_message_id: 'wamid.tenant-b', content_text: 'Mensagem B' },
    ])
  })
})
