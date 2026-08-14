import { describe, expect, it } from 'vitest'

import {
  extractWhatsappEvents,
  handleWhatsappApiRequest,
  verifyMetaSignature,
  type WhatsappRuntimeBindings,
} from '../src/whatsappApi'

const APP_SECRET = 'meta-app-secret-test'
const VERIFY_TOKEN = 'verify-token-test'
const TENANT_ID = 'tenant-whatsapp-test'
const PHONE_ID = 'phone-number-id-test'

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

type FakeStatement = { sql: string; args: unknown[]; bind: (...args: unknown[]) => FakeStatement; first: <T>() => Promise<T | null> }

function fakeDatabase() {
  const externalIds = new Set<string>()
  const prepare = (sql: string): FakeStatement => {
    const statement: FakeStatement = {
      sql,
      args: [],
      bind(...args: unknown[]) { statement.args = args; return statement },
      async first<T>() {
        if (sql.includes('FROM tenants')) return { id: TENANT_ID } as T
        if (sql.includes('FROM chat_messages')) {
          const externalId = String(statement.args[2] || '')
          return externalIds.has(externalId) ? ({ id: `stored:${externalId}` } as T) : null
        }
        return null
      },
    }
    return statement
  }
  const database = {
    prepare,
    async batch(statements: FakeStatement[]) {
      for (const statement of statements) {
        if (statement.sql.includes('INSERT OR IGNORE INTO chat_messages')) {
          externalIds.add(String(statement.args[4] || ''))
        }
      }
      return statements.map(() => ({ success: true }))
    },
  } as unknown as D1Database
  return { database, externalIds }
}

function bindings(database: D1Database): WhatsappRuntimeBindings {
  return {
    DB: database,
    WHATSAPP_VERIFY_TOKEN: VERIFY_TOKEN,
    WHATSAPP_APP_SECRET: APP_SECRET,
    WHATSAPP_PHONE_NUMBER_ID: PHONE_ID,
    WHATSAPP_TENANT_ID: TENANT_ID,
    WHATSAPP_MODULE_ID: 'petshop',
  } as WhatsappRuntimeBindings
}

function webhookPayload() {
  return {
    object: 'whatsapp_business_account',
    entry: [{
      changes: [{
        field: 'messages',
        value: {
          metadata: { phone_number_id: PHONE_ID },
          contacts: [{ wa_id: '5532985205279', profile: { name: 'Cliente Teste' } }],
          messages: [{
            from: '5532985205279',
            id: 'wamid.test-001',
            timestamp: '1786723200',
            type: 'text',
            text: { body: 'Quero agendar um banho' },
          }],
        },
      }],
    }],
  }
}

describe('Cloudflare-native WhatsApp transport', () => {
  it('valida assinatura HMAC SHA-256 com Web Crypto', async () => {
    const raw = new TextEncoder().encode(JSON.stringify(webhookPayload())).buffer
    expect(await verifyMetaSignature(raw, await signature(raw), APP_SECRET)).toBe(true)
    expect(await verifyMetaSignature(raw, 'sha256=' + '0'.repeat(64), APP_SECRET)).toBe(false)
  })

  it('extrai mensagem, contato e phone number id do payload da Meta', () => {
    expect(extractWhatsappEvents(webhookPayload())).toEqual([expect.objectContaining({
      phoneNumberId: PHONE_ID,
      from: '5532985205279',
      messageId: 'wamid.test-001',
      type: 'text',
      text: 'Quero agendar um banho',
      profileName: 'Cliente Teste',
    })])
  })

  it('responde ao challenge somente com verify token correto', async () => {
    const { database } = fakeDatabase()
    const accepted = await handleWhatsappApiRequest(
      new Request(`https://edge.test/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=${VERIFY_TOKEN}&hub.challenge=123456`),
      bindings(database),
    )
    expect(accepted?.status).toBe(200)
    expect(await accepted?.text()).toBe('123456')

    const rejected = await handleWhatsappApiRequest(
      new Request('https://edge.test/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=123456'),
      bindings(database),
    )
    expect(rejected?.status).toBe(403)
  })

  it('persiste webhook uma vez e reconhece retry como duplicado', async () => {
    const { database, externalIds } = fakeDatabase()
    const runtime = bindings(database)
    const body = JSON.stringify(webhookPayload())
    const raw = new TextEncoder().encode(body).buffer
    const headers = {
      'content-type': 'application/json',
      'x-hub-signature-256': await signature(raw),
    }

    const first = await handleWhatsappApiRequest(new Request('https://edge.test/api/whatsapp/webhook', { method: 'POST', headers, body }), runtime)
    expect(first?.status).toBe(200)
    expect(await first?.json()).toMatchObject({
      ok: true,
      processed: 1,
      results: [{ accepted: true, message_id: 'wamid.test-001' }],
    })
    expect(externalIds.has('wamid.test-001')).toBe(true)

    const second = await handleWhatsappApiRequest(new Request('https://edge.test/api/whatsapp/webhook', { method: 'POST', headers, body }), runtime)
    expect(second?.status).toBe(200)
    expect(await second?.json()).toMatchObject({
      ok: true,
      processed: 1,
      results: [{ duplicate: true, message_id: 'wamid.test-001' }],
    })
  })

  it('rejeita assinatura inválida antes de persistir', async () => {
    const { database, externalIds } = fakeDatabase()
    const response = await handleWhatsappApiRequest(new Request('https://edge.test/api/whatsapp/webhook', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-hub-signature-256': `sha256=${'0'.repeat(64)}` },
      body: JSON.stringify(webhookPayload()),
    }), bindings(database))
    expect(response?.status).toBe(401)
    expect(externalIds.size).toBe(0)
  })
})
