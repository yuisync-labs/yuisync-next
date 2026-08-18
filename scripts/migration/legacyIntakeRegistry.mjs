export const LEGACY_INTAKE_REGISTRY_VERSION = 1

export const SECRET_FIELD_NAMES = Object.freeze(new Set([
  'password', 'passwd', 'encrypted_password', 'secret', 'service_role', 'service_role_key',
  'access_token', 'refresh_token', 'authorization', 'api_key', 'apikey', 'private_key',
  'client_secret', 'app_secret', 'verify_token', 'bot_token', 'telegram_bot_token',
  'expo_push_token', 'portal_token', 'session_token', 'invoice_api_key',
  'openai_api_key_override', 'groq_api_key_override', 'whatsapp_access_token',
  'whatsapp_verify_token', 'whatsapp_app_secret',
]))

const tenant = (primaryKey, disposition = 'canonical', dataClass = 'operational', destinationHint = null, options = {}) => ({
  scope: 'tenant', primaryKey, disposition, dataClass, destinationHint, ...options,
})
const relation = (primaryKey, relationName, disposition = 'archive', dataClass = 'technical', destinationHint = null, options = {}) => ({
  scope: 'relation', relationName, primaryKey, disposition, dataClass, destinationHint, ...options,
})
const global = (primaryKey, disposition = 'archive', dataClass = 'configuration', destinationHint = null, options = {}) => ({
  scope: 'global', primaryKey, disposition, dataClass, destinationHint, ...options,
})
const view = (disposition = 'recompute') => ({ scope: 'view', primaryKey: [], disposition, dataClass: 'technical', destinationHint: null })

// Exhaustive for the currently connected legacy YuiSync public schema.
// Unknown non-empty BASE TABLEs must fail instead of being silently skipped.
export const LEGACY_PUBLIC_REGISTRY = Object.freeze({
  accounting_services: tenant(['id'], 'canonical', 'operational', 'accounting_services'),
  ai_playground_runs: tenant(['id'], 'canonical', 'operational', 'ai_playground_runs'),
  ai_training_documents: tenant(['id'], 'canonical', 'operational', 'ai_training_documents'),
  appointments: tenant(['id'], 'canonical', 'operational', 'appointments'),
  audit_log: relation(['id'], 'member_profiles', 'archive', 'technical', 'admin_audit_events'),
  billing_settings: tenant(['tenant_id', 'module_id'], 'canonical', 'configuration', 'billing_settings', { secretFields: ['invoice_api_key'] }),
  bot_conversation_examples: tenant(['id'], 'canonical', 'operational', 'bot_conversation_examples'),
  cash_register: tenant(['id'], 'canonical', 'operational', 'cash_register'),
  chat_messages: tenant(['id'], 'canonical', 'operational', 'chat_messages'),
  chat_sessions: tenant(['id'], 'canonical', 'operational', 'chat_threads'),
  client_loyalty_balance: view(),
  client_subscriptions: tenant(['id'], 'canonical', 'operational', 'client_subscriptions'),
  clients: tenant(['id'], 'canonical', 'pii', 'clients'),
  commission_rules: tenant(['id'], 'canonical', 'configuration', 'commission_rules'),
  companies: tenant(['id'], 'canonical', 'configuration', 'ai_companies'),
  conversations: relation(['id'], 'tenant_companies', 'canonical', 'operational', 'ai_conversations', { secretFields: ['session_token'] }),
  fiscal_audit_logs: tenant(['id'], 'canonical', 'technical', 'fiscal_audit_logs'),
  fiscal_documents: tenant(['id'], 'canonical', 'operational', 'fiscal_documents'),
  fiscal_policy_versions: relation(['id'], 'tenant_fiscal_policy', 'canonical', 'configuration', 'fiscal_policy_versions'),
  fiscal_queue_failures: tenant(['id'], 'archive', 'technical', 'fiscal_outbox'),
  invoices: tenant(['id'], 'canonical', 'operational', 'invoices'),
  loyalty_points: tenant(['id'], 'canonical', 'operational', 'loyalty_points'),
  loyalty_settings: tenant(['tenant_id', 'module_id'], 'canonical', 'configuration', 'loyalty_settings'),
  marmitaria_bot_sessions: tenant(['id'], 'archive', 'technical'),
  marmitaria_cardapio_itens: tenant(['id'], 'archive', 'operational'),
  marmitaria_cardapios_dia: tenant(['id'], 'archive', 'operational'),
  marmitaria_config: tenant(['chave'], 'archive', 'configuration'),
  marmitaria_itens: tenant(['id'], 'archive', 'operational'),
  marmitaria_logs: global(['id'], 'archive', 'technical'),
  marmitaria_notificacoes: global(['id'], 'archive', 'technical'),
  marmitaria_pedidos: tenant(['id'], 'archive', 'operational'),
  mobile_push_tokens: tenant(['id'], 'secret_bridge', 'technical', null, { secretFields: ['expo_push_token'] }),
  niches: relation(['id'], 'tenant_companies', 'canonical', 'configuration', 'ai_niches'),
  petbot_events: tenant(['id'], 'archive', 'technical'),
  petbot_order_commits: tenant(['tenant_id', 'idempotency_key'], 'archive', 'technical'),
  pets: tenant(['id'], 'canonical', 'pii', 'pets'),
  petshop_campaign_logs: tenant(['id'], 'canonical', 'operational', 'petshop_campaign_logs'),
  petshop_growth_booking_requests: tenant(['id'], 'canonical', 'operational', 'petshop_growth_booking_requests'),
  petshop_growth_booking_settings: tenant(['id'], 'canonical', 'configuration', 'petshop_growth_booking_settings'),
  petshop_growth_exec_daily: view(),
  petshop_growth_leads: tenant(['id'], 'canonical', 'operational', 'petshop_growth_leads'),
  petshop_growth_no_show_events: tenant(['id'], 'canonical', 'operational', 'petshop_growth_no_show_events'),
  petshop_growth_no_show_policy: tenant(['id'], 'canonical', 'configuration', 'petshop_growth_no_show_policy'),
  petshop_growth_portal_access: tenant(['id'], 'secret_bridge', 'pii', 'petshop_growth_portal_access', { secretFields: ['portal_token'] }),
  petshop_growth_report_cards: tenant(['id'], 'canonical', 'operational', 'petshop_growth_report_cards'),
  petshop_services: tenant(['id'], 'canonical', 'operational', 'services'),
  platform_plan_catalog: relation(['id'], 'tenant_platform_plan', 'canonical', 'configuration', 'platform_plan_catalog'),
  products: tenant(['id'], 'canonical', 'operational', 'products'),
  profile_tenants: tenant(['profile_id', 'tenant_id'], 'identity', 'identity', 'tenant_memberships'),
  profiles: relation(['id'], 'explicit_memberships', 'identity', 'identity', 'identity_principals'),
  prompt_versions: relation(['id'], 'tenant_companies', 'canonical', 'configuration', 'ai_prompt_versions'),
  quick_replies: global(['id'], 'archive', 'configuration'),
  sale_items: tenant(['id'], 'canonical', 'operational', 'sale_items'),
  sale_payment_splits: tenant(['id'], 'canonical', 'operational', 'sale_payment_splits'),
  sales: tenant(['id'], 'canonical', 'operational', 'sales'),
  service_delivery_orders: tenant(['id'], 'canonical', 'operational', 'delivery_orders'),
  settings: tenant(['tenant_id', 'module_id'], 'canonical', 'configuration', 'tenant_module_settings'),
  stock_movements: tenant(['id'], 'canonical', 'operational', 'stock_movements'),
  subscription_plans: tenant(['id'], 'canonical', 'configuration', 'subscription_plans'),
  support_messages: tenant(['id'], 'canonical', 'operational', 'support_messages'),
  support_threads: tenant(['id'], 'canonical', 'operational', 'support_threads'),
  system_update_logs: tenant(['id'], 'archive', 'technical'),
  tenant_ai_usage_monthly: tenant(['tenant_id', 'module_id', 'period_month'], 'canonical', 'operational', 'tenant_ai_usage_monthly'),
  tenant_bot_channels: tenant(['id'], 'secret_bridge', 'configuration', 'whatsapp_phone_connections', {
    secretFields: ['telegram_bot_token', 'openai_api_key_override', 'groq_api_key_override', 'whatsapp_access_token', 'whatsapp_verify_token', 'whatsapp_app_secret'],
  }),
  tenant_fiscal_profiles: tenant(['tenant_id', 'module_id'], 'canonical', 'configuration', 'tenant_fiscal_profiles'),
  tenant_governance_alerts: tenant(['id'], 'canonical', 'technical', 'tenant_governance_alerts'),
  tenant_onboarding: tenant(['tenant_id', 'module_id'], 'canonical', 'configuration', 'tenant_onboarding'),
  tenant_subscriptions: tenant(['id'], 'canonical', 'configuration', 'tenant_subscriptions'),
  tenants: relation(['id'], 'selected_tenant', 'canonical', 'configuration', 'tenants'),
  vw_agenda_hoje: view(),
  vw_critical_stock: view(),
  vw_dashboard_metrics: view(),
  vw_tenant_profitability_monthly: view(),
})

export const AUTH_REGISTRY = Object.freeze({
  'auth.users': {
    scope: 'explicit_memberships',
    primaryKey: ['id'],
    disposition: 'identity',
    dataClass: 'identity',
    destinationHint: 'AUTH_DB.user+account',
    secretFields: ['encrypted_password'],
  },
})

function normalizeName(value) {
  return String(value || '').trim().toLowerCase()
}

export function registryEntry(tableName) {
  return LEGACY_PUBLIC_REGISTRY[normalizeName(tableName)] || AUTH_REGISTRY[normalizeName(tableName)] || null
}

export function sourceKeyFor(tableName, row) {
  const entry = registryEntry(tableName)
  if (!entry) throw new Error(`MIGRATION_TABLE_NOT_REGISTERED:${tableName}`)
  const parts = entry.primaryKey.map((column) => {
    const value = row?.[column]
    if (value == null || String(value).trim() === '') throw new Error(`MIGRATION_SOURCE_KEY_MISSING:${tableName}:${column}`)
    return `${column}=${String(value)}`
  })
  if (!parts.length) throw new Error(`MIGRATION_SOURCE_KEY_UNDEFINED:${tableName}`)
  return parts.join('|')
}

export function isSensitiveFieldName(name, extra = []) {
  const normalized = normalizeName(name)
  return SECRET_FIELD_NAMES.has(normalized) || extra.map(normalizeName).includes(normalized)
}

export function validateRegistryCoverage(discovered = []) {
  const failures = []
  const warnings = []
  for (const item of discovered) {
    const name = normalizeName(item?.table_name || item?.name)
    const type = String(item?.table_type || item?.type || 'BASE TABLE').toUpperCase()
    const rows = Number(item?.row_count ?? item?.rows ?? 0)
    const entry = registryEntry(name)
    if (!entry) {
      if (type === 'VIEW' || rows === 0) warnings.push({ code: 'UNREGISTERED_EMPTY_OR_VIEW', table: name, rows, type })
      else failures.push({ code: 'UNREGISTERED_NONEMPTY_TABLE', table: name, rows, type })
      continue
    }
    if (type === 'VIEW' && entry.scope !== 'view') failures.push({ code: 'VIEW_REGISTRY_MISMATCH', table: name })
    if (type !== 'VIEW' && entry.scope === 'view') failures.push({ code: 'BASE_TABLE_REGISTRY_MISMATCH', table: name })
  }
  return { ok: failures.length === 0, failures, warnings }
}
