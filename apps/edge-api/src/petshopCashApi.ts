import { getBetterAuthSession, type BetterAuthRuntimeBindings } from './auth/betterAuthRuntime'

type Bindings = BetterAuthRuntimeBindings & { DB?: D1Database }
type Scope = { tenantId: string; moduleId: string; principalId: string }
type CashWindow = { startMs: number; endMs: number }

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/
const MODULE = /^[a-z0-9][a-z0-9_-]{0,63}$/
const MAX_WINDOW_MS = 32 * 24 * 60 * 60 * 1000

function json(body: unknown, status = 200, headers?: HeadersInit): Response {
  return Response.json(body, {
    status,
    headers: { 'cache-control': 'no-store', ...Object.fromEntries(new Headers(headers).entries()) },
  })
}

function text(value: unknown): string | null {
  const normalized = String(value ?? '').trim()
  return normalized || null
}

function hasModuleAccess(role: string, rawPermissions: string, moduleId: string): boolean {
  if (role === 'owner' || role === 'admin') return true
  try {
    const permissions = JSON.parse(rawPermissions || '{}') as Record<string, unknown>
    return permissions['*'] === true
      || permissions[moduleId] === true
      || Boolean(permissions[moduleId] && typeof permissions[moduleId] === 'object')
  } catch {
    return false
  }
}

async function resolveScope(request: Request, bindings: Bindings): Promise<{ scope?: Scope; error?: Response }> {
  if (!bindings.DB) return { error: json({ code: 'DATABASE_NOT_CONFIGURED' }, 503) }
  const tenantId = text(request.headers.get('x-tenant-id'))
  const moduleId = text(request.headers.get('x-module-id'))?.toLowerCase() || null
  if (!tenantId || !moduleId || !ID.test(tenantId) || !MODULE.test(moduleId)) {
    return { error: json({ code: 'INVALID_SCOPE' }, 400) }
  }

  const session = await getBetterAuthSession(request, bindings)
  const userId = text(session?.user?.id)
  if (!userId) return { error: json({ code: 'UNAUTHENTICATED' }, 401) }

  const principal = await bindings.DB!
    .prepare("SELECT id FROM identity_principals WHERE provider='better-auth' AND subject=?1 AND status='active' LIMIT 1")
    .bind(userId)
    .first<{ id: string }>()
  if (!principal?.id) return { error: json({ code: 'FORBIDDEN' }, 403) }

  const membership = await bindings.DB!
    .prepare("SELECT role,module_permissions_json FROM tenant_memberships WHERE tenant_id=?1 AND principal_id=?2 AND status='active' LIMIT 1")
    .bind(tenantId, principal.id)
    .first<{ role: string; module_permissions_json: string }>()
  if (!membership || !hasModuleAccess(membership.role, membership.module_permissions_json, moduleId)) {
    return { error: json({ code: 'FORBIDDEN' }, 403) }
  }
  return { scope: { tenantId, moduleId, principalId: principal.id } }
}

function parseWindowValues(start: unknown, end: unknown): { window?: CashWindow; error?: Response } {
  const startMs = Date.parse(String(start ?? ''))
  const endMs = Date.parse(String(end ?? ''))
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) {
    return { error: json({ code: 'INVALID_CASH_WINDOW' }, 400) }
  }
  if (endMs - startMs > MAX_WINDOW_MS) {
    return { error: json({ code: 'CASH_WINDOW_TOO_LARGE' }, 400) }
  }
  return { window: { startMs, endMs } }
}

function parseWindow(url: URL): { window?: CashWindow; error?: Response } {
  return parseWindowValues(url.searchParams.get('start'), url.searchParams.get('end'))
}

function legacyMethod(method: unknown): string {
  const normalized = String(method || '').trim().toLowerCase()
  if (!normalized) return 'outros'
  if (normalized === 'cash') return 'dinheiro'
  return normalized
}

function currencyToCents(value: unknown): number | null {
  const amount = Number(value)
  if (!Number.isFinite(amount)) return null
  const cents = Math.round(amount * 100)
  if (!Number.isSafeInteger(cents)) return null
  return cents
}

async function aggregateCash(
  db: D1Database,
  tenantId: string,
  moduleId: string,
  window: CashWindow,
): Promise<{ totalsByMethod: Record<string, number>; expectedCash: number }> {
  // This aggregate intentionally bypasses compatibility pagination. Semantics match
  // the legacy dashboard: completed sales created in the window use payment splits
  // created in the same window; if none exist, the whole sale falls back to the
  // first payment method known for that sale.
  const aggregate = await db.prepare(`
    WITH eligible_sales AS (
      SELECT s.id,s.total_cents
      FROM sales s
      WHERE s.tenant_id=?1 AND s.module_id=?2 AND s.status='completed'
        AND s.created_at_ms>=?3 AND s.created_at_ms<=?4
    ),
    window_payments AS (
      SELECT p.sale_id,p.method,p.amount_cents
      FROM payments p
      JOIN eligible_sales s ON s.id=p.sale_id
      WHERE p.tenant_id=?1 AND p.module_id=?2
        AND p.created_at_ms>=?3 AND p.created_at_ms<=?4
    ),
    effective_lines AS (
      SELECT sale_id,method,amount_cents FROM window_payments
      UNION ALL
      SELECT s.id,
        COALESCE((
          SELECT p.method FROM payments p
          WHERE p.tenant_id=?1 AND p.module_id=?2 AND p.sale_id=s.id
          ORDER BY p.created_at_ms,p.id LIMIT 1
        ),'outros') AS method,
        s.total_cents AS amount_cents
      FROM eligible_sales s
      WHERE NOT EXISTS (SELECT 1 FROM window_payments wp WHERE wp.sale_id=s.id)
    )
    SELECT method,SUM(amount_cents) AS amount_cents
    FROM effective_lines
    GROUP BY method
    ORDER BY method
  `).bind(tenantId, moduleId, window.startMs, window.endMs).all<{ method: string; amount_cents: number }>()

  const totalsByMethod: Record<string, number> = {}
  for (const row of aggregate.results || []) {
    const key = legacyMethod(row.method)
    totalsByMethod[key] = (totalsByMethod[key] || 0) + Number(row.amount_cents || 0) / 100
  }
  return {
    totalsByMethod,
    expectedCash: Number(totalsByMethod.dinheiro || 0),
  }
}

async function loadCashDashboard(request: Request, bindings: Bindings): Promise<Response> {
  const resolved = await resolveScope(request, bindings)
  if (resolved.error) return resolved.error
  const { tenantId, moduleId } = resolved.scope!
  const parsed = parseWindow(new URL(request.url))
  if (parsed.error) return parsed.error
  const window = parsed.window!

  const [cash, saleCountRow, registersResult, salesResult] = await Promise.all([
    aggregateCash(bindings.DB!, tenantId, moduleId, window),
    bindings.DB!.prepare(`
      SELECT COUNT(*) AS sale_count
      FROM sales
      WHERE tenant_id=?1 AND module_id=?2 AND status='completed'
        AND created_at_ms>=?3 AND created_at_ms<=?4
    `).bind(tenantId, moduleId, window.startMs, window.endMs).first<{ sale_count: number }>(),
    bindings.DB!.prepare(`
      SELECT id,opened_by,closed_by,opening_balance_cents,closing_balance_cents,
        expected_balance_cents,difference_cents,opened_at_ms,closed_at_ms,notes
      FROM cash_register
      WHERE tenant_id=?1 AND module_id=?2
      ORDER BY opened_at_ms DESC,id DESC
      LIMIT 30
    `).bind(tenantId, moduleId).all<any>(),
    // Recent sales are presentation data only. Aggregate totals above remain exact
    // at any volume and are not tied to this display limit.
    bindings.DB!.prepare(`
      SELECT s.id,s.total_cents,s.created_at_ms,
        (SELECT p.method FROM payments p
         WHERE p.tenant_id=s.tenant_id AND p.module_id=s.module_id AND p.sale_id=s.id
         ORDER BY p.created_at_ms,p.id LIMIT 1) AS payment_method
      FROM sales s
      WHERE s.tenant_id=?1 AND s.module_id=?2 AND s.status='completed'
        AND s.created_at_ms>=?3 AND s.created_at_ms<=?4
      ORDER BY s.created_at_ms DESC,s.id DESC
      LIMIT 200
    `).bind(tenantId, moduleId, window.startMs, window.endMs).all<any>(),
  ])

  const registers = (registersResult.results || []).map((row) => ({
    id: row.id,
    opened_by: row.opened_by,
    closed_by: row.closed_by,
    opening_balance: Number(row.opening_balance_cents || 0) / 100,
    closing_balance: row.closing_balance_cents == null ? null : Number(row.closing_balance_cents) / 100,
    expected_balance: row.expected_balance_cents == null ? null : Number(row.expected_balance_cents) / 100,
    difference: row.difference_cents == null ? null : Number(row.difference_cents) / 100,
    opened_at: new Date(Number(row.opened_at_ms)).toISOString(),
    closed_at: row.closed_at_ms == null ? null : new Date(Number(row.closed_at_ms)).toISOString(),
    notes: row.notes,
  }))

  const sales = (salesResult.results || []).map((row) => ({
    id: row.id,
    total_price: Number(row.total_cents || 0) / 100,
    payment_method: legacyMethod(row.payment_method),
    created_at: new Date(Number(row.created_at_ms)).toISOString(),
    status: 'concluido',
  }))

  return json({
    registers,
    current: registers.find((register) => !register.closed_at) || null,
    sales,
    saleCount: Number(saleCountRow?.sale_count || 0),
    totalsByMethod: cash.totalsByMethod,
    expectedCash: cash.expectedCash,
  })
}

async function closeCashRegister(request: Request, bindings: Bindings, registerId: string): Promise<Response> {
  const resolved = await resolveScope(request, bindings)
  if (resolved.error) return resolved.error
  const { tenantId, moduleId, principalId } = resolved.scope!
  if (!ID.test(registerId)) return json({ code: 'INVALID_REGISTER_ID' }, 400)

  let body: Record<string, unknown>
  try {
    body = await request.json<Record<string, unknown>>()
  } catch {
    return json({ code: 'INVALID_JSON' }, 400)
  }

  const closingBalanceCents = currencyToCents(body.closing_balance)
  if (closingBalanceCents == null) return json({ code: 'INVALID_CLOSING_BALANCE' }, 400)
  const parsed = parseWindowValues(body.start, body.end)
  if (parsed.error) return parsed.error
  const window = parsed.window!

  const current = await bindings.DB!.prepare(`
    SELECT id,opening_balance_cents,opened_at_ms,notes
    FROM cash_register
    WHERE tenant_id=?1 AND module_id=?2 AND id=?3 AND closed_at_ms IS NULL
    LIMIT 1
  `).bind(tenantId, moduleId, registerId).first<{
    id: string
    opening_balance_cents: number
    opened_at_ms: number
    notes: string | null
  }>()
  if (!current?.id) return json({ code: 'CASH_REGISTER_NOT_OPEN' }, 409)

  const cash = await aggregateCash(bindings.DB!, tenantId, moduleId, window)
  const expectedBalanceCents = Number(current.opening_balance_cents || 0) + Math.round(cash.expectedCash * 100)
  const differenceCents = closingBalanceCents - expectedBalanceCents
  const closedAtMs = Date.now()
  const notes = text(body.notes) || current.notes || null

  const result = await bindings.DB!.prepare(`
    UPDATE cash_register
    SET closed_by=?4,closed_at_ms=?5,closing_balance_cents=?6,
        expected_balance_cents=?7,difference_cents=?8,notes=?9,updated_at_ms=?5
    WHERE tenant_id=?1 AND module_id=?2 AND id=?3 AND closed_at_ms IS NULL
  `).bind(
    tenantId,
    moduleId,
    registerId,
    principalId,
    closedAtMs,
    closingBalanceCents,
    expectedBalanceCents,
    differenceCents,
    notes,
  ).run()

  if (Number(result.meta?.changes || 0) !== 1) {
    return json({ code: 'CASH_REGISTER_CLOSE_CONFLICT' }, 409)
  }

  return json({
    id: registerId,
    opened_at: new Date(Number(current.opened_at_ms)).toISOString(),
    opening_balance: Number(current.opening_balance_cents || 0) / 100,
    closed_by: principalId,
    closed_at: new Date(closedAtMs).toISOString(),
    closing_balance: closingBalanceCents / 100,
    expected_balance: expectedBalanceCents / 100,
    difference: differenceCents / 100,
    notes,
  })
}

export async function handlePetshopCashApiRequest(request: Request, bindings: Bindings): Promise<Response | null> {
  const { pathname } = new URL(request.url)
  if (pathname === '/api/petshop/cash/dashboard') {
    if (request.method !== 'GET') return json({ code: 'METHOD_NOT_ALLOWED' }, 405, { allow: 'GET' })
    return loadCashDashboard(request, bindings)
  }

  const closeMatch = /^\/api\/petshop\/cash\/registers\/([^/]+)\/close$/.exec(pathname)
  if (closeMatch) {
    if (request.method !== 'POST') return json({ code: 'METHOD_NOT_ALLOWED' }, 405, { allow: 'POST' })
    return closeCashRegister(request, bindings, decodeURIComponent(closeMatch[1]))
  }

  return null
}
