-- YuiSync SaaS commercial control plane.
-- Separates the YuiSync subscription from operational plans sold by each tenant.

CREATE TABLE IF NOT EXISTS saas_plans (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active','retired')),
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  CHECK (length(trim(id)) BETWEEN 1 AND 64),
  CHECK (id = lower(id)),
  CHECK (length(trim(name)) BETWEEN 1 AND 120)
) STRICT;

CREATE TABLE IF NOT EXISTS saas_plan_versions (
  id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version > 0),
  currency TEXT NOT NULL DEFAULT 'BRL' CHECK (currency = 'BRL'),
  monthly_price_cents INTEGER NOT NULL CHECK (monthly_price_cents >= 0),
  status TEXT NOT NULL CHECK (status IN ('active','retired')),
  effective_from_ms INTEGER NOT NULL,
  effective_until_ms INTEGER,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  UNIQUE(plan_id, version),
  FOREIGN KEY (plan_id) REFERENCES saas_plans(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CHECK (effective_until_ms IS NULL OR effective_until_ms > effective_from_ms)
) STRICT;

CREATE TABLE IF NOT EXISTS saas_plan_entitlements (
  plan_version_id TEXT NOT NULL,
  entitlement_key TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0,1)),
  quota_value INTEGER CHECK (quota_value IS NULL OR quota_value >= 0),
  config_json TEXT NOT NULL DEFAULT '{}',
  PRIMARY KEY (plan_version_id, entitlement_key),
  FOREIGN KEY (plan_version_id) REFERENCES saas_plan_versions(id) ON UPDATE RESTRICT ON DELETE CASCADE,
  CHECK (length(trim(entitlement_key)) BETWEEN 1 AND 120),
  CHECK (json_valid(config_json))
) STRICT;

CREATE TABLE IF NOT EXISTS tenant_subscriptions (
  tenant_id TEXT PRIMARY KEY,
  plan_version_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('trialing','active','past_due','canceled','suspended')),
  current_period_start_ms INTEGER NOT NULL,
  current_period_end_ms INTEGER NOT NULL,
  cancel_at_period_end INTEGER NOT NULL DEFAULT 0 CHECK (cancel_at_period_end IN (0,1)),
  payment_provider TEXT,
  provider_customer_id TEXT,
  provider_subscription_id TEXT,
  auto_charge_enabled INTEGER NOT NULL DEFAULT 0 CHECK (auto_charge_enabled IN (0,1)),
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON UPDATE RESTRICT ON DELETE CASCADE,
  FOREIGN KEY (plan_version_id) REFERENCES saas_plan_versions(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CHECK (current_period_end_ms > current_period_start_ms),
  CHECK (payment_provider IS NULL OR length(trim(payment_provider)) BETWEEN 1 AND 64),
  CHECK (provider_customer_id IS NULL OR length(trim(provider_customer_id)) BETWEEN 1 AND 160),
  CHECK (provider_subscription_id IS NULL OR length(trim(provider_subscription_id)) BETWEEN 1 AND 160)
) STRICT;

CREATE UNIQUE INDEX IF NOT EXISTS tenant_subscriptions_provider_unique
  ON tenant_subscriptions(payment_provider, provider_subscription_id)
  WHERE payment_provider IS NOT NULL AND provider_subscription_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS tenant_entitlement_overrides (
  tenant_id TEXT NOT NULL,
  entitlement_key TEXT NOT NULL,
  enabled INTEGER CHECK (enabled IS NULL OR enabled IN (0,1)),
  quota_value INTEGER CHECK (quota_value IS NULL OR quota_value >= 0),
  config_json TEXT,
  reason TEXT NOT NULL,
  effective_until_ms INTEGER,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  PRIMARY KEY (tenant_id, entitlement_key),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON UPDATE RESTRICT ON DELETE CASCADE,
  CHECK (config_json IS NULL OR json_valid(config_json)),
  CHECK (length(trim(reason)) BETWEEN 1 AND 240)
) STRICT;

CREATE TABLE IF NOT EXISTS usage_periods (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  period_start_ms INTEGER NOT NULL,
  period_end_ms INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('open','closed')),
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  UNIQUE(tenant_id, period_start_ms, period_end_ms),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON UPDATE RESTRICT ON DELETE CASCADE,
  CHECK (period_end_ms > period_start_ms)
) STRICT;

CREATE TABLE IF NOT EXISTS usage_events (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  usage_key TEXT NOT NULL,
  event_key TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  source TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  occurred_at_ms INTEGER NOT NULL,
  created_at_ms INTEGER NOT NULL,
  UNIQUE(tenant_id, usage_key, event_key),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON UPDATE RESTRICT ON DELETE CASCADE,
  CHECK (length(trim(usage_key)) BETWEEN 1 AND 120),
  CHECK (length(trim(event_key)) BETWEEN 1 AND 160),
  CHECK (length(trim(source)) BETWEEN 1 AND 80),
  CHECK (json_valid(metadata_json))
) STRICT;

CREATE INDEX IF NOT EXISTS usage_events_tenant_period_idx
  ON usage_events(tenant_id, usage_key, occurred_at_ms);

CREATE TABLE IF NOT EXISTS usage_counters (
  tenant_id TEXT NOT NULL,
  usage_key TEXT NOT NULL,
  period_start_ms INTEGER NOT NULL,
  period_end_ms INTEGER NOT NULL,
  included_quantity INTEGER,
  consumed_quantity INTEGER NOT NULL DEFAULT 0 CHECK (consumed_quantity >= 0),
  updated_at_ms INTEGER NOT NULL,
  PRIMARY KEY (tenant_id, usage_key, period_start_ms),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON UPDATE RESTRICT ON DELETE CASCADE,
  CHECK (included_quantity IS NULL OR included_quantity >= 0),
  CHECK (period_end_ms > period_start_ms)
) STRICT;

CREATE TABLE IF NOT EXISTS billing_accounts (
  tenant_id TEXT PRIMARY KEY,
  legal_name TEXT,
  tax_id TEXT,
  billing_email TEXT,
  provider TEXT,
  provider_customer_id TEXT,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON UPDATE RESTRICT ON DELETE CASCADE
) STRICT;

CREATE TABLE IF NOT EXISTS provider_webhook_events (
  provider TEXT NOT NULL,
  provider_event_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload_sha256 TEXT,
  processing_status TEXT NOT NULL CHECK (processing_status IN ('received','processed','ignored','failed')),
  error_code TEXT,
  received_at_ms INTEGER NOT NULL,
  processed_at_ms INTEGER,
  PRIMARY KEY (provider, provider_event_id),
  CHECK (length(trim(provider)) BETWEEN 1 AND 64),
  CHECK (length(trim(provider_event_id)) BETWEEN 1 AND 180),
  CHECK (length(trim(event_type)) BETWEEN 1 AND 120)
) STRICT;

CREATE TABLE IF NOT EXISTS billing_events (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  provider TEXT,
  provider_event_id TEXT,
  event_type TEXT NOT NULL,
  amount_cents INTEGER,
  currency TEXT NOT NULL DEFAULT 'BRL' CHECK (currency = 'BRL'),
  metadata_json TEXT NOT NULL DEFAULT '{}',
  occurred_at_ms INTEGER NOT NULL,
  created_at_ms INTEGER NOT NULL,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON UPDATE RESTRICT ON DELETE CASCADE,
  CHECK (amount_cents IS NULL OR amount_cents >= 0),
  CHECK (json_valid(metadata_json))
) STRICT;

CREATE INDEX IF NOT EXISTS billing_events_tenant_time_idx
  ON billing_events(tenant_id, occurred_at_ms);

CREATE TABLE IF NOT EXISTS tenant_cost_snapshots (
  tenant_id TEXT NOT NULL,
  period_start_ms INTEGER NOT NULL,
  period_end_ms INTEGER NOT NULL,
  openai_cost_micros_brl INTEGER NOT NULL DEFAULT 0 CHECK (openai_cost_micros_brl >= 0),
  meta_cost_micros_brl INTEGER NOT NULL DEFAULT 0 CHECK (meta_cost_micros_brl >= 0),
  cloudflare_cost_micros_brl INTEGER NOT NULL DEFAULT 0 CHECK (cloudflare_cost_micros_brl >= 0),
  database_cost_micros_brl INTEGER NOT NULL DEFAULT 0 CHECK (database_cost_micros_brl >= 0),
  gateway_cost_micros_brl INTEGER NOT NULL DEFAULT 0 CHECK (gateway_cost_micros_brl >= 0),
  other_cost_micros_brl INTEGER NOT NULL DEFAULT 0 CHECK (other_cost_micros_brl >= 0),
  revenue_cents INTEGER NOT NULL DEFAULT 0 CHECK (revenue_cents >= 0),
  metadata_json TEXT NOT NULL DEFAULT '{}',
  updated_at_ms INTEGER NOT NULL,
  PRIMARY KEY (tenant_id, period_start_ms),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON UPDATE RESTRICT ON DELETE CASCADE,
  CHECK (period_end_ms > period_start_ms),
  CHECK (json_valid(metadata_json))
) STRICT;

-- Commercial catalog v1 (September 2026). Prices are immutable per plan version.
INSERT OR IGNORE INTO saas_plans(id,name,status,created_at_ms,updated_at_ms) VALUES
  ('essential','YuiSync Essencial','active',0,0),
  ('pro','YuiSync Pro','active',0,0),
  ('business','YuiSync Business','active',0,0);

INSERT OR IGNORE INTO saas_plan_versions(
  id,plan_id,version,currency,monthly_price_cents,status,effective_from_ms,created_at_ms,updated_at_ms
) VALUES
  ('essential@2026-09','essential',1,'BRL',14900,'active',1788220800000,0,0),
  ('pro@2026-09','pro',1,'BRL',27900,'active',1788220800000,0,0),
  ('business@2026-09','business',1,'BRL',44900,'active',1788220800000,0,0);

-- Essential: operate the business.
INSERT OR IGNORE INTO saas_plan_entitlements(plan_version_id,entitlement_key,enabled,quota_value) VALUES
  ('essential@2026-09','units.max',1,1),
  ('essential@2026-09','users.max',1,3),
  ('essential@2026-09','core.agenda',1,NULL),
  ('essential@2026-09','core.clients',1,NULL),
  ('essential@2026-09','core.pdv',1,NULL),
  ('essential@2026-09','core.finance',1,NULL),
  ('essential@2026-09','core.inventory',1,NULL),
  ('essential@2026-09','crm.full',0,NULL),
  ('essential@2026-09','automation.advanced',0,NULL),
  ('essential@2026-09','whatsapp.official',0,NULL),
  ('essential@2026-09','yui.internal_copilot',0,NULL),
  ('essential@2026-09','yui.autonomous_whatsapp',0,NULL),
  ('essential@2026-09','campaigns.manual',0,NULL),
  ('essential@2026-09','campaigns.automatic',0,NULL),
  ('essential@2026-09','fiscal.enabled',0,NULL),
  ('essential@2026-09','api.webhooks',0,NULL),
  ('essential@2026-09','audit.advanced',0,NULL);

-- Pro: sell and organize customer relationships; AI is copilot-only.
INSERT OR IGNORE INTO saas_plan_entitlements(plan_version_id,entitlement_key,enabled,quota_value) VALUES
  ('pro@2026-09','units.max',1,1),
  ('pro@2026-09','users.max',1,10),
  ('pro@2026-09','core.agenda',1,NULL),
  ('pro@2026-09','core.clients',1,NULL),
  ('pro@2026-09','core.pdv',1,NULL),
  ('pro@2026-09','core.finance',1,NULL),
  ('pro@2026-09','core.inventory',1,NULL),
  ('pro@2026-09','crm.full',1,NULL),
  ('pro@2026-09','automation.advanced',1,NULL),
  ('pro@2026-09','whatsapp.official',1,NULL),
  ('pro@2026-09','whatsapp.multiagent',1,NULL),
  ('pro@2026-09','yui.internal_copilot',1,NULL),
  ('pro@2026-09','yui.autonomous_whatsapp',0,NULL),
  ('pro@2026-09','campaigns.manual',1,NULL),
  ('pro@2026-09','campaigns.automatic',0,NULL),
  ('pro@2026-09','fiscal.enabled',0,NULL),
  ('pro@2026-09','api.webhooks',0,NULL),
  ('pro@2026-09','audit.advanced',0,NULL);

-- Business: automate. The commercial allowance is intentionally message-based,
-- not conversation/session based. One unique Yui outbound message consumes one unit.
INSERT OR IGNORE INTO saas_plan_entitlements(plan_version_id,entitlement_key,enabled,quota_value) VALUES
  ('business@2026-09','units.max',1,1),
  ('business@2026-09','users.max',1,20),
  ('business@2026-09','core.agenda',1,NULL),
  ('business@2026-09','core.clients',1,NULL),
  ('business@2026-09','core.pdv',1,NULL),
  ('business@2026-09','core.finance',1,NULL),
  ('business@2026-09','core.inventory',1,NULL),
  ('business@2026-09','crm.full',1,NULL),
  ('business@2026-09','automation.advanced',1,NULL),
  ('business@2026-09','whatsapp.official',1,NULL),
  ('business@2026-09','whatsapp.multiagent',1,NULL),
  ('business@2026-09','yui.internal_copilot',1,NULL),
  ('business@2026-09','yui.autonomous_whatsapp',1,NULL),
  ('business@2026-09','yui.ai_outbound_messages',1,1000),
  ('business@2026-09','campaigns.manual',1,NULL),
  ('business@2026-09','campaigns.automatic',1,NULL),
  ('business@2026-09','fiscal.enabled',1,NULL),
  ('business@2026-09','api.webhooks',1,NULL),
  ('business@2026-09','audit.advanced',1,NULL);

UPDATE _yuisync_system_metadata
SET value = '32', updated_at = CURRENT_TIMESTAMP
WHERE key = 'schema_version';
