export const PLAN_MODULES = Object.freeze({
  'yui-start': Object.freeze([
    'agenda',
    'clients_pets',
    'sales_pos',
    'cash_control',
    'inventory',
  ]),
  'yui-pro': Object.freeze([
    'agenda',
    'clients_pets',
    'sales_pos',
    'cash_control',
    'inventory',
    'service_orders_delivery',
    'whatsapp_basic',
    'team_commissions',
  ]),
  'yui-prime-ia': Object.freeze([
    'agenda',
    'clients_pets',
    'sales_pos',
    'cash_control',
    'inventory',
    'service_orders_delivery',
    'whatsapp_basic',
    'team_commissions',
    'petbot_ai',
    'campaigns_reengagement',
    'ai_satisfaction',
  ]),
  'yui-elite': Object.freeze([
    'agenda',
    'clients_pets',
    'sales_pos',
    'cash_control',
    'inventory',
    'service_orders_delivery',
    'whatsapp_basic',
    'team_commissions',
    'petbot_ai',
    'campaigns_reengagement',
    'ai_satisfaction',
    'multi_instance',
    'custom_configuration',
  ]),
} as const)

export type PlanSlug = keyof typeof PLAN_MODULES
export type PlanModule = (typeof PLAN_MODULES)[PlanSlug][number]
export type PlanAccessSource = 'stripe' | 'legacy' | 'manual'
export type PlanAccessStatus =
  | 'active'
  | 'trialing'
  | 'past_due'
  | 'incomplete'
  | 'incomplete_expired'
  | 'paused'
  | 'canceled'
  | 'unpaid'
  | 'inactive'

export type TenantPlanAccessRow = {
  tenant_id: string
  plan_slug: PlanSlug
  allowed_modules_json: string
  onboarding_completed: number
  status: PlanAccessStatus
  source: PlanAccessSource
  created_at_ms: number
  updated_at_ms: number
}

const PLAN_ALIASES: Readonly<Record<string, PlanSlug>> = Object.freeze({
  start: 'yui-start',
  yui_start: 'yui-start',
  'yui-start': 'yui-start',
  pro: 'yui-pro',
  yui_pro: 'yui-pro',
  'yui-pro': 'yui-pro',
  prime: 'yui-prime-ia',
  prime_ia: 'yui-prime-ia',
  'prime-ia': 'yui-prime-ia',
  yui_prime_ia: 'yui-prime-ia',
  'yui-prime-ia': 'yui-prime-ia',
  elite: 'yui-elite',
  yui_elite: 'yui-elite',
  'yui-elite': 'yui-elite',
})

const STATUSES = new Set<PlanAccessStatus>([
  'active',
  'trialing',
  'past_due',
  'incomplete',
  'incomplete_expired',
  'paused',
  'canceled',
  'unpaid',
  'inactive',
])

export function normalizePlanSlug(value: unknown): PlanSlug | null {
  const normalized = String(value ?? '').trim().toLowerCase().replace(/\s+/g, '-')
  return PLAN_ALIASES[normalized] || null
}

export function allowedModulesForPlan(value: unknown): PlanModule[] {
  const slug = normalizePlanSlug(value)
  return slug ? [...PLAN_MODULES[slug]] : []
}

export function parseAllowedModules(value: unknown): PlanModule[] {
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value
    if (!Array.isArray(parsed)) return []
    const known = new Set<PlanModule>(Object.values(PLAN_MODULES).flat() as PlanModule[])
    return [...new Set(parsed.filter((module): module is PlanModule => typeof module === 'string' && known.has(module as PlanModule)))]
  } catch {
    return []
  }
}

export function normalizePlanAccessStatus(value: unknown): PlanAccessStatus {
  const normalized = String(value ?? '').trim().toLowerCase()
  if (normalized === 'trial') return 'trialing'
  if (normalized === 'cancelled') return 'canceled'
  return STATUSES.has(normalized as PlanAccessStatus) ? normalized as PlanAccessStatus : 'inactive'
}

async function defaultOnboardingCompleted(database: D1Database, tenantId: string): Promise<boolean> {
  const firstRun = await database.prepare('SELECT status FROM tenant_first_run WHERE tenant_id=?1 LIMIT 1')
    .bind(tenantId).first<{ status: string }>()
  // A missing first-run row identifies a legacy tenant. Never block it.
  return !firstRun || firstRun.status === 'completed'
}

export async function syncTenantPlanAccess(
  database: D1Database,
  input: {
    tenantId: string
    plan: unknown
    status?: unknown
    source: PlanAccessSource
    onboardingCompleted?: boolean
    now?: number
  },
): Promise<{ planSlug: PlanSlug; allowedModules: PlanModule[]; onboardingCompleted: boolean; status: PlanAccessStatus }> {
  const tenantId = String(input.tenantId || '').trim()
  const planSlug = normalizePlanSlug(input.plan)
  if (!tenantId) throw new Error('INVALID_TENANT_ID')
  if (!planSlug) throw new Error('INVALID_PLAN_SLUG')

  const allowedModules = allowedModulesForPlan(planSlug)
  const status = normalizePlanAccessStatus(input.status || 'active')
  const hasExplicitOnboarding = typeof input.onboardingCompleted === 'boolean'
  const onboardingCompleted = hasExplicitOnboarding
    ? Boolean(input.onboardingCompleted)
    : await defaultOnboardingCompleted(database, tenantId)
  const now = Number.isFinite(input.now) ? Number(input.now) : Date.now()

  await database.prepare(`
    INSERT INTO tenant_plan_access(
      tenant_id,plan_slug,allowed_modules_json,onboarding_completed,status,source,created_at_ms,updated_at_ms
    ) VALUES(?1,?2,?3,?4,?5,?6,?7,?7)
    ON CONFLICT(tenant_id) DO UPDATE SET
      plan_slug=excluded.plan_slug,
      allowed_modules_json=excluded.allowed_modules_json,
      onboarding_completed=CASE WHEN ?8=1 THEN excluded.onboarding_completed ELSE tenant_plan_access.onboarding_completed END,
      status=excluded.status,
      source=excluded.source,
      updated_at_ms=excluded.updated_at_ms
  `).bind(
    tenantId,
    planSlug,
    JSON.stringify(allowedModules),
    onboardingCompleted ? 1 : 0,
    status,
    input.source,
    now,
    hasExplicitOnboarding ? 1 : 0,
  ).run()

  return { planSlug, allowedModules, onboardingCompleted, status }
}

export async function setTenantOnboardingCompleted(
  database: D1Database,
  tenantId: string,
  completed: boolean,
  now = Date.now(),
): Promise<void> {
  const result = await database.prepare(`
    UPDATE tenant_plan_access
    SET onboarding_completed=?1,updated_at_ms=?2
    WHERE tenant_id=?3
  `).bind(completed ? 1 : 0, now, tenantId).run()
  if (Number(result.meta.changes || 0) > 0) return

  const subscription = await database.prepare(`
    SELECT plan_code,status FROM platform_billing_subscriptions
    WHERE tenant_id=?1
    ORDER BY updated_at_ms DESC,id DESC LIMIT 1
  `).bind(tenantId).first<{ plan_code: string; status: string }>()
  await syncTenantPlanAccess(database, {
    tenantId,
    plan: subscription?.plan_code || 'yui-elite',
    status: subscription?.status || 'active',
    source: subscription ? 'stripe' : 'legacy',
    onboardingCompleted: completed,
    now,
  })
}
