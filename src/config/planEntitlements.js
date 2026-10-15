export const PLAN_MODULE_LABELS = Object.freeze({
  agenda: 'Agenda',
  clients_pets: 'Clientes & Pets',
  sales_pos: 'Vendas / PDV',
  cash_control: 'Controle de Caixa',
  inventory: 'Estoque',
  service_orders_delivery: 'Ordens de Serviço & Entrega',
  whatsapp_basic: 'Atendimento WhatsApp',
  team_commissions: 'Equipe & Comissões',
  petbot_ai: 'PetBot com IA',
  campaigns_reengagement: 'Campanhas & Reengajamento',
  ai_satisfaction: 'Métricas de Satisfação IA',
  multi_instance: 'Multi-instâncias',
  custom_configuration: 'Configurações personalizadas',
})

const START_MODULES = Object.freeze([
  'agenda',
  'clients_pets',
  'sales_pos',
  'cash_control',
  'inventory',
])

const PRO_MODULES = Object.freeze([
  ...START_MODULES,
  'service_orders_delivery',
  'whatsapp_basic',
  'team_commissions',
])

const PRIME_MODULES = Object.freeze([
  ...PRO_MODULES,
  'petbot_ai',
  'campaigns_reengagement',
  'ai_satisfaction',
])

const ELITE_MODULES = Object.freeze([
  ...PRIME_MODULES,
  'multi_instance',
  'custom_configuration',
])

export const PLAN_ENTITLEMENTS = Object.freeze({
  'yui-start': Object.freeze({
    slug: 'yui-start',
    name: 'Yui Start',
    modules: START_MODULES,
  }),
  'yui-pro': Object.freeze({
    slug: 'yui-pro',
    name: 'Yui Pro',
    modules: PRO_MODULES,
  }),
  'yui-prime-ia': Object.freeze({
    slug: 'yui-prime-ia',
    name: 'Yui Prime IA',
    modules: PRIME_MODULES,
  }),
  'yui-elite': Object.freeze({
    slug: 'yui-elite',
    name: 'Yui Elite',
    modules: ELITE_MODULES,
  }),
})

const PLAN_ALIASES = Object.freeze({
  start: 'yui-start',
  yui_start: 'yui-start',
  'yui-start': 'yui-start',
  pro: 'yui-pro',
  yui_pro: 'yui-pro',
  'yui-pro': 'yui-pro',
  prime: 'yui-prime-ia',
  prime_ia: 'yui-prime-ia',
  'prime-ia': 'yui-prime-ia',
  yui_prime: 'yui-prime-ia',
  'yui-prime': 'yui-prime-ia',
  yui_prime_ia: 'yui-prime-ia',
  'yui-prime-ia': 'yui-prime-ia',
  elite: 'yui-elite',
  yui_elite: 'yui-elite',
  'yui-elite': 'yui-elite',
})

export function normalizePlanSlug(value) {
  const normalized = String(value || '').trim().toLowerCase()
  return PLAN_ALIASES[normalized] || null
}

export function planDefinition(planSlug) {
  const normalized = normalizePlanSlug(planSlug)
  return normalized ? PLAN_ENTITLEMENTS[normalized] : null
}

export function hasPlanModule(allowedModules, moduleId) {
  const normalizedModule = String(moduleId || '').trim()
  if (!normalizedModule) return false
  if (allowedModules instanceof Set) return allowedModules.has(normalizedModule)
  return Array.isArray(allowedModules) && allowedModules.includes(normalizedModule)
}

function requiredModulesForItem(item) {
  if (!item || typeof item !== 'object') return []
  const requirement = item.planModules
    ?? item.requiredModules
    ?? item.planModule
    ?? item.requiredModule
    ?? item.entitlement
  if (Array.isArray(requirement)) return requirement.filter(Boolean)
  return requirement ? [requirement] : []
}

function explicitModulesForTenant(activeTenant) {
  const candidates = [
    activeTenant?.allowed_modules,
    activeTenant?.plan_modules,
    activeTenant?.entitlements?.modules,
  ]
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate
  }
  return null
}

export function canAccessPlanItem(item, activeTenant) {
  const requiredModules = requiredModulesForItem(item)
  if (requiredModules.length === 0) return true

  const explicitModules = explicitModulesForTenant(activeTenant)
  const plan = planDefinition(
    activeTenant?.plan_slug
      ?? activeTenant?.planSlug
      ?? activeTenant?.plan_code
      ?? activeTenant?.planCode,
  )

  // Existing tenants without commercial metadata keep their legacy access.
  // Once a plan or an explicit entitlement list exists, access is fail-closed.
  if (!plan && explicitModules === null) return true
  const allowedModules = explicitModules ?? plan?.modules ?? []
  return requiredModules.every((moduleId) => hasPlanModule(allowedModules, moduleId))
}
