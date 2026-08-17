import type { IncomingMessage, ServerResponse } from 'node:http'
import { adminSupabase } from '../server/lib/supabase.js'
import { isModuleAdmin, requireAuthenticatedProfile } from '../server/lib/auth.js'
import {
  getBearerToken,
  HttpError,
  readJsonBody,
  sendJson,
  validateUUID,
} from '../server/lib/http.js'
import { resolveWhatsappConfig } from '../server/lib/whatsapp.js'

type LooseRecord = Record<string, any>
type JsonBody = Record<string, unknown>

const DEFAULT_MODULE_ID = 'petshop'
const GRAPH_BASE_URL = 'https://graph.facebook.com'
const DEFAULT_GRAPH_VERSION = 'v25.0'
const HOSTED_SIGNUP_URL = process.env.META_HOSTED_SIGNUP_URL
  || 'https://business.facebook.com/messaging/whatsapp/onboard/?app_id=844551911447117&config_id=1014067771245749&extras=%7B%22version%22%3A%22v4%22%2C%22sessionInfoVersion%22%3A%223%22%2C%22featureType%22%3A%22whatsapp_business_app_onboarding%22%7D'

function clean(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function asRecord(value: unknown): LooseRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as LooseRecord
    : {}
}

function digits(value: unknown): string {
  return clean(value).replace(/\D/g, '')
}

function getUrl(req: IncomingMessage) {
  return new URL(req.url || '/', `https://${req.headers.host || 'localhost'}`)
}

function graphVersion(value: unknown): string {
  return (clean(value) || clean(process.env.WHATSAPP_GRAPH_VERSION) || DEFAULT_GRAPH_VERSION)
    .replace(/^\/+/, '')
}

function handleApiError(res: ServerResponse, error: unknown) {
  const status = error instanceof HttpError ? error.status : 500
  const message = error instanceof Error ? error.message : 'Unable to process the Meta WhatsApp request.'

  if (status >= 500) {
    console.error('[meta-whatsapp-api]', error)
  }

  sendJson(res, status, { error: message })
}

async function requireReviewAccess(
  req: IncomingMessage,
  tenantId: string,
  moduleId: string,
) {
  const accessToken = getBearerToken(req)
  const profile = await requireAuthenticatedProfile(accessToken)

  if (!isModuleAdmin(profile, moduleId)) {
    throw new HttpError(403, 'Only a module administrator can manage the Meta WhatsApp integration.')
  }

  if (profile.role !== 'admin' && profile.active_tenant_id !== tenantId) {
    throw new HttpError(403, 'Select the business that owns this WhatsApp account before continuing.')
  }

  return profile
}

async function loadWhatsappChannel(tenantId: string, moduleId: string) {
  const { data, error } = await adminSupabase
    .from('tenant_bot_channels')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('module_id', moduleId)
    .eq('channel', 'whatsapp')
    .maybeSingle()

  if (error) {
    throw new HttpError(500, `Unable to load the WhatsApp channel: ${error.message}`)
  }

  return data as LooseRecord | null
}

async function safeResolveWhatsappConfig(tenantId: string, moduleId: string) {
  try {
    return await resolveWhatsappConfig({
      tenantId,
      moduleId,
      requireMessaging: false,
    })
  } catch {
    return null
  }
}

function resolveBusinessAccountId(channel: LooseRecord | null): string {
  return clean(channel?.whatsapp_business_account_id)
    || clean(process.env.WHATSAPP_BUSINESS_ACCOUNT_ID)
}

async function graphRequest(
  config: LooseRecord,
  path: string,
  options: { method?: string, body?: LooseRecord } = {},
) {
  const accessToken = clean(config.accessToken)
  if (!accessToken) {
    throw new HttpError(409, 'A system-user access token is not configured for this business.')
  }

  const response = await fetch(
    `${GRAPH_BASE_URL}/${graphVersion(config.graphVersion)}/${path.replace(/^\/+/, '')}`,
    {
      method: options.method || 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      ...(options.body ? { body: JSON.stringify(options.body) } : {}),
    },
  )

  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    const graphError = asRecord(payload.error)
    const detail = clean(graphError.message) || `Graph API HTTP ${response.status}`
    const code = graphError.code ? ` (code ${graphError.code})` : ''
    throw new HttpError(502, `${detail}${code}`)
  }

  return payload as LooseRecord
}

async function buildStatus(tenantId: string, moduleId: string) {
  const channel = await loadWhatsappChannel(tenantId, moduleId)
  const config = await safeResolveWhatsappConfig(tenantId, moduleId)
  const phoneNumberId = clean(config?.phoneNumberId)
    || clean(channel?.whatsapp_phone_number_id)
    || clean(process.env.WHATSAPP_PHONE_NUMBER_ID)
  const businessAccountId = resolveBusinessAccountId(channel)
  const hasToken = Boolean(clean(config?.accessToken) || clean(process.env.WHATSAPP_ACCESS_TOKEN))

  return {
    connected: Boolean(phoneNumberId && hasToken),
    canSendMessages: Boolean(phoneNumberId && hasToken),
    canManageTemplates: Boolean(businessAccountId && hasToken),
    source: clean(config?.source) || (channel ? 'database' : 'not_configured'),
    tokenMode: 'system_user',
    channelActive: channel?.active === true,
    phoneNumberId,
    businessAccountId,
    hostedSignupUrl: HOSTED_SIGNUP_URL,
    permissions: [
      'business_management',
      'whatsapp_business_management',
      'whatsapp_business_messaging',
    ],
    reviewerNote: 'YuiSync uses a system-user access token on the server. The access token is never exposed in the browser.',
  }
}

async function saveAssetIds(
  tenantId: string,
  moduleId: string,
  body: JsonBody,
) {
  const businessAccountId = digits(body.businessAccountId)
  const phoneNumberId = digits(body.phoneNumberId)

  if (!businessAccountId && !phoneNumberId) {
    throw new HttpError(400, 'Enter a WhatsApp Business Account ID or Phone Number ID.')
  }

  const current = await loadWhatsappChannel(tenantId, moduleId)
  const row: LooseRecord = {
    tenant_id: tenantId,
    module_id: moduleId,
    channel: 'whatsapp',
    bot_label: clean(current?.bot_label) || 'YuiSync WhatsApp',
    active: current?.active !== false,
    updated_at: new Date().toISOString(),
  }

  if (businessAccountId) row.whatsapp_business_account_id = businessAccountId
  if (phoneNumberId) row.whatsapp_phone_number_id = phoneNumberId

  const { data, error } = await adminSupabase
    .from('tenant_bot_channels')
    .upsert(row, { onConflict: 'tenant_id,module_id,channel' })
    .select('*')
    .single()

  if (error) {
    const lower = String(error.message || '').toLowerCase()
    if (lower.includes('whatsapp_business_account_id') || lower.includes('schema cache')) {
      throw new HttpError(409, 'Run the Meta WhatsApp review migration in Supabase before saving the asset IDs.')
    }
    throw new HttpError(500, `Unable to save the WhatsApp asset IDs: ${error.message}`)
  }

  return data
}

async function listMessageTemplates(tenantId: string, moduleId: string) {
  const channel = await loadWhatsappChannel(tenantId, moduleId)
  const businessAccountId = resolveBusinessAccountId(channel)
  if (!businessAccountId) {
    throw new HttpError(409, 'WhatsApp Business Account ID is not configured.')
  }

  const config = await resolveWhatsappConfig({
    tenantId,
    moduleId,
    requireMessaging: false,
  })
  const fields = encodeURIComponent('id,name,status,category,language,quality_score,rejected_reason')
  const payload = await graphRequest(
    config,
    `${encodeURIComponent(businessAccountId)}/message_templates?fields=${fields}&limit=50`,
  )

  return Array.isArray(payload.data) ? payload.data : []
}

async function createMessageTemplate(
  tenantId: string,
  moduleId: string,
  body: JsonBody,
) {
  const channel = await loadWhatsappChannel(tenantId, moduleId)
  const businessAccountId = resolveBusinessAccountId(channel)
  if (!businessAccountId) {
    throw new HttpError(409, 'WhatsApp Business Account ID is not configured.')
  }

  const name = clean(body.name).toLowerCase()
  const language = clean(body.language) || 'en_US'
  const category = clean(body.category).toUpperCase() || 'UTILITY'
  const bodyText = clean(body.bodyText)

  if (!/^[a-z0-9_]{1,512}$/.test(name)) {
    throw new HttpError(400, 'Template name may contain only lowercase letters, numbers and underscores.')
  }
  if (!/^[a-z]{2}_[A-Z]{2}$/.test(language)) {
    throw new HttpError(400, 'Use a language code such as en_US or pt_BR.')
  }
  if (!['UTILITY', 'MARKETING', 'AUTHENTICATION'].includes(category)) {
    throw new HttpError(400, 'Select a valid template category.')
  }
  if (!bodyText || bodyText.length > 1024) {
    throw new HttpError(400, 'Template body is required and must have at most 1,024 characters.')
  }

  const config = await resolveWhatsappConfig({
    tenantId,
    moduleId,
    requireMessaging: false,
  })

  return graphRequest(
    config,
    `${encodeURIComponent(businessAccountId)}/message_templates`,
    {
      method: 'POST',
      body: {
        name,
        language,
        category,
        allow_category_change: true,
        components: [
          {
            type: 'BODY',
            text: bodyText,
          },
        ],
      },
    },
  )
}

async function subscribeBusinessAccount(tenantId: string, moduleId: string) {
  const channel = await loadWhatsappChannel(tenantId, moduleId)
  const businessAccountId = resolveBusinessAccountId(channel)
  if (!businessAccountId) {
    throw new HttpError(409, 'WhatsApp Business Account ID is not configured.')
  }

  const config = await resolveWhatsappConfig({
    tenantId,
    moduleId,
    requireMessaging: false,
  })

  return graphRequest(
    config,
    `${encodeURIComponent(businessAccountId)}/subscribed_apps`,
    { method: 'POST' },
  )
}

export async function handleMetaWhatsappApi(req: IncomingMessage, res: ServerResponse) {
  try {
    const url = getUrl(req)

    if (req.method === 'GET') {
      const tenantId = clean(url.searchParams.get('tenant_id'))
      const moduleId = clean(url.searchParams.get('module_id')) || DEFAULT_MODULE_ID
      validateUUID(tenantId, 'tenantId')
      await requireReviewAccess(req, tenantId, moduleId)

      const status = await buildStatus(tenantId, moduleId)
      const includeTemplates = url.searchParams.get('include_templates') === '1'
      const templates = includeTemplates && status.canManageTemplates
        ? await listMessageTemplates(tenantId, moduleId)
        : []

      sendJson(res, 200, { status, templates })
      return
    }

    if (req.method !== 'POST') {
      throw new HttpError(405, 'Method not allowed.')
    }

    const body = await readJsonBody(req) as JsonBody
    const tenantId = clean(body.tenantId)
    const moduleId = clean(body.moduleId) || DEFAULT_MODULE_ID
    const action = clean(body.action)

    validateUUID(tenantId, 'tenantId')
    await requireReviewAccess(req, tenantId, moduleId)

    let result: unknown
    if (action === 'save_asset_ids') {
      result = await saveAssetIds(tenantId, moduleId, body)
    } else if (action === 'send_message') {
      throw new HttpError(410, 'Legacy WhatsApp sending is disabled. Use the Cloudflare /api/whatsapp/send route.')
    } else if (action === 'create_template') {
      result = await createMessageTemplate(tenantId, moduleId, body)
    } else if (action === 'subscribe_waba') {
      result = await subscribeBusinessAccount(tenantId, moduleId)
    } else {
      throw new HttpError(400, 'Unknown Meta WhatsApp action.')
    }

    sendJson(res, 200, {
      ok: true,
      result,
      status: await buildStatus(tenantId, moduleId),
    })
  } catch (error) {
    handleApiError(res, error)
  }
}
