import { parseIncomingWhatsAppMessageV1, type IncomingWhatsAppMessageV1 } from '../../../shared/contracts/v1/index'
import { D1WhatsAppConnectionRepository } from './adapters/d1WhatsAppConnectionRepository'

export type WhatsappRuntimeBindings = {
  DB?: D1Database
  WHATSAPP_VERIFY_TOKEN?: string
  WHATSAPP_APP_SECRET?: string
}

type MetaMessage = Record<string, any>
type MetaEvent = {
  wabaId: string
  phoneNumberId: string
  from: string
  messageId: string
  timestamp: string
  type: string
  text: string
  profileName: string
}

const WEBHOOK_PATHS = new Set(['/api/whatsapp/webhook', '/api/whatsapp-webhook'])
const WHATSAPP_MODULE_ID = 'petshop'
const MAX_WEBHOOK_BYTES = 256 * 1024

function json(body: unknown, status = 200, headers?: HeadersInit): Response {
  return Response.json(body, {
    status,
    headers: { 'cache-control': 'no-store', ...Object.fromEntries(new Headers(headers).entries()) },
  })
}

function clean(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function hex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((value) => value.toString(16).padStart(2, '0')).join('')
}

async function digest(value: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))
}

async function safeTokenEqual(left: string, right: string): Promise<boolean> {
  const [a, b] = await Promise.all([digest(left), digest(right)])
  let mismatch = a.length ^ b.length
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    mismatch |= (a[index] ?? 0) ^ (b[index] ?? 0)
  }
  return mismatch === 0
}

export async function verifyMetaSignature(rawBody: ArrayBuffer, header: string, appSecret: string): Promise<boolean> {
  const match = /^sha256=([a-f0-9]{64})$/i.exec(clean(header))
  if (!match || !appSecret) return false
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(appSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const expected = hex(await crypto.subtle.sign('HMAC', key, rawBody))
  return safeTokenEqual(expected.toLowerCase(), match[1].toLowerCase())
}

function messageText(message: MetaMessage): string {
  const type = clean(message.type)
  if (type === 'text') return clean(message.text?.body)
  if (type === 'button') return clean(message.button?.text)
  if (type === 'interactive') {
    return clean(message.interactive?.button_reply?.title || message.interactive?.list_reply?.title)
  }
  return `[Mensagem ${type || 'nao textual'} recebida no WhatsApp]`
}

export function extractWhatsappEvents(payload: unknown): MetaEvent[] {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return []
  const root = payload as Record<string, any>
  const events: MetaEvent[] = []
  for (const entry of Array.isArray(root.entry) ? root.entry : []) {
    const wabaId = clean(entry?.id)
    for (const change of Array.isArray(entry?.changes) ? entry.changes : []) {
      const value = change?.value || {}
      const phoneNumberId = clean(value?.metadata?.phone_number_id)
      const contacts = new Map<string, string>((Array.isArray(value?.contacts) ? value.contacts : [])
        .map((contact: any) => [clean(contact?.wa_id), clean(contact?.profile?.name)]))
      for (const message of Array.isArray(value?.messages) ? value.messages : []) {
        const from = clean(message?.from)
        const messageId = clean(message?.id)
        if (!from || !messageId) continue
        events.push({
          wabaId,
          phoneNumberId,
          from,
          messageId,
          timestamp: clean(message?.timestamp),
          type: clean(message?.type) || 'unknown',
          text: messageText(message),
          profileName: contacts.get(from) || '',
        })
      }
    }
  }
  return events
}

function metaTimestampIso(raw: string): string | null {
  if (!/^\d{1,16}$/.test(raw)) return null
  const seconds = Number(raw)
  if (!Number.isSafeInteger(seconds) || seconds < 0) return null
  const milliseconds = seconds * 1000
  if (!Number.isSafeInteger(milliseconds)) return null
  const date = new Date(milliseconds)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

async function tenantAcceptsWhatsapp(database: D1Database, tenantId: string): Promise<boolean> {
  const tenant = await database.prepare(`
    SELECT t.id
    FROM tenants t
    JOIN tenant_module_settings s
      ON s.tenant_id=t.id AND s.module_id=?2
    WHERE t.id=?1 AND t.status='active'
    LIMIT 1
  `).bind(tenantId, WHATSAPP_MODULE_ID).first<{ id: string }>()
  return Boolean(tenant)
}

async function persistInbound(
  database: D1Database,
  message: IncomingWhatsAppMessageV1,
  profileName: string,
) {
  const claimToken = crypto.randomUUID()
  const now = Date.now()
  const threadId = `wa:${message.from}`
  const internalMessageId = crypto.randomUUID()
  const createdAt = new Date(message.timestamp).getTime()
  const metadata = JSON.stringify({
    channel: 'whatsapp',
    whatsapp_waba_id: message.waba_id,
    whatsapp_phone_number_id: message.phone_number_id,
    whatsapp_message_type: message.message_type,
    whatsapp_profile_name: profileName || null,
    whatsapp_timestamp: message.timestamp,
    ingress: 'live_webhook',
  })

  await database.batch([
    database.prepare(`
      INSERT OR IGNORE INTO whatsapp_ingress_receipts(
        tenant_id,module_id,provider_message_id,waba_id,phone_number_id,claim_token,received_at_ms
      ) VALUES(?1,?2,?3,?4,?5,?6,?7)
    `).bind(
      message.tenant_id,
      WHATSAPP_MODULE_ID,
      message.message_id,
      message.waba_id,
      message.phone_number_id,
      claimToken,
      now,
    ),
    database.prepare(`
      INSERT INTO chat_threads(
        tenant_id,module_id,id,channel,external_thread_id,status,last_message_at_ms,created_at_ms,updated_at_ms
      )
      SELECT ?1,?2,?3,'whatsapp',?4,'open',?5,?5,?5
      WHERE EXISTS (
        SELECT 1 FROM whatsapp_ingress_receipts
        WHERE tenant_id=?1 AND module_id=?2 AND provider_message_id=?6 AND claim_token=?7
      )
      ON CONFLICT(tenant_id,module_id,id) DO UPDATE SET
        last_message_at_ms=excluded.last_message_at_ms,
        updated_at_ms=excluded.updated_at_ms
    `).bind(
      message.tenant_id,
      WHATSAPP_MODULE_ID,
      threadId,
      message.from,
      now,
      message.message_id,
      claimToken,
    ),
    database.prepare(`
      INSERT OR IGNORE INTO chat_messages(
        tenant_id,module_id,id,thread_id,external_message_id,direction,actor_type,content_text,content_json,created_at_ms
      )
      SELECT ?1,?2,?3,?4,?5,'inbound','customer',?6,?7,?8
      WHERE EXISTS (
        SELECT 1 FROM whatsapp_ingress_receipts
        WHERE tenant_id=?1 AND module_id=?2 AND provider_message_id=?5 AND claim_token=?9
      )
    `).bind(
      message.tenant_id,
      WHATSAPP_MODULE_ID,
      internalMessageId,
      threadId,
      message.message_id,
      message.text ?? '',
      metadata,
      createdAt,
      claimToken,
    ),
  ])

  const receipt = await database.prepare(`
    SELECT claim_token
    FROM whatsapp_ingress_receipts
    WHERE tenant_id=?1 AND module_id=?2 AND provider_message_id=?3
    LIMIT 1
  `).bind(message.tenant_id, WHATSAPP_MODULE_ID, message.message_id).first<{ claim_token: string }>()

  if (!receipt || receipt.claim_token !== claimToken) {
    return { duplicate: true, message_id: message.message_id }
  }
  return { accepted: true, thread_id: threadId, message_id: message.message_id }
}

async function processInboundEvent(
  database: D1Database,
  repository: D1WhatsAppConnectionRepository,
  event: MetaEvent,
) {
  if (!event.phoneNumberId) return { ignored: true, reason: 'missing_phone_number_id', message_id: event.messageId }
  if (!event.wabaId) return { ignored: true, reason: 'missing_waba_id', message_id: event.messageId }

  const connection = await repository.findByPhoneNumberId(event.phoneNumberId)
  if (!connection) return { ignored: true, reason: 'unknown_phone_number_id', message_id: event.messageId }
  if (connection.waba_id !== event.wabaId) return { ignored: true, reason: 'waba_mismatch', message_id: event.messageId }
  if (connection.status !== 'connected') return { ignored: true, reason: 'connection_not_connected', message_id: event.messageId }
  if (!await tenantAcceptsWhatsapp(database, connection.tenant_id)) {
    return { ignored: true, reason: 'tenant_scope_inactive', message_id: event.messageId }
  }

  const timestamp = metaTimestampIso(event.timestamp)
  if (!timestamp) return { ignored: true, reason: 'invalid_timestamp', message_id: event.messageId }

  let normalized: IncomingWhatsAppMessageV1
  try {
    normalized = parseIncomingWhatsAppMessageV1({
      type: 'incoming_whatsapp_message',
      version: 1,
      tenant_id: connection.tenant_id,
      waba_id: connection.waba_id,
      phone_number_id: connection.phone_number_id,
      message_id: event.messageId,
      from: event.from,
      timestamp,
      message_type: event.type,
      text: event.text || null,
    })
  } catch {
    return { ignored: true, reason: 'invalid_message_contract', message_id: event.messageId }
  }

  return persistInbound(database, normalized, event.profileName)
}

async function handleWebhookGet(request: Request, bindings: WhatsappRuntimeBindings): Promise<Response> {
  const expected = clean(bindings.WHATSAPP_VERIFY_TOKEN)
  if (!expected) return json({ code: 'WHATSAPP_NOT_CONFIGURED' }, 503)
  const url = new URL(request.url)
  const mode = clean(url.searchParams.get('hub.mode'))
  const token = clean(url.searchParams.get('hub.verify_token'))
  const challenge = clean(url.searchParams.get('hub.challenge'))
  if (mode === 'subscribe' && token && challenge && await safeTokenEqual(token, expected)) {
    return new Response(challenge, { status: 200, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } })
  }
  return json({ code: 'WHATSAPP_VERIFY_TOKEN_REJECTED' }, 403)
}

async function handleWebhookPost(request: Request, bindings: WhatsappRuntimeBindings): Promise<Response> {
  const appSecret = clean(bindings.WHATSAPP_APP_SECRET)
  if (!appSecret) return json({ code: 'WHATSAPP_NOT_CONFIGURED' }, 503)
  const declaredLength = Number(request.headers.get('content-length') || 0)
  if (declaredLength > MAX_WEBHOOK_BYTES) return json({ code: 'PAYLOAD_TOO_LARGE' }, 413)

  const rawBody = await request.arrayBuffer()
  if (rawBody.byteLength > MAX_WEBHOOK_BYTES) return json({ code: 'PAYLOAD_TOO_LARGE' }, 413)
  if (!await verifyMetaSignature(rawBody, request.headers.get('x-hub-signature-256') || '', appSecret)) {
    return json({ code: 'WHATSAPP_SIGNATURE_REJECTED' }, 401)
  }

  let payload: unknown
  try { payload = JSON.parse(new TextDecoder().decode(rawBody)) } catch { return json({ code: 'INVALID_JSON' }, 400) }
  if (!bindings.DB) return json({ code: 'DATABASE_NOT_CONFIGURED' }, 503)

  const repository = new D1WhatsAppConnectionRepository(bindings.DB)
  const events = extractWhatsappEvents(payload)
  const results = []
  try {
    for (const event of events) results.push(await processInboundEvent(bindings.DB, repository, event))
  } catch {
    return json({ code: 'WHATSAPP_INGRESS_UNAVAILABLE' }, 503)
  }
  return json({ ok: true, processed: results.length, results })
}

export async function handleWhatsappApiRequest(request: Request, bindings: WhatsappRuntimeBindings): Promise<Response | null> {
  const { pathname } = new URL(request.url)
  if (!WEBHOOK_PATHS.has(pathname)) return null
  if (request.method === 'GET') return handleWebhookGet(request, bindings)
  if (request.method === 'POST') return handleWebhookPost(request, bindings)
  return json({ code: 'METHOD_NOT_ALLOWED' }, 405, { allow: 'GET, POST' })
}
