import { hash } from 'bcryptjs'

import { getBetterAuthSession, type BetterAuthRuntimeBindings } from './auth/betterAuthRuntime'
import { sendCustomerActivationEmail } from './auth/passwordRecoveryEmail'

type Bindings = BetterAuthRuntimeBindings & { DB?: D1Database; AUTH_DB?: D1Database }
type SessionResolver = typeof getBetterAuthSession
export type CustomerOnboardingDependencies = { getSession?: SessionResolver }

type InvitationContext = {
  invitation_id: string
  checkout_order_id: string
  email: string
  token_hash: string
  invitation_status: string
  send_count: number
  sent_at_ms: number | null
  expires_at_ms: number
  customer_name: string
  business_name: string
  order_status: string
  tenant_id: string | null
  billing_status: string | null
}

type PrincipalRow = { id: string; status: string; email: string | null }
type FirstRunRow = {
  status: string
  current_step: string
  completed_steps_json: string
  support_status: string
  support_availability: string | null
  completed_at_ms: number | null
  updated_at_ms: number
}

const INVITATION_TTL_MS = 24 * 60 * 60 * 1000
const INVITATION_RESEND_COOLDOWN_MS = 60 * 1000
const MAX_INVITATION_SENDS = 5
const PASSWORD = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{12,128}$/
const STEPS = new Set(['empresa', 'horarios', 'servicos', 'equipe', 'tour', 'suporte', 'concluido'])

function json(body: unknown, status = 200, headers?: HeadersInit): Response {
  const merged = new Headers(headers)
  merged.set('cache-control', 'no-store')
  return Response.json(body, { status, headers: merged })
}

function safeString(value: unknown, max = 255): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

function sameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin')
  return Boolean(origin && origin === new URL(request.url).origin)
}

function base64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function randomToken(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return base64Url(bytes)
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function maskEmail(email: string): string {
  const [local, domain] = email.split('@')
  if (!domain) return '***'
  const visible = local.slice(0, Math.min(2, local.length))
  return `${visible}${'*'.repeat(Math.max(3, local.length - visible.length))}@${domain}`
}

function slugify(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 90)
}

function invitationUrl(origin: string, token: string): string {
  return `${origin}/boas-vindas?convite=${encodeURIComponent(token)}`
}

async function invitationByToken(database: D1Database, token: string): Promise<InvitationContext | null> {
  const tokenHash = await sha256(token)
  return database.prepare(`
    SELECT i.id AS invitation_id,i.checkout_order_id,i.email,i.token_hash,i.status AS invitation_status,
           i.send_count,i.sent_at_ms,i.expires_at_ms,o.customer_name,o.business_name,o.status AS order_status,
           o.tenant_id,s.status AS billing_status
    FROM platform_onboarding_invitations i
    JOIN platform_checkout_orders o ON o.id=i.checkout_order_id
    LEFT JOIN platform_billing_subscriptions s ON s.checkout_order_id=o.id
    WHERE i.token_hash=?1
    LIMIT 1
  `).bind(tokenHash).first<InvitationContext>()
}

async function orderBySession(database: D1Database, sessionId: string) {
  return database.prepare(`
    SELECT o.id AS checkout_order_id,o.customer_email AS email,o.customer_name,o.business_name,
           o.status AS order_status,o.tenant_id,s.status AS billing_status,
           i.status AS invitation_status,i.sent_at_ms,i.send_count,i.expires_at_ms,i.last_error_code
    FROM platform_checkout_orders o
    LEFT JOIN platform_billing_subscriptions s ON s.checkout_order_id=o.id
    LEFT JOIN platform_onboarding_invitations i ON i.checkout_order_id=o.id
    WHERE o.stripe_checkout_session_id=?1
    LIMIT 1
  `).bind(sessionId).first<Record<string, unknown>>()
}

function paymentConfirmed(order: Record<string, unknown> | InvitationContext): boolean {
  return order.order_status === 'complete' && ['active', 'trialing'].includes(String(order.billing_status || ''))
}

async function issueInvitation(
  bindings: Bindings,
  orderId: string,
  origin: string,
  force: boolean,
): Promise<{ sent: boolean; email: string; expiresAt: number }> {
  if (!bindings.DB) throw new Error('DATABASE_NOT_CONFIGURED')
  const order = await bindings.DB.prepare(`
    SELECT o.id AS checkout_order_id,o.customer_email AS email,o.customer_name,o.business_name,
           o.status AS order_status,o.tenant_id,s.status AS billing_status,
           i.id AS invitation_id,i.status AS invitation_status,i.sent_at_ms,i.send_count,i.expires_at_ms,i.last_error_code
    FROM platform_checkout_orders o
    LEFT JOIN platform_billing_subscriptions s ON s.checkout_order_id=o.id
    LEFT JOIN platform_onboarding_invitations i ON i.checkout_order_id=o.id
    WHERE o.id=?1 LIMIT 1
  `).bind(orderId).first<Record<string, unknown>>()
  if (!order || !paymentConfirmed(order)) throw new Error('PAYMENT_NOT_CONFIRMED')
  if (order.tenant_id) throw new Error('ONBOARDING_ALREADY_ACTIVATED')

  const now = Date.now()
  const sentAt = Number(order.sent_at_ms || 0)
  const sendCount = Number(order.send_count || 0)
  const pending = order.invitation_status === 'pending'
    && Number(order.expires_at_ms || 0) > now
    && !order.last_error_code
  if (pending && !force && sentAt) {
    return { sent: false, email: String(order.email), expiresAt: Number(order.expires_at_ms) }
  }
  if (force && sentAt && now - sentAt < INVITATION_RESEND_COOLDOWN_MS) throw new Error('INVITATION_RATE_LIMITED')
  if (sendCount >= MAX_INVITATION_SENDS) throw new Error('INVITATION_SEND_LIMIT')

  const token = randomToken()
  const tokenHash = await sha256(token)
  const expiresAt = now + INVITATION_TTL_MS
  const invitationId = String(order.invitation_id || crypto.randomUUID())
  await bindings.DB.prepare(`
    INSERT INTO platform_onboarding_invitations(
      id,checkout_order_id,email,token_hash,status,send_count,expires_at_ms,created_at_ms,updated_at_ms
    ) VALUES(?1,?2,?3,?4,'pending',?5,?6,?7,?7)
    ON CONFLICT(checkout_order_id) DO UPDATE SET
      token_hash=excluded.token_hash,status='pending',expires_at_ms=excluded.expires_at_ms,
      accepted_at_ms=NULL,last_error_code=NULL,updated_at_ms=excluded.updated_at_ms
  `).bind(invitationId, orderId, order.email, tokenHash, sendCount, expiresAt, now).run()

  try {
    await sendCustomerActivationEmail(bindings, String(order.email), invitationUrl(origin, token), String(order.business_name))
    await bindings.DB.prepare(`
      UPDATE platform_onboarding_invitations
      SET send_count=send_count+1,sent_at_ms=?1,last_error_code=NULL,updated_at_ms=?1
      WHERE checkout_order_id=?2
    `).bind(Date.now(), orderId).run()
  } catch (error) {
    await bindings.DB.prepare(`
      UPDATE platform_onboarding_invitations SET last_error_code='DELIVERY_FAILED',updated_at_ms=?1
      WHERE checkout_order_id=?2
    `).bind(Date.now(), orderId).run()
    throw error
  }
  return { sent: true, email: String(order.email), expiresAt }
}

export async function sendCustomerOnboardingInviteForOrder(
  bindings: Bindings,
  orderId: string,
  origin: string,
): Promise<void> {
  if (!bindings.AUTH_EMAIL_API_KEY || !bindings.AUTH_EMAIL_FROM) return
  try {
    await issueInvitation(bindings, orderId, origin, false)
  } catch (error) {
    const code = error instanceof Error ? error.message : 'UNKNOWN'
    if (!['ONBOARDING_ALREADY_ACTIVATED', 'PAYMENT_NOT_CONFIRMED'].includes(code)) {
      console.error(JSON.stringify({ event: 'customer_onboarding.invitation_failed', code }))
    }
  }
}

async function publicStatus(request: Request, bindings: Bindings): Promise<Response> {
  if (!bindings.DB) return json({ code: 'DATABASE_NOT_CONFIGURED' }, 503)
  const sessionId = safeString(new URL(request.url).searchParams.get('session_id'))
  if (!sessionId) return json({ code: 'INVALID_SESSION' }, 400)
  const order = await orderBySession(bindings.DB, sessionId)
  if (!order) return json({ code: 'ORDER_NOT_FOUND' }, 404)
  return json({
    payment: paymentConfirmed(order) ? 'confirmed' : order.order_status === 'complete' ? 'processing' : order.order_status,
    invitation: order.invitation_status || 'not_sent',
    email: maskEmail(String(order.email)),
    businessName: String(order.business_name),
    activated: Boolean(order.tenant_id),
  })
}

async function requestInvitation(request: Request, bindings: Bindings): Promise<Response> {
  if (!sameOrigin(request)) return json({ code: 'ORIGIN_FORBIDDEN' }, 403)
  if (!bindings.DB) return json({ code: 'DATABASE_NOT_CONFIGURED' }, 503)
  let body: Record<string, unknown>
  try { body = await request.json() as Record<string, unknown> } catch { return json({ code: 'INVALID_JSON' }, 400) }
  const sessionId = safeString(body.sessionId)
  if (!sessionId) return json({ code: 'INVALID_SESSION' }, 400)
  const order = await orderBySession(bindings.DB, sessionId)
  if (!order) return json({ code: 'ORDER_NOT_FOUND' }, 404)
  try {
    const result = await issueInvitation(bindings, String(order.checkout_order_id), new URL(request.url).origin, body.resend === true)
    return json({ sent: result.sent, email: maskEmail(result.email), expiresAt: result.expiresAt }, result.sent ? 201 : 200)
  } catch (error) {
    const code = error instanceof Error ? error.message : 'INVITATION_FAILED'
    const status = code === 'INVITATION_RATE_LIMITED' || code === 'INVITATION_SEND_LIMIT' ? 429
      : code === 'ONBOARDING_ALREADY_ACTIVATED' ? 409
        : code === 'PAYMENT_NOT_CONFIRMED' ? 409 : 503
    return json({ code }, status)
  }
}

async function inspectInvitation(request: Request, bindings: Bindings, token: string): Promise<Response> {
  if (!bindings.DB || !bindings.AUTH_DB) return json({ code: 'DATABASE_NOT_CONFIGURED' }, 503)
  const invitation = await invitationByToken(bindings.DB, token)
  if (!invitation || invitation.invitation_status !== 'pending') return json({ code: 'INVITATION_INVALID' }, 404)
  if (invitation.expires_at_ms <= Date.now()) return json({ code: 'INVITATION_EXPIRED' }, 410)
  if (!paymentConfirmed(invitation)) return json({ code: 'PAYMENT_NOT_CONFIRMED' }, 409)
  const account = await bindings.AUTH_DB.prepare('SELECT id FROM user WHERE lower(email)=lower(?1) LIMIT 1').bind(invitation.email).first()
  return json({
    valid: true,
    email: maskEmail(invitation.email),
    businessName: invitation.business_name,
    accountExists: Boolean(account),
  })
}

async function provision(
  bindings: Bindings,
  invitation: InvitationContext,
  user: { id: string; name: string; email: string },
  principalId: string,
): Promise<string> {
  const database = bindings.DB!
  if (invitation.tenant_id) return invitation.tenant_id
  const suffix = (await sha256(invitation.checkout_order_id)).slice(0, 24)
  const tenantId = `tenant-${suffix}`
  const slug = `${slugify(invitation.business_name) || 'empresa'}-${suffix.slice(0, 8)}`
  const now = Date.now()
  const permissions = '{"petshop":{"role":"admin_pet"}}'
  const extensionDefaults = JSON.stringify({
    business_email: invitation.email,
    receipt_format: '80',
    printer_width: '80',
    petshop_operational_staff: [],
    petshop_delivery_staff: [],
    message_templates: { __petshop_operational_staff: [], __petshop_delivery_staff: [] },
  })

  const current = await database.prepare('SELECT tenant_id FROM platform_checkout_orders WHERE id=?1 LIMIT 1')
    .bind(invitation.checkout_order_id).first<{ tenant_id: string | null }>()
  if (current?.tenant_id && current.tenant_id !== tenantId) throw new Error('ORDER_ALREADY_LINKED')

  await database.batch([
    database.prepare(`
      INSERT INTO identity_principals(id,provider,subject,display_name,email,status,created_at_ms,updated_at_ms)
      VALUES(?1,'better-auth',?2,?3,?4,'active',?5,?5)
      ON CONFLICT(provider,subject) DO UPDATE SET display_name=excluded.display_name,email=excluded.email,status='active',updated_at_ms=excluded.updated_at_ms
    `).bind(principalId, user.id, user.name, user.email, now),
    database.prepare(`INSERT INTO tenants(id,slug,name,status,created_at_ms,updated_at_ms)
      VALUES(?1,?2,?3,'active',?4,?4) ON CONFLICT(id) DO NOTHING`)
      .bind(tenantId, slug, invitation.business_name, now),
    database.prepare(`INSERT INTO tenant_module_settings(tenant_id,module_id,store_name,store_phone,store_address,store_neighborhood,store_city,bot_prompt,version,created_at_ms,updated_at_ms)
      VALUES(?1,'petshop',?2,'','','','','',1,?3,?3) ON CONFLICT DO NOTHING`)
      .bind(tenantId, invitation.business_name, now),
    database.prepare(`INSERT INTO module_settings_extensions(tenant_id,module_id,data_json,updated_at_ms)
      VALUES(?1,'petshop',?2,?3) ON CONFLICT DO NOTHING`).bind(tenantId, extensionDefaults, now),
    database.prepare(`INSERT INTO tenant_memberships(tenant_id,principal_id,status,created_at_ms,updated_at_ms,role,module_permissions_json)
      VALUES(?1,?2,'active',?3,?3,'owner',?4)
      ON CONFLICT(tenant_id,principal_id) DO UPDATE SET status='active',role='owner',module_permissions_json=excluded.module_permissions_json,updated_at_ms=excluded.updated_at_ms`)
      .bind(tenantId, principalId, now, permissions),
    database.prepare(`INSERT INTO managed_user_profiles(principal_id,staff_type,preferred_tenant_id,created_at_ms,updated_at_ms)
      VALUES(?1,'gerente',?2,?3,?3)
      ON CONFLICT(principal_id) DO UPDATE SET staff_type='gerente',preferred_tenant_id=excluded.preferred_tenant_id,updated_at_ms=excluded.updated_at_ms`)
      .bind(principalId, tenantId, now),
    database.prepare(`INSERT INTO profiles(id,full_name,email,role,active,allowed_modules,module_permissions,created_at,updated_at)
      VALUES(?1,?2,?3,'member',1,'["petshop"]','{"petshop":"admin_pet"}',?4,?4)
      ON CONFLICT(id) DO UPDATE SET full_name=excluded.full_name,email=excluded.email,active=1,updated_at=excluded.updated_at`)
      .bind(principalId, user.name, user.email, new Date(now).toISOString()),
    database.prepare(`INSERT INTO tenant_first_run(tenant_id,checkout_order_id,status,current_step,completed_steps_json,created_at_ms,updated_at_ms)
      VALUES(?1,?2,'in_progress','empresa','[]',?3,?3)
      ON CONFLICT(tenant_id) DO UPDATE SET checkout_order_id=COALESCE(tenant_first_run.checkout_order_id,excluded.checkout_order_id),updated_at_ms=excluded.updated_at_ms`)
      .bind(tenantId, invitation.checkout_order_id, now),
    database.prepare('UPDATE platform_checkout_orders SET tenant_id=?1,principal_id=?2,updated_at_ms=?3 WHERE id=?4 AND (tenant_id IS NULL OR tenant_id=?1)')
      .bind(tenantId, principalId, now, invitation.checkout_order_id),
    database.prepare('UPDATE platform_billing_subscriptions SET tenant_id=?1,updated_at_ms=?2 WHERE checkout_order_id=?3 AND (tenant_id IS NULL OR tenant_id=?1)')
      .bind(tenantId, now, invitation.checkout_order_id),
    database.prepare(`UPDATE platform_onboarding_invitations SET status='accepted',accepted_at_ms=?1,updated_at_ms=?1
      WHERE id=?2 AND status='pending'`).bind(now, invitation.invitation_id),
  ])
  return tenantId
}

async function activateInvitation(request: Request, bindings: Bindings): Promise<Response> {
  if (!sameOrigin(request)) return json({ code: 'ORIGIN_FORBIDDEN' }, 403)
  if (!bindings.DB || !bindings.AUTH_DB) return json({ code: 'DATABASE_NOT_CONFIGURED' }, 503)
  let body: Record<string, unknown>
  try { body = await request.json() as Record<string, unknown> } catch { return json({ code: 'INVALID_JSON' }, 400) }
  const token = safeString(body.token, 200)
  const password = safeString(body.password, 128)
  if (!token) return json({ code: 'INVITATION_INVALID' }, 400)
  if (!PASSWORD.test(password) || new TextEncoder().encode(password).byteLength > 72) return json({ code: 'INVALID_PASSWORD' }, 400)
  const invitation = await invitationByToken(bindings.DB, token)
  if (!invitation || invitation.invitation_status !== 'pending') return json({ code: 'INVITATION_INVALID' }, 404)
  if (invitation.expires_at_ms <= Date.now()) return json({ code: 'INVITATION_EXPIRED' }, 410)
  if (!paymentConfirmed(invitation)) return json({ code: 'PAYMENT_NOT_CONFIRMED' }, 409)

  const expectedUserId = `activation-${invitation.invitation_id}`
  const existing = await bindings.AUTH_DB.prepare('SELECT id,name,email FROM user WHERE lower(email)=lower(?1) LIMIT 1')
    .bind(invitation.email).first<{ id: string; name: string; email: string }>()
  if (existing && existing.id !== expectedUserId) return json({ code: 'ACCOUNT_EXISTS' }, 409)

  const now = new Date().toISOString()
  const passwordHash = await hash(password, 12)
  if (!existing) {
    await bindings.AUTH_DB.batch([
      bindings.AUTH_DB.prepare(`INSERT INTO user(id,name,email,emailVerified,image,createdAt,updatedAt)
        VALUES(?1,?2,?3,1,NULL,?4,?4)`).bind(expectedUserId, invitation.customer_name, invitation.email, now),
      bindings.AUTH_DB.prepare(`INSERT INTO account(id,userId,accountId,providerId,password,createdAt,updatedAt)
        VALUES(?1,?2,?2,'credential',?3,?4,?4)`).bind(`credential:${expectedUserId}`, expectedUserId, passwordHash, now),
    ])
  } else {
    await bindings.AUTH_DB.prepare(`UPDATE account SET password=?1,updatedAt=?2 WHERE userId=?3 AND providerId='credential'`)
      .bind(passwordHash, now, expectedUserId).run()
  }

  try {
    const tenantId = await provision(bindings, invitation, {
      id: expectedUserId,
      name: invitation.customer_name,
      email: invitation.email,
    }, `principal-${invitation.invitation_id}`)
    return json({ activated: true, email: invitation.email, tenantId }, 201)
  } catch {
    return json({ code: 'ACTIVATION_PROVISIONING_FAILED' }, 500)
  }
}

async function claimInvitation(request: Request, bindings: Bindings, dependencies: CustomerOnboardingDependencies): Promise<Response> {
  if (!sameOrigin(request)) return json({ code: 'ORIGIN_FORBIDDEN' }, 403)
  if (!bindings.DB || !bindings.AUTH_DB) return json({ code: 'DATABASE_NOT_CONFIGURED' }, 503)
  const session = await (dependencies.getSession || getBetterAuthSession)(request, bindings)
  const userId = safeString(session?.user?.id)
  const sessionEmail = safeString(session?.user?.email, 320).toLowerCase()
  if (!userId || !sessionEmail) return json({ code: 'UNAUTHENTICATED' }, 401)
  let body: Record<string, unknown>
  try { body = await request.json() as Record<string, unknown> } catch { return json({ code: 'INVALID_JSON' }, 400) }
  const token = safeString(body.token, 200)
  const invitation = token ? await invitationByToken(bindings.DB, token) : null
  if (!invitation || invitation.invitation_status !== 'pending') return json({ code: 'INVITATION_INVALID' }, 404)
  if (invitation.expires_at_ms <= Date.now()) return json({ code: 'INVITATION_EXPIRED' }, 410)
  if (sessionEmail !== invitation.email.toLowerCase()) return json({ code: 'INVITATION_ACCOUNT_MISMATCH' }, 403)
  if (!paymentConfirmed(invitation)) return json({ code: 'PAYMENT_NOT_CONFIRMED' }, 409)

  const authUser = await bindings.AUTH_DB.prepare('SELECT id,name,email FROM user WHERE id=?1 LIMIT 1')
    .bind(userId).first<{ id: string; name: string; email: string }>()
  if (!authUser) return json({ code: 'ACCOUNT_NOT_FOUND' }, 404)
  let principal = await bindings.DB.prepare(`SELECT id,status,email FROM identity_principals WHERE provider='better-auth' AND subject=?1 LIMIT 1`)
    .bind(userId).first<PrincipalRow>()
  if (!principal) {
    principal = { id: `principal-${(await sha256(userId)).slice(0, 32)}`, status: 'active', email: authUser.email }
  }
  try {
    const tenantId = await provision(bindings, invitation, authUser, principal.id)
    return json({ activated: true, tenantId })
  } catch {
    return json({ code: 'ACTIVATION_PROVISIONING_FAILED' }, 500)
  }
}

function parseCompleted(raw: string | null | undefined): string[] {
  try {
    const parsed = JSON.parse(raw || '[]')
    return Array.isArray(parsed) ? parsed.filter((step) => typeof step === 'string' && STEPS.has(step)) : []
  } catch { return [] }
}

async function resolveFirstRunScope(
  request: Request,
  bindings: Bindings,
  dependencies: CustomerOnboardingDependencies,
): Promise<{ ok: true; tenantId: string; principalId: string } | { ok: false; response: Response }> {
  if (!bindings.DB) return { ok: false, response: json({ code: 'DATABASE_NOT_CONFIGURED' }, 503) }
  const session = await (dependencies.getSession || getBetterAuthSession)(request, bindings)
  const userId = safeString(session?.user?.id)
  if (!userId) return { ok: false, response: json({ code: 'UNAUTHENTICATED' }, 401) }
  const tenantId = safeString(new URL(request.url).searchParams.get('tenant_id'), 160)
  if (!tenantId) return { ok: false, response: json({ code: 'INVALID_SCOPE' }, 400) }
  const row = await bindings.DB.prepare(`
    SELECT p.id AS principal_id,m.role,m.status AS membership_status,t.status AS tenant_status
    FROM identity_principals p JOIN tenant_memberships m ON m.principal_id=p.id
    JOIN tenants t ON t.id=m.tenant_id
    WHERE p.provider='better-auth' AND p.subject=?1 AND p.status='active' AND m.tenant_id=?2 LIMIT 1
  `).bind(userId, tenantId).first<{ principal_id: string; role: string; membership_status: string; tenant_status: string }>()
  if (!row || row.membership_status !== 'active' || row.tenant_status !== 'active' || !['owner', 'admin'].includes(row.role)) {
    return { ok: false, response: json({ code: 'FORBIDDEN' }, 403) }
  }
  return { ok: true, tenantId, principalId: row.principal_id }
}

async function firstRunSnapshot(database: D1Database, tenantId: string) {
  const [row, settings, serviceCount, extension] = await Promise.all([
    database.prepare(`SELECT status,current_step,completed_steps_json,support_status,support_availability,completed_at_ms,updated_at_ms
      FROM tenant_first_run WHERE tenant_id=?1 LIMIT 1`).bind(tenantId).first<FirstRunRow>(),
    database.prepare(`SELECT store_name FROM tenant_module_settings WHERE tenant_id=?1 AND module_id='petshop' LIMIT 1`)
      .bind(tenantId).first<{ store_name: string }>(),
    database.prepare(`SELECT COUNT(*) AS count FROM services WHERE tenant_id=?1 AND module_id='petshop' AND status='active'`)
      .bind(tenantId).first<{ count: number }>(),
    database.prepare(`SELECT data_json FROM module_settings_extensions WHERE tenant_id=?1 AND module_id='petshop' LIMIT 1`)
      .bind(tenantId).first<{ data_json: string }>(),
  ])
  let hoursReady = false
  try {
    const data = JSON.parse(extension?.data_json || '{}')
    hoursReady = Boolean(data.store_business_hours && Object.values(data.store_business_hours).some((periods) => Array.isArray(periods) && periods.length))
  } catch { /* invalid legacy extensions are treated as pending */ }
  const readiness = {
    company: Boolean(settings?.store_name?.trim()),
    schedule: hoursReady,
    services: Number(serviceCount?.count || 0) > 0,
  }
  return {
    status: row?.status || 'in_progress',
    currentStep: row?.current_step || 'empresa',
    completedSteps: parseCompleted(row?.completed_steps_json),
    support: { status: row?.support_status || 'not_requested', availability: row?.support_availability || '' },
    readiness,
    canComplete: Object.values(readiness).every(Boolean),
    completedAt: row?.completed_at_ms || null,
    updatedAt: row?.updated_at_ms || null,
  }
}

async function publishSupportRequest(
  database: D1Database,
  tenantId: string,
  principalId: string,
  availability: string,
  now: number,
): Promise<void> {
  const threadId = `first-run-${tenantId}`
  const messageId = `first-run-${(await sha256(`${tenantId}:${availability}`)).slice(0, 32)}`
  const preview = `Disponibilidade para implantação: ${availability}`.slice(0, 240)
  await database.batch([
    database.prepare(`
      INSERT INTO support_threads(
        tenant_id,module_id,id,requester_profile_id,status,priority,source,subject,
        last_message_at_ms,created_at_ms,updated_at_ms,last_message_preview
      ) VALUES(?1,'petshop',?2,?3,'pending','high','first_run','Sessão de implantação',?4,?4,?4,?5)
      ON CONFLICT(tenant_id,module_id,id) DO UPDATE SET
        status='pending',priority='high',last_message_at_ms=excluded.last_message_at_ms,
        updated_at_ms=excluded.updated_at_ms,last_message_preview=excluded.last_message_preview
    `).bind(tenantId, threadId, principalId, now, preview),
    database.prepare(`
      INSERT INTO support_messages(tenant_id,module_id,id,thread_id,sender_profile_id,sender_type,body,created_at_ms)
      VALUES(?1,'petshop',?2,?3,?4,'user',?5,?6)
      ON CONFLICT(tenant_id,module_id,id) DO NOTHING
    `).bind(tenantId, messageId, threadId, principalId, preview, now),
  ])
}

async function firstRun(request: Request, bindings: Bindings, dependencies: CustomerOnboardingDependencies): Promise<Response> {
  const scope = await resolveFirstRunScope(request, bindings, dependencies)
  if (!scope.ok) return scope.response
  if (request.method === 'GET') return json(await firstRunSnapshot(bindings.DB!, scope.tenantId))
  if (request.method !== 'PATCH') return json({ code: 'METHOD_NOT_ALLOWED' }, 405, { allow: 'GET, PATCH' })
  if (!sameOrigin(request)) return json({ code: 'ORIGIN_FORBIDDEN' }, 403)
  let body: Record<string, unknown>
  try { body = await request.json() as Record<string, unknown> } catch { return json({ code: 'INVALID_JSON' }, 400) }
  const currentStep = body.currentStep == null ? null : safeString(body.currentStep, 32)
  const completedStep = body.completedStep == null ? null : safeString(body.completedStep, 32)
  const supportAvailability = body.supportAvailability == null ? null : safeString(body.supportAvailability, 500)
  const complete = body.complete === true
  if ((currentStep && !STEPS.has(currentStep)) || (completedStep && !STEPS.has(completedStep))) return json({ code: 'INVALID_STEP' }, 400)
  if (supportAvailability !== null && supportAvailability.length < 3) return json({ code: 'INVALID_SUPPORT_AVAILABILITY' }, 400)

  const current = await bindings.DB!.prepare('SELECT completed_steps_json FROM tenant_first_run WHERE tenant_id=?1 LIMIT 1')
    .bind(scope.tenantId).first<{ completed_steps_json: string }>()
  const completed = parseCompleted(current?.completed_steps_json)
  if (completedStep && !completed.includes(completedStep)) completed.push(completedStep)
  const snapshot = await firstRunSnapshot(bindings.DB!, scope.tenantId)
  if (complete && !snapshot.canComplete) return json({ code: 'ONBOARDING_REQUIREMENTS_PENDING', readiness: snapshot.readiness }, 409)
  const now = Date.now()
  await bindings.DB!.prepare(`
    INSERT INTO tenant_first_run(
      tenant_id,status,current_step,completed_steps_json,support_status,support_availability,completed_at_ms,created_at_ms,updated_at_ms
    ) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?8)
    ON CONFLICT(tenant_id) DO UPDATE SET
      status=excluded.status,current_step=excluded.current_step,completed_steps_json=excluded.completed_steps_json,
      support_status=CASE WHEN excluded.support_availability IS NOT NULL THEN 'requested' ELSE tenant_first_run.support_status END,
      support_availability=COALESCE(excluded.support_availability,tenant_first_run.support_availability),
      completed_at_ms=COALESCE(excluded.completed_at_ms,tenant_first_run.completed_at_ms),updated_at_ms=excluded.updated_at_ms
  `).bind(
    scope.tenantId,
    complete ? 'completed' : 'in_progress',
    complete ? 'concluido' : currentStep || snapshot.currentStep,
    JSON.stringify(completed),
    supportAvailability !== null ? 'requested' : snapshot.support.status,
    supportAvailability,
    complete ? now : null,
    now,
  ).run()
  if (supportAvailability !== null) {
    await publishSupportRequest(bindings.DB!, scope.tenantId, scope.principalId, supportAvailability, now)
  }
  return json(await firstRunSnapshot(bindings.DB!, scope.tenantId))
}

export async function handleCustomerOnboardingApiRequest(
  request: Request,
  bindings: Bindings,
  dependencies: CustomerOnboardingDependencies = {},
): Promise<Response | null> {
  const { pathname } = new URL(request.url)
  if (pathname === '/api/platform/onboarding/status' && request.method === 'GET') return publicStatus(request, bindings)
  if (pathname === '/api/platform/onboarding/invitations' && request.method === 'POST') return requestInvitation(request, bindings)
  const inviteMatch = /^\/api\/platform\/onboarding\/invitations\/([^/]+)$/.exec(pathname)
  if (inviteMatch && request.method === 'GET') return inspectInvitation(request, bindings, decodeURIComponent(inviteMatch[1]))
  if (pathname === '/api/platform/onboarding/activate' && request.method === 'POST') return activateInvitation(request, bindings)
  if (pathname === '/api/platform/onboarding/claim' && request.method === 'POST') return claimInvitation(request, bindings, dependencies)
  if (pathname === '/api/app/first-run') return firstRun(request, bindings, dependencies)
  if (pathname.startsWith('/api/platform/onboarding/') || pathname === '/api/app/first-run') return json({ code: 'METHOD_NOT_ALLOWED' }, 405)
  return null
}
