import { D1WhatsAppConnectionRepository } from './adapters/d1WhatsAppConnectionRepository'
import { verifyMetaSignature } from './whatsappApi'
import {
  applyWhatsAppDeliveryStatus,
  type WhatsAppOutboundBindings,
  type WhatsAppProviderDeliveryStatus,
} from './whatsappOutboundService'

const WEBHOOK_PATHS = new Set(['/api/whatsapp/webhook', '/api/whatsapp-webhook'])
const MODULE_ID = 'petshop'
const MAX_WEBHOOK_BYTES = 256 * 1024
const PROVIDER_STATUSES = new Set<WhatsAppProviderDeliveryStatus>(['sent', 'delivered', 'read', 'failed'])

type Bindings = WhatsAppOutboundBindings & Readonly<{ WHATSAPP_APP_SECRET?: string }>

export type MetaWhatsAppStatusEvent = Readonly<{
  wabaId: string
  phoneNumberId: string
  providerMessageId: string
  status: WhatsAppProviderDeliveryStatus
  timestampMs: number
  recipientId: string
  errorCode: string | null
}>

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { 'cache-control': 'no-store' } })
}

function clean(value: unknown, max = 160): string {
  const normalized = typeof value === 'string' || typeof value === 'number'
    ? String(value).trim()
    : ''
  return normalized.length > 0 && normalized.length <= max ? normalized : ''
}

function timestampMs(value: unknown): number | null {
  const normalized = clean(value, 24)
  if (!/^\d{1,16}$/.test(normalized)) return null
  const seconds = Number(normalized)
  if (!Number.isSafeInteger(seconds) || seconds < 0) return null
  const ms = seconds * 1_000
  return Number.isSafeInteger(ms) ? ms : null
}

function providerErrorCode(status: Record<string, unknown>): string | null {
  const errors = status.errors
  if (!Array.isArray(errors) || !errors.length) return null
  const first = errors[0]
  if (!first || typeof first !== 'object' || Array.isArray(first)) return null
  return clean((first as Record<string, unknown>).code) || null
}

export function extractWhatsappStatusEvents(payload: unknown): MetaWhatsAppStatusEvent[] {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return []
  const root = payload as Record<string, unknown>
  const result: MetaWhatsAppStatusEvent[] = []
  const entries = Array.isArray(root.entry) ? root.entry : []
  for (const rawEntry of entries) {
    if (!rawEntry || typeof rawEntry !== 'object' || Array.isArray(rawEntry)) continue
    const entry = rawEntry as Record<string, unknown>
    const wabaId = clean(entry.id)
    const changes = Array.isArray(entry.changes) ? entry.changes : []
    for (const rawChange of changes) {
      if (!rawChange || typeof rawChange !== 'object' || Array.isArray(rawChange)) continue
      const change = rawChange as Record<string, unknown>
      const value = change.value && typeof change.value === 'object' && !Array.isArray(change.value)
        ? change.value as Record<string, unknown>
        : {}
      const metadata = value.metadata && typeof value.metadata === 'object' && !Array.isArray(value.metadata)
        ? value.metadata as Record<string, unknown>
        : {}
      const phoneNumberId = clean(metadata.phone_number_id)
      const statuses = Array.isArray(value.statuses) ? value.statuses : []
      for (const rawStatus of statuses) {
        if (!rawStatus || typeof rawStatus !== 'object' || Array.isArray(rawStatus)) continue
        const status = rawStatus as Record<string, unknown>
        const providerMessageId = clean(status.id)
        const statusValue = clean(status.status) as WhatsAppProviderDeliveryStatus
        const eventTimestampMs = timestampMs(status.timestamp)
        if (!wabaId || !phoneNumberId || !providerMessageId || !PROVIDER_STATUSES.has(statusValue) || eventTimestampMs == null) continue
        result.push({
          wabaId,
          phoneNumberId,
          providerMessageId,
          status: statusValue,
          timestampMs: eventTimestampMs,
          recipientId: clean(status.recipient_id, 24),
          errorCode: providerErrorCode(status),
        })
      }
    }
  }
  return result
}

export function payloadContainsInboundMessages(payload: unknown): boolean {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return false
  const root = payload as Record<string, unknown>
  for (const rawEntry of Array.isArray(root.entry) ? root.entry : []) {
    if (!rawEntry || typeof rawEntry !== 'object' || Array.isArray(rawEntry)) continue
    for (const rawChange of Array.isArray((rawEntry as Record<string, unknown>).changes)
      ? (rawEntry as Record<string, unknown>).changes as unknown[]
      : []) {
      if (!rawChange || typeof rawChange !== 'object' || Array.isArray(rawChange)) continue
      const value = (rawChange as Record<string, unknown>).value
      if (!value || typeof value !== 'object' || Array.isArray(value)) continue
      if (Array.isArray((value as Record<string, unknown>).messages) && ((value as Record<string, unknown>).messages as unknown[]).length > 0) return true
    }
  }
  return false
}

export async function handleWhatsappDeliveryStatusRequest(
  request: Request,
  bindings: Bindings,
): Promise<Response | null> {
  const { pathname } = new URL(request.url)
  if (!WEBHOOK_PATHS.has(pathname) || request.method !== 'POST') return null
  if (!bindings.DB) return null

  const appSecret = clean(bindings.WHATSAPP_APP_SECRET, 2_048)
  if (!appSecret) return null
  const declaredLength = Number(request.headers.get('content-length') || 0)
  if (declaredLength > MAX_WEBHOOK_BYTES) return null
  const rawBody = await request.arrayBuffer()
  if (rawBody.byteLength > MAX_WEBHOOK_BYTES) return null
  if (!await verifyMetaSignature(rawBody, request.headers.get('x-hub-signature-256') || '', appSecret)) return null

  let payload: unknown
  try {
    payload = JSON.parse(new TextDecoder().decode(rawBody))
  } catch {
    return null
  }
  const events = extractWhatsappStatusEvents(payload)
  if (!events.length) return null

  const connectionRepository = new D1WhatsAppConnectionRepository(bindings.DB)
  const results: Array<Record<string, unknown>> = []
  for (const event of events) {
    try {
      const connection = await connectionRepository.findByPhoneNumberId(event.phoneNumberId)
      if (!connection) {
        results.push({ message_id: event.providerMessageId, ignored: true, reason: 'unknown_phone_number_id' })
        continue
      }
      if (connection.waba_id !== event.wabaId) {
        results.push({ message_id: event.providerMessageId, ignored: true, reason: 'waba_mismatch' })
        continue
      }
      const applied = await applyWhatsAppDeliveryStatus(bindings, {
        tenantId: connection.tenant_id,
        moduleId: MODULE_ID,
        wabaId: event.wabaId,
        phoneNumberId: event.phoneNumberId,
        providerMessageId: event.providerMessageId,
        status: event.status,
        providerTimestampMs: event.timestampMs,
        errorCode: event.errorCode,
      })
      results.push({ message_id: event.providerMessageId, ...applied })
    } catch {
      return json({ code: 'WHATSAPP_STATUS_INGRESS_UNAVAILABLE' }, 503)
    }
  }

  // If Meta ever batches inbound messages together with status updates, the caller
  // must continue to the live-message webhook handler after the status side effects.
  if (payloadContainsInboundMessages(payload)) return null
  return json({ ok: true, processed_statuses: results.length, results })
}
