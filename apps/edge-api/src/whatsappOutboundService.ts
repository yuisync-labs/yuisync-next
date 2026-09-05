import {
  parseWhatsAppSendResultV1,
  type WhatsAppMessageStatusV1,
  type WhatsAppSendResultV1,
} from '../../../shared/contracts/v1/index'
import { D1EncryptedWhatsAppCredentialVault } from './adapters/d1EncryptedWhatsAppCredentialVault'
import { D1WhatsAppConnectionRepository } from './adapters/d1WhatsAppConnectionRepository'
import { releaseYuiOutboundMessage, reserveYuiOutboundMessage, type YuiMessageReservation } from './commercialYuiMeter'
import {
  MetaWhatsAppGraphAdapter,
  MetaWhatsAppGraphError,
} from './adapters/metaWhatsAppGraphAdapter'

const MAX_TEXT_CHARS = 4_096
const MODULE_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/
const IDENTIFIER_MAX = 160

export type WhatsAppOutboundActorType = 'assistant' | 'human' | 'system'
export type WhatsAppProviderDeliveryStatus = 'sent' | 'delivered' | 'read' | 'failed'

export type WhatsAppOutboundBindings = Readonly<{
  DB?: D1Database
  WHATSAPP_CREDENTIAL_ENCRYPTION_KEY?: string
  WHATSAPP_GRAPH_VERSION?: string
}>

export type WhatsAppOutboundSendInput = Readonly<{
  tenantId: string
  moduleId: string
  conversationId: string
  to: string
  body: string
  idempotencyKey: string
  actorType: WhatsAppOutboundActorType
  phoneNumberId?: string | null
  correlationId?: string | null
}>

export type WhatsAppDeliveryStatusInput = Readonly<{
  tenantId: string
  moduleId: string
  wabaId: string
  phoneNumberId: string
  providerMessageId: string
  status: WhatsAppProviderDeliveryStatus
  providerTimestampMs: number
  errorCode?: string | null
}>

type OutboundRow = Readonly<{
  tenant_id: string
  module_id: string
  idempotency_key: string
  internal_message_id: string
  thread_id: string
  phone_number_id: string
  recipient: string
  actor_type: WhatsAppOutboundActorType
  provider_message_id: string | null
  status: WhatsAppMessageStatusV1
  error_code: string | null
  claim_token: string
  last_provider_status_at_ms: number | null
  created_at_ms: number
  updated_at_ms: number
}>

type ChatMessageRow = Readonly<{ content_json: string | null }>

export type WhatsAppOutboundServiceErrorCode =
  | 'WHATSAPP_OUTBOUND_INVALID_INPUT'
  | 'WHATSAPP_OUTBOUND_DATABASE_NOT_CONFIGURED'
  | 'WHATSAPP_OUTBOUND_NOT_CONFIGURED'
  | 'WHATSAPP_OUTBOUND_PHONE_SELECTION_REQUIRED'
  | 'WHATSAPP_OUTBOUND_PHONE_NOT_FOUND'
  | 'WHATSAPP_OUTBOUND_CREDENTIAL_NOT_FOUND'
  | 'WHATSAPP_OUTBOUND_PERSISTENCE_FAILED'
  | 'WHATSAPP_OUTBOUND_PLAN_LIMIT_REACHED'
  | 'WHATSAPP_OUTBOUND_DELIVERY_FAILED'

export class WhatsAppOutboundServiceError extends Error {
  readonly code: WhatsAppOutboundServiceErrorCode
  readonly retryable: boolean

  constructor(code: WhatsAppOutboundServiceErrorCode, retryable = false) {
    super('WhatsApp outbound operation failed.')
    this.name = 'WhatsAppOutboundServiceError'
    this.code = code
    this.retryable = retryable
  }
}

function clean(value: unknown, max = IDENTIFIER_MAX): string {
  const normalized = typeof value === 'string' ? value.trim() : ''
  return normalized.length > 0 && normalized.length <= max ? normalized : ''
}

function recipient(value: unknown): string {
  const normalized = clean(value, 24).replace(/^\+/, '')
  return /^\d{8,20}$/.test(normalized) ? normalized : ''
}

function phoneId(value: unknown): string {
  const normalized = clean(value)
  return /^\d+$/.test(normalized) ? normalized : ''
}

function moduleId(value: unknown): string {
  const normalized = clean(value, 64).toLowerCase()
  return MODULE_ID_PATTERN.test(normalized) ? normalized : ''
}

function metadata(input: Record<string, unknown>): string {
  return JSON.stringify(input)
}

function parseMetadata(raw: string | null): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw || '{}')
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {}
  } catch {
    return {}
  }
}

function iso(ms: number): string {
  return new Date(ms).toISOString()
}

function resultFromRow(row: OutboundRow): WhatsAppSendResultV1 {
  return parseWhatsAppSendResultV1({
    type: 'whatsapp_send_result',
    version: 1,
    tenant_id: row.tenant_id,
    conversation_id: row.thread_id,
    idempotency_key: row.idempotency_key,
    provider_message_id: row.provider_message_id,
    status: row.status,
    occurred_at: iso(row.updated_at_ms),
    error_code: row.error_code,
  })
}

async function outboundByIdempotency(
  database: D1Database,
  tenantId: string,
  moduleIdValue: string,
  idempotencyKey: string,
): Promise<OutboundRow | null> {
  return database.prepare(`
    SELECT tenant_id,module_id,idempotency_key,internal_message_id,thread_id,phone_number_id,
           recipient,actor_type,provider_message_id,status,error_code,claim_token,
           last_provider_status_at_ms,created_at_ms,updated_at_ms
    FROM whatsapp_outbound_messages
    WHERE tenant_id=?1 AND module_id=?2 AND idempotency_key=?3
    LIMIT 1
  `).bind(tenantId, moduleIdValue, idempotencyKey).first<OutboundRow>()
}

async function resolveConnection(
  bindings: WhatsAppOutboundBindings,
  tenantId: string,
  requestedPhoneNumberId: string,
) {
  const repository = new D1WhatsAppConnectionRepository(bindings.DB)
  const connected = (await repository.findByTenantId(tenantId))
    .filter((connection) => connection.status === 'connected')

  if (requestedPhoneNumberId) {
    const selected = connected.find((connection) => connection.phone_number_id === requestedPhoneNumberId)
    if (!selected) throw new WhatsAppOutboundServiceError('WHATSAPP_OUTBOUND_PHONE_NOT_FOUND')
    return selected
  }
  if (connected.length === 0) throw new WhatsAppOutboundServiceError('WHATSAPP_OUTBOUND_NOT_CONFIGURED')
  if (connected.length > 1) throw new WhatsAppOutboundServiceError('WHATSAPP_OUTBOUND_PHONE_SELECTION_REQUIRED')
  return connected[0]
}

async function setChatDeliveryMetadata(
  database: D1Database,
  row: Pick<OutboundRow, 'tenant_id' | 'module_id' | 'internal_message_id'>,
  patch: Record<string, unknown>,
): Promise<void> {
  const chat = await database.prepare(`
    SELECT content_json
    FROM chat_messages
    WHERE tenant_id=?1 AND module_id=?2 AND id=?3
    LIMIT 1
  `).bind(row.tenant_id, row.module_id, row.internal_message_id).first<ChatMessageRow>()
  if (!chat) return
  const current = parseMetadata(chat.content_json)
  await database.prepare(`
    UPDATE chat_messages
    SET content_json=?4
    WHERE tenant_id=?1 AND module_id=?2 AND id=?3
  `).bind(
    row.tenant_id,
    row.module_id,
    row.internal_message_id,
    metadata({ ...current, ...patch }),
  ).run()
}

async function markFailed(
  database: D1Database,
  row: OutboundRow,
  errorCode: string,
  now: number,
): Promise<OutboundRow> {
  await database.prepare(`
    UPDATE whatsapp_outbound_messages
    SET status='failed',error_code=?4,updated_at_ms=?5
    WHERE tenant_id=?1 AND module_id=?2 AND idempotency_key=?3
  `).bind(row.tenant_id, row.module_id, row.idempotency_key, errorCode.slice(0, 160), now).run()
  await setChatDeliveryMetadata(database, row, {
    channel: 'whatsapp',
    delivery_status: 'failed',
    delivery_error_code: errorCode.slice(0, 160),
  })
  return (await outboundByIdempotency(database, row.tenant_id, row.module_id, row.idempotency_key))!
}

export async function sendWhatsAppOutboundText(
  bindings: WhatsAppOutboundBindings,
  input: WhatsAppOutboundSendInput,
  now: () => number = Date.now,
): Promise<WhatsAppSendResultV1> {
  if (!bindings.DB) throw new WhatsAppOutboundServiceError('WHATSAPP_OUTBOUND_DATABASE_NOT_CONFIGURED', true)
  const database = bindings.DB
  const tenantId = clean(input.tenantId)
  const moduleIdValue = moduleId(input.moduleId)
  const conversationId = clean(input.conversationId, 128)
  const to = recipient(input.to)
  const body = clean(input.body, MAX_TEXT_CHARS)
  const idempotencyKey = clean(input.idempotencyKey)
  const requestedPhoneNumberId = input.phoneNumberId == null ? '' : phoneId(input.phoneNumberId)
  if (
    !tenantId || !moduleIdValue || !conversationId || !to || !body || !idempotencyKey
    || (input.phoneNumberId != null && !requestedPhoneNumberId)
    || !['assistant', 'human', 'system'].includes(input.actorType)
  ) {
    throw new WhatsAppOutboundServiceError('WHATSAPP_OUTBOUND_INVALID_INPUT')
  }

  const connection = await resolveConnection(bindings, tenantId, requestedPhoneNumberId)
  const createdAt = now()
  const internalMessageId = crypto.randomUUID()
  const claimToken = crypto.randomUUID()
  const threadId = conversationId

  try {
    await database.prepare(`
      INSERT OR IGNORE INTO whatsapp_outbound_messages(
        tenant_id,module_id,idempotency_key,internal_message_id,thread_id,phone_number_id,
        recipient,actor_type,status,claim_token,created_at_ms,updated_at_ms
      ) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,'queued',?9,?10,?10)
    `).bind(
      tenantId,
      moduleIdValue,
      idempotencyKey,
      internalMessageId,
      threadId,
      connection.phone_number_id,
      to,
      input.actorType,
      claimToken,
      createdAt,
    ).run()
  } catch {
    throw new WhatsAppOutboundServiceError('WHATSAPP_OUTBOUND_PERSISTENCE_FAILED', true)
  }

  let row = await outboundByIdempotency(database, tenantId, moduleIdValue, idempotencyKey)
  if (!row) throw new WhatsAppOutboundServiceError('WHATSAPP_OUTBOUND_PERSISTENCE_FAILED', true)
  if (row.claim_token !== claimToken) return resultFromRow(row)

  try {
    await database.batch([
      database.prepare(`
        INSERT INTO chat_threads(
          tenant_id,module_id,id,channel,external_thread_id,status,last_message_at_ms,created_at_ms,updated_at_ms
        ) VALUES(?1,?2,?3,'whatsapp',?4,'open',?5,?5,?5)
        ON CONFLICT(tenant_id,module_id,id) DO UPDATE SET
          last_message_at_ms=excluded.last_message_at_ms,
          updated_at_ms=excluded.updated_at_ms
      `).bind(tenantId, moduleIdValue, threadId, to, createdAt),
      database.prepare(`
        INSERT INTO chat_messages(
          tenant_id,module_id,id,thread_id,direction,actor_type,content_text,content_json,created_at_ms
        ) VALUES(?1,?2,?3,?4,'outbound',?5,?6,?7,?8)
      `).bind(
        tenantId,
        moduleIdValue,
        internalMessageId,
        threadId,
        input.actorType,
        body,
        metadata({
          channel: 'whatsapp',
          delivery_status: 'queued',
          whatsapp_phone_number_id: connection.phone_number_id,
          idempotency_key: idempotencyKey,
        }),
        createdAt,
      ),
    ])
  } catch {
    row = await markFailed(database, row, 'WHATSAPP_OUTBOUND_PERSISTENCE_FAILED', now())
    throw new WhatsAppOutboundServiceError('WHATSAPP_OUTBOUND_PERSISTENCE_FAILED', true)
  }

  let credential
  try {
    const vault = new D1EncryptedWhatsAppCredentialVault(
      database,
      bindings.WHATSAPP_CREDENTIAL_ENCRYPTION_KEY,
    )
    credential = await vault.findByPhoneNumberId(tenantId, connection.phone_number_id)
  } catch {
    row = await markFailed(database, row, 'WHATSAPP_OUTBOUND_CREDENTIAL_NOT_FOUND', now())
    throw new WhatsAppOutboundServiceError('WHATSAPP_OUTBOUND_CREDENTIAL_NOT_FOUND')
  }
  if (!credential) {
    row = await markFailed(database, row, 'WHATSAPP_OUTBOUND_CREDENTIAL_NOT_FOUND', now())
    throw new WhatsAppOutboundServiceError('WHATSAPP_OUTBOUND_CREDENTIAL_NOT_FOUND')
  }

  let yuiReservation: YuiMessageReservation | null = null
  if (input.actorType === 'assistant') {
    yuiReservation = await reserveYuiOutboundMessage(database, {
      tenantId,
      eventKey: row.internal_message_id,
      moduleId: moduleIdValue,
      conversationId: threadId,
      recipient: to,
      nowMs: now(),
    })
    if (yuiReservation.result && !yuiReservation.result.accepted) {
      const reason = yuiReservation.result.reason === 'quota_exceeded'
        ? 'YUI_MESSAGE_QUOTA_EXCEEDED'
        : 'YUI_AUTONOMOUS_NOT_INCLUDED'
      row = await markFailed(database, row, reason, now())
      throw new WhatsAppOutboundServiceError('WHATSAPP_OUTBOUND_PLAN_LIMIT_REACHED')
    }
  }

  const graph = new MetaWhatsAppGraphAdapter({
    graphVersion: bindings.WHATSAPP_GRAPH_VERSION,
    maxAttempts: 1,
    credentials: {
      async resolveForTenant(requestedTenantId) {
        return requestedTenantId === tenantId
          ? { accessToken: credential.accessToken, phoneNumberId: connection.phone_number_id }
          : null
      },
    },
    now: () => new Date(now()),
  })

  try {
    const submitted = await graph.sendText({
      type: 'whatsapp_send_command',
      version: 1,
      tenant_id: tenantId,
      conversation_id: threadId,
      to,
      body,
      idempotency_key: idempotencyKey,
      correlation_id: input.correlationId ?? null,
    })
    const updatedAt = now()
    await database.batch([
      database.prepare(`
        UPDATE whatsapp_outbound_messages
        SET provider_message_id=?4,status='submitted',error_code=NULL,updated_at_ms=?5
        WHERE tenant_id=?1 AND module_id=?2 AND idempotency_key=?3 AND claim_token=?6
      `).bind(
        tenantId,
        moduleIdValue,
        idempotencyKey,
        submitted.provider_message_id,
        updatedAt,
        claimToken,
      ),
      database.prepare(`
        UPDATE chat_messages
        SET external_message_id=?4,content_json=?5
        WHERE tenant_id=?1 AND module_id=?2 AND id=?3
      `).bind(
        tenantId,
        moduleIdValue,
        internalMessageId,
        submitted.provider_message_id,
        metadata({
          channel: 'whatsapp',
          delivery_status: 'submitted',
          whatsapp_phone_number_id: connection.phone_number_id,
          idempotency_key: idempotencyKey,
        }),
      ),
    ])
    row = (await outboundByIdempotency(database, tenantId, moduleIdValue, idempotencyKey))!
    return resultFromRow(row)
  } catch (error) {
    if (yuiReservation?.metered) {
      try {
        await releaseYuiOutboundMessage(database, {
          tenantId,
          eventKey: yuiReservation.eventKey,
          nowMs: now(),
        })
      } catch {
        console.error(JSON.stringify({
          event: 'commercial.yui_usage_release_failed',
          tenant_id: tenantId,
          usage_event_key: yuiReservation.eventKey,
        }))
      }
    }
    const graphCode = error instanceof MetaWhatsAppGraphError
      ? error.code
      : 'WHATSAPP_OUTBOUND_DELIVERY_FAILED'
    row = await markFailed(database, row, graphCode, now())
    throw new WhatsAppOutboundServiceError(
      'WHATSAPP_OUTBOUND_DELIVERY_FAILED',
      error instanceof MetaWhatsAppGraphError ? error.retryable : false,
    )
  }
}

const PROVIDER_STATUS_RANK: Record<Exclude<WhatsAppMessageStatusV1, 'queued' | 'submitted' | 'failed'>, number> = {
  sent: 1,
  delivered: 2,
  read: 3,
}

function normalRank(status: WhatsAppMessageStatusV1): number {
  return status === 'sent' || status === 'delivered' || status === 'read'
    ? PROVIDER_STATUS_RANK[status]
    : 0
}

export async function applyWhatsAppDeliveryStatus(
  bindings: WhatsAppOutboundBindings,
  input: WhatsAppDeliveryStatusInput,
  receivedAt: () => number = Date.now,
): Promise<Readonly<{ updated: boolean; reason?: string; status?: WhatsAppMessageStatusV1 }>> {
  if (!bindings.DB) return { updated: false, reason: 'database_not_configured' }
  const database = bindings.DB
  const tenantId = clean(input.tenantId)
  const moduleIdValue = moduleId(input.moduleId)
  const providerMessageId = clean(input.providerMessageId)
  const selectedPhoneId = phoneId(input.phoneNumberId)
  const wabaId = clean(input.wabaId)
  const errorCode = input.errorCode ? clean(input.errorCode) : ''
  if (
    !tenantId || !moduleIdValue || !providerMessageId || !selectedPhoneId || !wabaId
    || !Number.isSafeInteger(input.providerTimestampMs) || input.providerTimestampMs < 0
  ) return { updated: false, reason: 'invalid_status' }

  const connection = await new D1WhatsAppConnectionRepository(database).findByPhoneNumberId(selectedPhoneId)
  if (!connection || connection.tenant_id !== tenantId) return { updated: false, reason: 'connection_not_found' }
  if (connection.waba_id !== wabaId) return { updated: false, reason: 'waba_mismatch' }

  const row = await database.prepare(`
    SELECT tenant_id,module_id,idempotency_key,internal_message_id,thread_id,phone_number_id,
           recipient,actor_type,provider_message_id,status,error_code,claim_token,
           last_provider_status_at_ms,created_at_ms,updated_at_ms
    FROM whatsapp_outbound_messages
    WHERE tenant_id=?1 AND module_id=?2 AND provider_message_id=?3
    LIMIT 1
  `).bind(tenantId, moduleIdValue, providerMessageId).first<OutboundRow>()
  if (!row) return { updated: false, reason: 'outbound_not_found' }
  if (row.phone_number_id !== selectedPhoneId) return { updated: false, reason: 'phone_mismatch' }

  await database.prepare(`
    INSERT OR IGNORE INTO whatsapp_delivery_receipts(
      tenant_id,module_id,provider_message_id,phone_number_id,status,
      provider_timestamp_ms,error_code,received_at_ms
    ) VALUES(?1,?2,?3,?4,?5,?6,?7,?8)
  `).bind(
    tenantId,
    moduleIdValue,
    providerMessageId,
    selectedPhoneId,
    input.status,
    input.providerTimestampMs,
    errorCode || null,
    receivedAt(),
  ).run()

  const previousProviderTime = row.last_provider_status_at_ms ?? -1
  if (input.providerTimestampMs < previousProviderTime) {
    return { updated: false, reason: 'stale_timestamp', status: row.status }
  }
  if (row.status === 'failed' && input.status !== 'failed') {
    return { updated: false, reason: 'terminal_failed', status: row.status }
  }
  if (input.status !== 'failed' && normalRank(input.status) < normalRank(row.status)) {
    return { updated: false, reason: 'status_regression', status: row.status }
  }

  const nextStatus: WhatsAppMessageStatusV1 = input.status
  const updatedAt = receivedAt()
  await database.prepare(`
    UPDATE whatsapp_outbound_messages
    SET status=?4,error_code=?5,last_provider_status_at_ms=?6,updated_at_ms=?7
    WHERE tenant_id=?1 AND module_id=?2 AND idempotency_key=?3
  `).bind(
    tenantId,
    moduleIdValue,
    row.idempotency_key,
    nextStatus,
    nextStatus === 'failed' ? (errorCode || 'WHATSAPP_PROVIDER_FAILED') : null,
    input.providerTimestampMs,
    updatedAt,
  ).run()

  await setChatDeliveryMetadata(database, row, {
    channel: 'whatsapp',
    delivery_status: nextStatus,
    delivery_error_code: nextStatus === 'failed' ? (errorCode || 'WHATSAPP_PROVIDER_FAILED') : null,
    whatsapp_phone_number_id: selectedPhoneId,
    provider_status_at: iso(input.providerTimestampMs),
  })
  return { updated: true, status: nextStatus }
}
