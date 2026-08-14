import { getBetterAuthSession, type BetterAuthRuntimeBindings } from './auth/betterAuthRuntime'

export type WhatsappRuntimeBindings = BetterAuthRuntimeBindings & {
  DB?: D1Database
  WHATSAPP_ACCESS_TOKEN?: string
  WHATSAPP_VERIFY_TOKEN?: string
  WHATSAPP_PHONE_NUMBER_ID?: string
  WHATSAPP_APP_SECRET?: string
  WHATSAPP_GRAPH_VERSION?: string
  WHATSAPP_TENANT_ID?: string
  WHATSAPP_MODULE_ID?: string
}

type MetaMessage = Record<string, any>
type MetaEvent = {
  phoneNumberId: string
  from: string
  messageId: string
  timestamp: string
  type: string
  text: string
  profileName: string
  raw: MetaMessage
}

const WEBHOOK_PATHS = new Set(['/api/whatsapp/webhook', '/api/whatsapp-webhook'])
const SEND_PATH = '/api/whatsapp/send'
const MAX_WEBHOOK_BYTES = 256 * 1024
const MAX_TEXT_CHARS = 4096
const DEFAULT_GRAPH_VERSION = 'v25.0'

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
          phoneNumberId,
          from,
          messageId,
          timestamp: clean(message?.timestamp),
          type: clean(message?.type) || 'unknown',
          text: messageText(message),
          profileName: contacts.get(from) || '',
          raw: message,
        })
      }
    }
  }
  return events
}

function scope(bindings: WhatsappRuntimeBindings) {
  return {
    tenantId: clean(bindings.WHATSAPP_TENANT_ID),
    moduleId: clean(bindings.WHATSAPP_MODULE_ID).toLowerCase() || 'petshop',
    phoneNumberId: clean(bindings.WHATSAPP_PHONE_NUMBER_ID),
  }
}

async function validateScope(bindings: WhatsappRuntimeBindings): Promise<Response | null> {
  if (!bindings.DB) return json({ code: 'DATABASE_NOT_CONFIGURED' }, 503)
  const configured = scope(bindings)
  if (!configured.tenantId || !configured.phoneNumberId) {
    return json({ code: 'WHATSAPP_NOT_CONFIGURED' }, 503)
  }
  const tenant = await bindings.DB.prepare(`
    SELECT t.id
    FROM tenants t
    JOIN tenant_module_settings s ON s.tenant_id=t.id AND s.module_id=?2
    WHERE t.id=?1 AND t.status='active'
    LIMIT 1
  `).bind(configured.tenantId, configured.moduleId).first<{ id: string }>()
  return tenant ? null : json({ code: 'WHATSAPP_TENANT_SCOPE_INVALID' }, 503)
}

async function persistInbound(bindings: WhatsappRuntimeBindings, event: MetaEvent) {
  const configured = scope(bindings)
  const database = bindings.DB!
  if (event.phoneNumberId && event.phoneNumberId !== configured.phoneNumberId) {
    return { ignored: true, reason: 'phone_number_mismatch', message_id: event.messageId }
  }

  const duplicate = await database.prepare(`
    SELECT id FROM chat_messages
    WHERE tenant_id=?1 AND module_id=?2 AND external_message_id=?3
    LIMIT 1
  `).bind(configured.tenantId, configured.moduleId, event.messageId).first<{ id: string }>()
  if (duplicate) return { duplicate: true, message_id: event.messageId }

  const now = Date.now()
  const threadId = `wa:${event.from}`
  const messageId = crypto.randomUUID()
  const createdAt = /^\d+$/.test(event.timestamp) ? Number(event.timestamp) * 1000 : now
  const metadata = JSON.stringify({
    channel: 'whatsapp',
    whatsapp_phone_number_id: event.phoneNumberId || configured.phoneNumberId,
    whatsapp_message_type: event.type,
    whatsapp_profile_name: event.profileName || null,
    whatsapp_timestamp: event.timestamp || null,
  })

  await database.batch([
    database.prepare(`
      INSERT INTO chat_threads(
        tenant_id,module_id,id,channel,external_thread_id,status,last_message_at_ms,created_at_ms,updated_at_ms
      ) VALUES(?1,?2,?3,'whatsapp',?4,'open',?5,?5,?5)
      ON CONFLICT(tenant_id,module_id,id) DO UPDATE SET
        last_message_at_ms=excluded.last_message_at_ms,
        updated_at_ms=excluded.updated_at_ms
    `).bind(configured.tenantId, configured.moduleId, threadId, event.from, now),
    database.prepare(`
      INSERT OR IGNORE INTO chat_messages(
        tenant_id,module_id,id,thread_id,external_message_id,direction,actor_type,content_text,content_json,created_at_ms
      ) VALUES(?1,?2,?3,?4,?5,'inbound','customer',?6,?7,?8)
    `).bind(
      configured.tenantId,
      configured.moduleId,
      messageId,
      threadId,
      event.messageId,
      event.text,
      metadata,
      createdAt,
    ),
  ])

  return { accepted: true, thread_id: threadId, message_id: event.messageId }
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
  const scopeError = await validateScope(bindings)
  if (scopeError) return scopeError
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
  const events = extractWhatsappEvents(payload)
  const results = []
  for (const event of events) results.push(await persistInbound(bindings, event))
  return json({ ok: true, processed: results.length, results })
}

function moduleAllowed(raw: unknown, moduleId: string): boolean {
  try {
    const value = typeof raw === 'string' ? JSON.parse(raw) : raw
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false
    const permissions = value as Record<string, unknown>
    return permissions['*'] === true || permissions[moduleId] === true || Boolean(permissions[moduleId] && typeof permissions[moduleId] === 'object')
  } catch {
    return false
  }
}

async function authorizeOutbound(request: Request, bindings: WhatsappRuntimeBindings, tenantId: string, moduleId: string): Promise<Response | null> {
  if (!bindings.DB) return json({ code: 'DATABASE_NOT_CONFIGURED' }, 503)
  const session = await getBetterAuthSession(request, bindings)
  const userId = clean(session?.user?.id)
  if (!userId) return json({ code: 'UNAUTHENTICATED' }, 401)
  const row = await bindings.DB.prepare(`
    SELECT m.role,m.module_permissions_json
    FROM identity_principals p
    JOIN tenant_memberships m ON m.principal_id=p.id AND m.tenant_id=?2 AND m.status='active'
    JOIN tenants t ON t.id=m.tenant_id AND t.status='active'
    WHERE p.provider='better-auth' AND p.subject=?1 AND p.status='active'
    LIMIT 1
  `).bind(userId, tenantId).first<{ role: string; module_permissions_json: string }>()
  if (!row) return json({ code: 'FORBIDDEN' }, 403)
  const allowed = row.role === 'owner' || row.role === 'admin' || moduleAllowed(row.module_permissions_json, moduleId)
  return allowed ? null : json({ code: 'FORBIDDEN' }, 403)
}

async function sendWhatsappText(bindings: WhatsappRuntimeBindings, to: string, text: string) {
  const token = clean(bindings.WHATSAPP_ACCESS_TOKEN)
  const phoneNumberId = clean(bindings.WHATSAPP_PHONE_NUMBER_ID)
  const version = clean(bindings.WHATSAPP_GRAPH_VERSION) || DEFAULT_GRAPH_VERSION
  if (!token || !phoneNumberId) throw new Error('WHATSAPP_NOT_CONFIGURED')
  const response = await fetch(`https://graph.facebook.com/${encodeURIComponent(version)}/${encodeURIComponent(phoneNumberId)}/messages`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'text',
      text: { preview_url: false, body: text.slice(0, MAX_TEXT_CHARS) },
    }),
  })
  const payload = await response.json().catch(() => ({})) as Record<string, any>
  if (!response.ok) throw new Error(clean(payload?.error?.message) || `WHATSAPP_GRAPH_${response.status}`)
  return payload
}

async function handleOutbound(request: Request, bindings: WhatsappRuntimeBindings): Promise<Response> {
  const configured = scope(bindings)
  const scopeError = await validateScope(bindings)
  if (scopeError) return scopeError
  let body: Record<string, unknown>
  try { body = await request.json() as Record<string, unknown> } catch { return json({ code: 'INVALID_JSON' }, 400) }
  const tenantId = clean(body.tenant_id || request.headers.get('x-tenant-id'))
  const moduleId = clean(body.module_id || request.headers.get('x-module-id')).toLowerCase() || configured.moduleId
  if (tenantId !== configured.tenantId || moduleId !== configured.moduleId) return json({ code: 'WHATSAPP_SCOPE_MISMATCH' }, 403)
  const authError = await authorizeOutbound(request, bindings, tenantId, moduleId)
  if (authError) return authError
  const to = clean(body.to)
  const text = clean(body.text)
  if (!/^\+?\d{8,20}$/.test(to) || !text) return json({ code: 'INVALID_WHATSAPP_MESSAGE' }, 400)

  let delivery: Record<string, any>
  try { delivery = await sendWhatsappText(bindings, to.replace(/^\+/, ''), text) } catch (error) {
    return json({ code: 'WHATSAPP_DELIVERY_FAILED', message: error instanceof Error ? error.message : 'Unknown delivery error' }, 502)
  }

  const externalMessageId = clean(delivery?.messages?.[0]?.id) || null
  const now = Date.now()
  const threadId = `wa:${to.replace(/^\+/, '')}`
  await bindings.DB!.batch([
    bindings.DB!.prepare(`
      INSERT INTO chat_threads(tenant_id,module_id,id,channel,external_thread_id,status,last_message_at_ms,created_at_ms,updated_at_ms)
      VALUES(?1,?2,?3,'whatsapp',?4,'open',?5,?5,?5)
      ON CONFLICT(tenant_id,module_id,id) DO UPDATE SET last_message_at_ms=excluded.last_message_at_ms,updated_at_ms=excluded.updated_at_ms
    `).bind(tenantId, moduleId, threadId, to.replace(/^\+/, ''), now),
    bindings.DB!.prepare(`
      INSERT INTO chat_messages(tenant_id,module_id,id,thread_id,external_message_id,direction,actor_type,content_text,content_json,created_at_ms)
      VALUES(?1,?2,?3,?4,?5,'outbound','assistant',?6,?7,?8)
    `).bind(tenantId, moduleId, crypto.randomUUID(), threadId, externalMessageId, text.slice(0, MAX_TEXT_CHARS), JSON.stringify({ channel: 'whatsapp', delivery_status: 'sent' }), now),
  ])
  return json({ ok: true, message_id: externalMessageId })
}

export async function handleWhatsappApiRequest(request: Request, bindings: WhatsappRuntimeBindings): Promise<Response | null> {
  const { pathname } = new URL(request.url)
  if (WEBHOOK_PATHS.has(pathname)) {
    if (request.method === 'GET') return handleWebhookGet(request, bindings)
    if (request.method === 'POST') return handleWebhookPost(request, bindings)
    return json({ code: 'METHOD_NOT_ALLOWED' }, 405, { allow: 'GET, POST' })
  }
  if (pathname === SEND_PATH) {
    if (request.method === 'POST') return handleOutbound(request, bindings)
    return json({ code: 'METHOD_NOT_ALLOWED' }, 405, { allow: 'POST' })
  }
  return null
}
