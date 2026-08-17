import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  FilePlus2,
  Link2,
  Loader2,
  MessageSquareText,
  RefreshCw,
  ShieldCheck,
  Webhook,
} from 'lucide-react'
import { useAuthCtx } from '../../context/AuthContext'
import {
  createMetaWhatsappTemplate,
  getMetaWhatsappReview,
  sendMetaWhatsappReviewMessage,
} from '../../lib/api'
import {
  completeWhatsappOnboarding,
  getWhatsappOnboardingStatus,
  retryWhatsappSubscription,
} from '../../lib/whatsappOnboardingApi'

const FACEBOOK_SDK_ID = 'facebook-jssdk'
const META_MESSAGE_ORIGINS = new Set(['https://www.facebook.com', 'https://web.facebook.com'])

function createReviewTemplateName() {
  const now = new Date()
  const stamp = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
    String(now.getHours()).padStart(2, '0'),
    String(now.getMinutes()).padStart(2, '0'),
  ].join('')
  return `yuisync_review_${stamp}`
}

function ResultBanner({ result }) {
  if (!result?.text) return null
  const success = result.type === 'success'
  return (
    <div className={`flex items-start gap-3 rounded-2xl border px-4 py-3 text-sm ${success
      ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-200'
      : 'border-red-500/20 bg-red-500/10 text-red-200'}`}
    >
      {success ? <CheckCircle2 size={18} className="mt-0.5 shrink-0" /> : <AlertTriangle size={18} className="mt-0.5 shrink-0" />}
      <span>{result.text}</span>
    </div>
  )
}

function StatusPill({ enabled, children }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-bold ${enabled
      ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300'
      : 'border-amber-500/20 bg-amber-500/10 text-amber-200'}`}
    >
      {enabled ? <CheckCircle2 size={13} /> : <AlertTriangle size={13} />}
      {children}
    </span>
  )
}

function SectionCard({ icon: Icon, step, title, description, children }) {
  return (
    <section className="rounded-3xl border border-[var(--border2)] bg-surface p-5 shadow-sm sm:p-7">
      <div className="flex items-start gap-4">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-emerald-500/10 text-emerald-400">
          <Icon size={21} />
        </div>
        <div>
          <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-400">Step {step}</p>
          <h2 className="mt-1 text-xl font-black text-text">{title}</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">{description}</p>
        </div>
      </div>
      <div className="mt-6">{children}</div>
    </section>
  )
}

function parseEmbeddedSignupMessage(event) {
  if (!META_MESSAGE_ORIGINS.has(event.origin)) return null
  let payload = event.data
  if (typeof payload === 'string') {
    try { payload = JSON.parse(payload) } catch { return null }
  }
  if (!payload || typeof payload !== 'object' || payload.type !== 'WA_EMBEDDED_SIGNUP') return null
  const data = payload.data && typeof payload.data === 'object' ? payload.data : {}
  const wabaId = String(data.waba_id || data.wabaId || '').trim()
  const phoneNumberId = String(data.phone_number_id || data.phoneNumberId || '').trim()
  if (!/^\d+$/.test(wabaId)) return null
  return {
    wabaId,
    phoneNumberId: /^\d+$/.test(phoneNumberId) ? phoneNumberId : null,
  }
}

function loadFacebookSdk(appId, graphVersion) {
  return new Promise((resolve, reject) => {
    const initialize = () => {
      if (!window.FB) return reject(new Error('Facebook SDK did not initialize.'))
      window.FB.init({ appId, cookie: true, xfbml: false, version: graphVersion })
      resolve(window.FB)
    }
    if (window.FB) return initialize()
    const existing = document.getElementById(FACEBOOK_SDK_ID)
    if (existing) {
      existing.addEventListener('load', initialize, { once: true })
      existing.addEventListener('error', () => reject(new Error('Facebook SDK could not be loaded.')), { once: true })
      return
    }
    const script = document.createElement('script')
    script.id = FACEBOOK_SDK_ID
    script.async = true
    script.defer = true
    script.crossOrigin = 'anonymous'
    script.src = 'https://connect.facebook.net/en_US/sdk.js'
    script.onload = initialize
    script.onerror = () => reject(new Error('Facebook SDK could not be loaded.'))
    document.body.appendChild(script)
  })
}

export default function MetaWhatsappPage() {
  const { activeTenantId } = useAuthCtx()
  const [loading, setLoading] = useState(true)
  const [status, setStatus] = useState(null)
  const [onboarding, setOnboarding] = useState(null)
  const [templates, setTemplates] = useState([])
  const [pageResult, setPageResult] = useState(null)
  const [connecting, setConnecting] = useState(false)
  const [subscribing, setSubscribing] = useState(false)
  const signupSessionRef = useRef(null)

  const [messageForm, setMessageForm] = useState({
    to: '',
    message: 'Hello from YuiSync. This message was sent through the WhatsApp Cloud API for Meta App Review.',
  })
  const [sending, setSending] = useState(false)
  const [messageResult, setMessageResult] = useState(null)

  const [templateForm, setTemplateForm] = useState({
    name: createReviewTemplateName(),
    category: 'UTILITY',
    language: 'en_US',
    bodyText: 'Your appointment has been confirmed. Contact us in this WhatsApp conversation if you need to change it.',
  })
  const [creatingTemplate, setCreatingTemplate] = useState(false)
  const [refreshingTemplates, setRefreshingTemplates] = useState(false)
  const [templateResult, setTemplateResult] = useState(null)

  const permissionText = useMemo(() => (status?.permissions || []).join(', '), [status?.permissions])
  const primaryConnection = onboarding?.connections?.[0] || null

  const loadReviewData = async ({ includeTemplates = true, silent = false } = {}) => {
    if (!activeTenantId) {
      setLoading(false)
      return
    }
    if (!silent) setLoading(true)
    try {
      const [reviewResult, onboardingResult] = await Promise.allSettled([
        getMetaWhatsappReview({ tenantId: activeTenantId, moduleId: 'petshop', includeTemplates }),
        getWhatsappOnboardingStatus(activeTenantId),
      ])
      if (reviewResult.status === 'fulfilled') {
        setStatus(reviewResult.value.status || null)
        setTemplates(reviewResult.value.templates || [])
      }
      if (onboardingResult.status === 'fulfilled') setOnboarding(onboardingResult.value)
      if (reviewResult.status === 'rejected' && onboardingResult.status === 'rejected') {
        throw onboardingResult.reason || reviewResult.reason
      }
      setPageResult(null)
    } catch (error) {
      setPageResult({ type: 'error', text: error.message })
    } finally {
      setLoading(false)
      setRefreshingTemplates(false)
    }
  }

  useEffect(() => { loadReviewData() }, [activeTenantId])

  useEffect(() => {
    const listener = (event) => {
      const session = parseEmbeddedSignupMessage(event)
      if (session) signupSessionRef.current = session
    }
    window.addEventListener('message', listener)
    return () => window.removeEventListener('message', listener)
  }, [])

  const waitForSignupSession = async () => {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      if (signupSessionRef.current?.wabaId) return signupSessionRef.current
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    throw new Error('Meta did not return the WhatsApp Business Account session information.')
  }

  const startEmbeddedSignup = async () => {
    if (!activeTenantId || !onboarding?.configured) return
    setConnecting(true)
    setPageResult(null)
    signupSessionRef.current = null
    try {
      const config = onboarding.embedded_signup
      const FB = await loadFacebookSdk(config.appId, config.graphVersion)
      const authResponse = await new Promise((resolve, reject) => {
        FB.login((response) => {
          const code = response?.authResponse?.code
          if (!code) return reject(new Error('Meta Embedded Signup was cancelled or did not return an authorization code.'))
          resolve({ code })
        }, {
          config_id: config.configurationId,
          response_type: 'code',
          override_default_response_type: true,
          extras: {
            setup: {},
            featureType: config.featureType,
            sessionInfoVersion: config.sessionInfoVersion,
          },
        })
      })
      const session = await waitForSignupSession()
      await completeWhatsappOnboarding({
        tenantId: activeTenantId,
        code: authResponse.code,
        wabaId: session.wabaId,
        phoneNumberId: session.phoneNumberId,
      })
      setPageResult({ type: 'success', text: 'WhatsApp Business connected. The Meta access token stayed server-side and the WABA was subscribed to the YuiSync webhook.' })
      await loadReviewData({ includeTemplates: true, silent: true })
    } catch (error) {
      setPageResult({ type: 'error', text: error.message })
      await loadReviewData({ includeTemplates: true, silent: true })
    } finally {
      setConnecting(false)
    }
  }

  const retrySubscription = async () => {
    if (!activeTenantId || !primaryConnection?.phone_number_id) return
    setSubscribing(true)
    setPageResult(null)
    try {
      await retryWhatsappSubscription({ tenantId: activeTenantId, phoneNumberId: primaryConnection.phone_number_id })
      setPageResult({ type: 'success', text: 'WABA webhook subscription confirmed.' })
      await loadReviewData({ includeTemplates: true, silent: true })
    } catch (error) {
      setPageResult({ type: 'error', text: error.message })
    } finally {
      setSubscribing(false)
    }
  }

  const sendMessage = async (event) => {
    event.preventDefault()
    if (!activeTenantId) return
    setSending(true)
    setMessageResult(null)
    try {
      const payload = await sendMetaWhatsappReviewMessage({ tenantId: activeTenantId, moduleId: 'petshop', ...messageForm })
      const messageId = payload.result?.messages?.[0]?.id
      setMessageResult({ type: 'success', text: messageId ? `Message sent successfully. Meta message ID: ${messageId}` : 'Message sent successfully through the WhatsApp Cloud API.' })
    } catch (error) {
      setMessageResult({ type: 'error', text: error.message })
    } finally {
      setSending(false)
    }
  }

  const createTemplate = async (event) => {
    event.preventDefault()
    if (!activeTenantId) return
    setCreatingTemplate(true)
    setTemplateResult(null)
    try {
      const payload = await createMetaWhatsappTemplate({ tenantId: activeTenantId, moduleId: 'petshop', ...templateForm })
      const result = payload.result || {}
      setTemplateResult({ type: 'success', text: `Template created through the Graph API. ID: ${result.id || 'returned by Meta'}, status: ${result.status || 'PENDING'}.` })
      setTemplateForm((current) => ({ ...current, name: createReviewTemplateName() }))
      await loadReviewData({ includeTemplates: true, silent: true })
    } catch (error) {
      setTemplateResult({ type: 'error', text: error.message })
    } finally {
      setCreatingTemplate(false)
    }
  }

  const refreshTemplates = async () => {
    setRefreshingTemplates(true)
    setTemplateResult(null)
    await loadReviewData({ includeTemplates: true, silent: true })
  }

  if (loading) {
    return (
      <div className="flex min-h-[70vh] items-center justify-center">
        <div className="flex items-center gap-3 text-muted"><Loader2 className="animate-spin" size={20} /> Loading Meta WhatsApp review workspace...</div>
      </div>
    )
  }

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 px-4 py-6 sm:px-6 lg:px-8">
      <header className="rounded-3xl border border-emerald-500/20 bg-gradient-to-br from-emerald-500/10 to-transparent p-6 sm:p-8">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.22em] text-emerald-400">Meta App Review</p>
            <h1 className="mt-2 text-3xl font-black tracking-tight text-text sm:text-4xl">WhatsApp Business Platform</h1>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-muted sm:text-base">This workspace demonstrates onboarding, sending a WhatsApp message and managing message templates.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <StatusPill enabled={primaryConnection?.status === 'connected'}>Embedded Signup</StatusPill>
            <StatusPill enabled={Boolean(status?.canSendMessages)}>Messaging API</StatusPill>
            <StatusPill enabled={Boolean(status?.canManageTemplates)}>Template Management</StatusPill>
          </div>
        </div>
        <div className="mt-6 grid gap-3 text-xs sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-2xl border border-[var(--border2)] bg-surface/70 p-4"><p className="font-bold uppercase tracking-wider text-muted">Onboarding</p><p className="mt-2 font-black text-text">Authorization code → server</p></div>
          <div className="rounded-2xl border border-[var(--border2)] bg-surface/70 p-4"><p className="font-bold uppercase tracking-wider text-muted">Phone Number ID</p><p className="mt-2 break-all font-black text-text">{primaryConnection?.phone_number_id || status?.phoneNumberId || 'Not configured'}</p></div>
          <div className="rounded-2xl border border-[var(--border2)] bg-surface/70 p-4"><p className="font-bold uppercase tracking-wider text-muted">WABA ID</p><p className="mt-2 break-all font-black text-text">{primaryConnection?.waba_id || status?.businessAccountId || 'Not configured'}</p></div>
          <div className="rounded-2xl border border-[var(--border2)] bg-surface/70 p-4"><p className="font-bold uppercase tracking-wider text-muted">Credential storage</p><p className="mt-2 font-black text-text">Encrypted server-side</p></div>
        </div>
      </header>

      <ResultBanner result={pageResult} />
      {!activeTenantId && <ResultBanner result={{ type: 'error', text: 'Select an active business before managing its WhatsApp integration.' }} />}

      <SectionCard
        icon={Link2}
        step="1"
        title="Connect WhatsApp Business with Meta Embedded Signup"
        description="The business owner completes Meta's official flow in this page. YuiSync sends only the temporary authorization code and Embedded Signup asset identifiers to the Worker; the resulting access token is never returned to the browser."
      >
        <div className="rounded-2xl border border-[var(--border2)] bg-bg/40 p-4">
          {primaryConnection ? (
            <div className="grid gap-3 text-sm sm:grid-cols-2">
              <div><span className="text-muted">Status</span><p className="mt-1 font-black capitalize text-text">{primaryConnection.status}</p></div>
              <div><span className="text-muted">Business</span><p className="mt-1 font-black text-text">{primaryConnection.verified_name || primaryConnection.display_phone_number || primaryConnection.phone_number_id}</p></div>
              <div><span className="text-muted">WABA ID</span><p className="mt-1 break-all font-mono text-xs text-text">{primaryConnection.waba_id}</p></div>
              <div><span className="text-muted">Phone Number ID</span><p className="mt-1 break-all font-mono text-xs text-text">{primaryConnection.phone_number_id}</p></div>
            </div>
          ) : <p className="text-sm text-muted">No WhatsApp Business account is connected to this tenant yet.</p>}

          <div className="mt-4 flex flex-wrap gap-3">
            <button type="button" className="btn btn-primary gap-2" disabled={connecting || !activeTenantId || !onboarding?.configured} onClick={startEmbeddedSignup}>
              {connecting ? <Loader2 size={15} className="animate-spin" /> : <Link2 size={15} />}
              {primaryConnection ? 'Reconnect WhatsApp Business' : 'Connect WhatsApp Business'}
            </button>
            {primaryConnection?.status === 'pending' && (
              <button type="button" className="btn btn-secondary gap-2" disabled={subscribing} onClick={retrySubscription}>
                {subscribing ? <Loader2 size={15} className="animate-spin" /> : <Webhook size={15} />}
                Retry webhook subscription
              </button>
            )}
          </div>
          {!onboarding?.configured && <p className="mt-3 text-xs text-amber-300">Embedded Signup is not configured on the Cloudflare Worker yet. The Meta App ID, configuration ID, redirect URI, App Secret and credential-encryption key must be provided server-side.</p>}
          <p className="mt-3 text-xs leading-5 text-muted">No access token, App Secret or encryption key is exposed by this page or its status endpoint.</p>
        </div>
      </SectionCard>

      <SectionCard icon={MessageSquareText} step="2" title="Send a WhatsApp message" description="Record this section together with WhatsApp Web or the mobile app receiving the same message. The Graph API call is executed by the YuiSync backend.">
        <form onSubmit={sendMessage} className="space-y-4">
          <label className="block space-y-2 text-sm font-bold text-text">Recipient number in international format<input className="input w-full" inputMode="tel" value={messageForm.to} onChange={(event) => setMessageForm((current) => ({ ...current, to: event.target.value }))} placeholder="Example: 5532985205279" required /></label>
          <label className="block space-y-2 text-sm font-bold text-text">Message<textarea className="input min-h-28 w-full resize-y py-3" value={messageForm.message} onChange={(event) => setMessageForm((current) => ({ ...current, message: event.target.value }))} required /></label>
          <button type="submit" className="btn btn-primary gap-2" disabled={sending || !status?.canSendMessages}>{sending ? <Loader2 size={15} className="animate-spin" /> : <MessageSquareText size={15} />} Send through WhatsApp Cloud API</button>
          <ResultBanner result={messageResult} />
          {!status?.canSendMessages && <p className="text-xs text-amber-300">Connect a WhatsApp Business number to this tenant before sending. Outbound uses the tenant-scoped credential stored encrypted on the Cloudflare Worker.</p>}
        </form>
      </SectionCard>

      <SectionCard icon={FilePlus2} step="3" title="Create and manage a message template" description="Meta requires a separate video showing a real template creation API call. Submit this form, keep the success response visible, then refresh the list below.">
        <form onSubmit={createTemplate} className="grid gap-4 md:grid-cols-2">
          <label className="space-y-2 text-sm font-bold text-text">Template name<input className="input w-full" value={templateForm.name} onChange={(event) => setTemplateForm((current) => ({ ...current, name: event.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_') }))} required /></label>
          <label className="space-y-2 text-sm font-bold text-text">Language<select className="input w-full" value={templateForm.language} onChange={(event) => setTemplateForm((current) => ({ ...current, language: event.target.value }))}><option value="en_US">English (US)</option><option value="pt_BR">Portuguese (Brazil)</option></select></label>
          <label className="space-y-2 text-sm font-bold text-text">Category<select className="input w-full" value={templateForm.category} onChange={(event) => setTemplateForm((current) => ({ ...current, category: event.target.value }))}><option value="UTILITY">UTILITY</option><option value="MARKETING">MARKETING</option></select></label>
          <label className="space-y-2 text-sm font-bold text-text md:col-span-2">Template body<textarea className="input min-h-28 w-full resize-y py-3" value={templateForm.bodyText} onChange={(event) => setTemplateForm((current) => ({ ...current, bodyText: event.target.value }))} required /></label>
          <div className="flex flex-wrap gap-3 md:col-span-2">
            <button type="submit" className="btn btn-primary gap-2" disabled={creatingTemplate || !status?.canManageTemplates}>{creatingTemplate ? <Loader2 size={15} className="animate-spin" /> : <FilePlus2 size={15} />} Create template through Graph API</button>
            <button type="button" className="btn btn-secondary gap-2" disabled={refreshingTemplates || !status?.canManageTemplates} onClick={refreshTemplates}><RefreshCw size={15} className={refreshingTemplates ? 'animate-spin' : ''} /> Refresh templates</button>
          </div>
          <div className="md:col-span-2"><ResultBanner result={templateResult} /></div>
        </form>
        <div className="mt-7 overflow-hidden rounded-2xl border border-[var(--border2)]">
          <div className="flex items-center justify-between border-b border-[var(--border2)] bg-bg/50 px-4 py-3"><h3 className="font-black text-text">Templates returned by Meta</h3><span className="text-xs font-bold text-muted">{templates.length} item(s)</span></div>
          {templates.length === 0 ? <p className="px-4 py-8 text-center text-sm text-muted">No templates loaded yet.</p> : (
            <div className="overflow-x-auto"><table className="w-full min-w-[680px] text-left text-sm"><thead className="bg-bg/40 text-xs uppercase tracking-wider text-muted"><tr><th className="px-4 py-3">Name</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Category</th><th className="px-4 py-3">Language</th><th className="px-4 py-3">Meta ID</th></tr></thead><tbody>{templates.map((template) => <tr key={template.id || `${template.name}-${template.language}`} className="border-t border-[var(--border2)] text-text"><td className="px-4 py-3 font-bold">{template.name}</td><td className="px-4 py-3">{template.status || 'UNKNOWN'}</td><td className="px-4 py-3">{template.category || '-'}</td><td className="px-4 py-3">{template.language || '-'}</td><td className="px-4 py-3 font-mono text-xs text-muted">{template.id || '-'}</td></tr>)}</tbody></table></div>
          )}
        </div>
      </SectionCard>

      <section className="rounded-3xl border border-blue-500/20 bg-blue-500/10 p-5 sm:p-7">
        <div className="flex items-start gap-4"><ShieldCheck size={24} className="mt-0.5 shrink-0 text-blue-300" /><div className="space-y-3"><h2 className="text-lg font-black text-blue-100">Notes for the Meta reviewer</h2><p className="text-sm leading-6 text-blue-100/80">{status?.reviewerNote}</p><p className="text-sm leading-6 text-blue-100/80">Requested advanced permissions: <strong>{permissionText || 'business_management, whatsapp_business_management, whatsapp_business_messaging'}</strong>.</p><p className="text-sm leading-6 text-blue-100/80">Embedded Signup returns a short-lived authorization code to the browser. YuiSync exchanges that code and stores the operational credential only in the Cloudflare backend.</p></div></div>
      </section>
    </div>
  )
}
