import { isVisualPreviewSession } from './visualPreview'

const API_BASE = (import.meta.env.VITE_API_URL || '/api').replace(/\/$/, '')

async function apiRequest(path, options = {}) {
  if (isVisualPreviewSession()) {
    if (path.startsWith('/app/settings')) {
      return {
        settings: {
          store_name: 'Ambiente de demonstração',
          printer_width: '80',
        },
      }
    }

    if ((options.method || 'GET').toUpperCase() === 'GET') return {}

    const previewError = new Error('O modo visual local não salva alterações.')
    previewError.code = 'VISUAL_PREVIEW_READ_ONLY'
    throw previewError
  }

  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  })

  const payload = await response.json().catch(() => ({}))

  if (!response.ok) {
    const error = new Error(payload.error?.message || payload.error || payload.message || payload.code || 'Erro ao processar a solicitação.')
    error.status = response.status
    error.code = payload.error?.code || payload.code || ''
    throw error
  }

  return payload
}

export function getAppBootstrap() {
  return apiRequest('/app/bootstrap', { method: 'GET' })
}

export function getAppSettings({ tenantId, moduleId }) {
  const params = new URLSearchParams({ tenant_id: tenantId, module_id: moduleId })
  return apiRequest(`/app/settings?${params.toString()}`, { method: 'GET' })
}

export async function createAppTenant(name) {
  const storageKey = `@yuisync-tenant-creation:${name}`
  const operationKey = sessionStorage.getItem(storageKey) || crypto.randomUUID()
  sessionStorage.setItem(storageKey, operationKey)
  const result = await apiRequest('/app/tenants', {
    method: 'POST',
    headers: { 'idempotency-key': operationKey },
    body: JSON.stringify({ name }),
  })
  sessionStorage.removeItem(storageKey)
  return result
}

export function checkoutPetshop(payload) {
  return apiRequest('/petshop/checkout', {
    method: 'POST',
    body: JSON.stringify(payload),
  }).then((response) => response.data)
}

export function updatePetshopServiceRules(serviceId, { tenantId, moduleId = 'petshop', ...rules }) {
  return apiRequest(`/petshop/services/${encodeURIComponent(serviceId)}/rules`, {
    method: 'PATCH',
    headers: {
      'x-tenant-id': tenantId,
      'x-module-id': moduleId,
    },
    body: JSON.stringify(rules),
  }).then((response) => response.service)
}

export function requestChatReply(sessionId, message, options = {}) {
  return apiRequest('/chat/respond', {
    method: 'POST',
    body: JSON.stringify({
      sessionId,
      message,
      clientMessageId: options.clientMessageId,
    }),
  })
}

export function sendHumanChatMessage(sessionId, message) {
  return apiRequest('/chat/human-message', {
    method: 'POST',
    body: JSON.stringify({ sessionId, message }),
  })
}

export async function listManagedUsers(moduleId, options = {}) {
  const params = new URLSearchParams()
  if (moduleId) params.set('module_id', moduleId)
  if (options.tenantId) params.set('tenant_id', options.tenantId)
  const query = params.size ? `?${params.toString()}` : ''
  const { profiles } = await apiRequest(`/admin/users${query}`, { method: 'GET' })
  return profiles || []
}

export function createManagedUser(payload) {
  return apiRequest('/admin/users', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function updateManagedUser(userId, payload) {
  return apiRequest(`/admin/users/${userId}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  })
}

export function updateManagedUserStatus(userId, active) {
  return apiRequest(`/admin/users/${userId}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ active }),
  })
}

export function issueFiscalForSale(saleId) {
  return apiRequest(`/fiscal/sales/${saleId}/issue`, {
    method: 'POST',
    body: JSON.stringify({}),
  })
}

export function resetChatHistory({ moduleId, tenantId }) {
  return apiRequest('/admin/maintenance/reset-chat', {
    method: 'POST',
    body: JSON.stringify({
      moduleId,
      tenantId,
      confirm: 'RESET_CHAT_HISTORY',
    }),
  })
}

export function resetStock({ moduleId, tenantId }) {
  return apiRequest('/admin/maintenance/reset-stock', {
    method: 'POST',
    body: JSON.stringify({
      moduleId,
      tenantId,
      confirm: 'RESET_STOCK',
    }),
  })
}

export function importLegacyRows({ kind, rows, moduleId, tenantId }) {
  return apiRequest('/admin/maintenance/legacy-import', {
    method: 'POST',
    body: JSON.stringify({
      kind,
      rows,
      moduleId,
      tenantId,
    }),
  })
}

export function prepareLunaEvalPlatform({ tenantId }) {
  return apiRequest('/admin/petbot-e2e', {
    method: 'POST',
    body: JSON.stringify({
      tenantId,
      action: 'luna_eval_plan',
      confirm: 'PREPARE_LUNA_EVAL_PLATFORM',
    }),
  })
}

export function runLunaEvalPlatform({ tenantId, scenarioNames = [], maxCases = 500 }) {
  return apiRequest('/admin/petbot-e2e', {
    method: 'POST',
    body: JSON.stringify({
      tenantId,
      scenarioNames,
      maxCases,
      action: 'luna_eval_run',
      confirm: 'RUN_LUNA_EVAL_PLATFORM',
    }),
  })
}

export function preparePetbotDiagnosticSuite({ tenantId }) {
  return apiRequest('/admin/petbot-e2e', {
    method: 'POST',
    body: JSON.stringify({
      tenantId,
      action: 'plan',
      confirm: 'PREPARE_PETBOT_DIAGNOSTIC_50',
    }),
  })
}

export function runPetbotDiagnosticCase({ tenantId, scenarioId, suiteId }) {
  return apiRequest('/admin/petbot-e2e', {
    method: 'POST',
    body: JSON.stringify({
      tenantId,
      scenarioId,
      suiteId,
      action: 'run_case',
      confirm: 'RUN_PETBOT_DIAGNOSTIC_CASE',
    }),
  })
}

export function runPetbotLiveE2E({ tenantId }) {
  return preparePetbotDiagnosticSuite({ tenantId })
}

export function searchProductImages({ name, barcode, category, brand, moduleId, tenantId, limit = 8 }) {
  return apiRequest('/products/image-suggestions', {
    method: 'POST',
    body: JSON.stringify({
      name,
      barcode,
      category,
      brand,
      moduleId,
      tenantId,
      limit,
    }),
  })
}

export async function getMetaWhatsappReview({ tenantId, includeTemplates = false }) {
  const onboarding = await apiRequest(`/whatsapp/onboarding/status?tenant_id=${encodeURIComponent(tenantId)}`, { method: 'GET' })
  const connected = (onboarding.connections || []).filter((connection) => connection.status === 'connected')
  const primary = connected.length === 1 ? connected[0] : null
  let templates = []
  if (includeTemplates && primary) {
    const params = new URLSearchParams({
      tenant_id: tenantId,
      phone_number_id: primary.phone_number_id,
    })
    const result = await apiRequest(`/whatsapp/templates?${params.toString()}`, { method: 'GET' })
    templates = result.templates || []
  }
  return {
    status: {
      connected: Boolean(primary),
      canSendMessages: Boolean(primary),
      canManageTemplates: Boolean(primary),
      source: 'cloudflare_d1',
      tokenMode: 'encrypted_tenant_credential',
      channelActive: Boolean(primary),
      phoneNumberId: primary?.phone_number_id || '',
      businessAccountId: primary?.waba_id || '',
      permissions: ['business_management', 'whatsapp_business_management', 'whatsapp_business_messaging'],
      reviewerNote: 'YuiSync stores the Meta access token encrypted server-side per tenant and phone number. It is never exposed in the browser.',
      selectionRequired: connected.length > 1,
    },
    templates,
  }
}

export function sendMetaWhatsappReviewMessage({
  tenantId,
  moduleId = 'petshop',
  to,
  message,
  phoneNumberId = null,
}) {
  return apiRequest('/whatsapp/send', {
    method: 'POST',
    body: JSON.stringify({
      tenant_id: tenantId,
      module_id: moduleId,
      to,
      text: message,
      idempotency_key: crypto.randomUUID(),
      ...(phoneNumberId ? { phone_number_id: phoneNumberId } : {}),
    }),
  }).then((payload) => ({
    ...payload,
    result: {
      ...(payload.result || {}),
      messages: payload.result?.provider_message_id ? [{ id: payload.result.provider_message_id }] : [],
    },
  }))
}

export function createMetaWhatsappTemplate({
  tenantId,
  phoneNumberId,
  name,
  category,
  language,
  bodyText,
}) {
  return apiRequest('/whatsapp/templates', {
    method: 'POST',
    body: JSON.stringify({
      tenant_id: tenantId,
      phone_number_id: phoneNumberId,
      name,
      category,
      language,
      body_text: bodyText,
    }),
  })
}
