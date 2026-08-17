const API_BASE = (import.meta.env.VITE_API_URL || '/api').replace(/\/$/, '')

async function onboardingRequest(path, options = {}) {
  const response = await fetch(`${API_BASE}/whatsapp/onboarding${path}`, {
    credentials: 'include',
    ...options,
    headers: {
      'content-type': 'application/json',
      ...(options.headers || {}),
    },
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    const error = new Error(payload?.code || `WhatsApp onboarding failed (${response.status}).`)
    error.code = payload?.code || 'WHATSAPP_ONBOARDING_FAILED'
    error.retryable = Boolean(payload?.retryable)
    throw error
  }
  return payload
}

export function getWhatsappOnboardingStatus(tenantId) {
  return onboardingRequest(`/status?tenant_id=${encodeURIComponent(tenantId)}`, { method: 'GET' })
}

export function completeWhatsappOnboarding({ tenantId, code, wabaId, phoneNumberId }) {
  return onboardingRequest('/complete', {
    method: 'POST',
    body: JSON.stringify({
      tenant_id: tenantId,
      code,
      waba_id: wabaId,
      ...(phoneNumberId ? { phone_number_id: phoneNumberId } : {}),
    }),
  })
}

export function retryWhatsappSubscription({ tenantId, phoneNumberId }) {
  return onboardingRequest('/subscribe', {
    method: 'POST',
    body: JSON.stringify({ tenant_id: tenantId, phone_number_id: phoneNumberId }),
  })
}
