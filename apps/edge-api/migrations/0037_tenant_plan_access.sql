-- Canonical commercial access for each tenant. Stripe keeps using the short
-- internal plan_code (start/pro/prime); this table exposes stable product
-- slugs and a snapshot of the modules granted by that plan.
CREATE TABLE IF NOT EXISTS tenant_plan_access (
  tenant_id TEXT PRIMARY KEY NOT NULL,
  plan_slug TEXT NOT NULL CHECK (plan_slug IN ('yui-start','yui-pro','yui-prime-ia','yui-elite')),
  allowed_modules_json TEXT NOT NULL DEFAULT '[]'
    CHECK (json_valid(allowed_modules_json) AND json_type(allowed_modules_json) = 'array'),
  onboarding_completed INTEGER NOT NULL DEFAULT 0 CHECK (onboarding_completed IN (0,1)),
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','trialing','past_due','incomplete','incomplete_expired','paused','canceled','unpaid','inactive')),
  source TEXT NOT NULL DEFAULT 'legacy' CHECK (source IN ('stripe','legacy','manual')),
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON UPDATE RESTRICT ON DELETE CASCADE
) STRICT;

CREATE INDEX IF NOT EXISTS tenant_plan_access_status_updated_idx
  ON tenant_plan_access(status,updated_at_ms DESC,tenant_id);

-- Reconcile tenants that already have a commercial subscription. Tenants that
-- predate billing retain Elite access; tenants with an unfinished first-run
-- keep their onboarding gate instead of being silently marked as complete.
INSERT INTO tenant_plan_access(
  tenant_id,plan_slug,allowed_modules_json,onboarding_completed,status,source,created_at_ms,updated_at_ms
)
WITH latest_subscription AS (
  SELECT
    tenant_id,
    plan_code,
    status,
    ROW_NUMBER() OVER (PARTITION BY tenant_id ORDER BY updated_at_ms DESC,id DESC) AS row_number
  FROM platform_billing_subscriptions
  WHERE tenant_id IS NOT NULL
)
SELECT
  tenant.id,
  CASE subscription.plan_code
    WHEN 'start' THEN 'yui-start'
    WHEN 'pro' THEN 'yui-pro'
    WHEN 'prime' THEN 'yui-prime-ia'
    ELSE 'yui-elite'
  END,
  CASE subscription.plan_code
    WHEN 'start' THEN '["agenda","clients_pets","sales_pos","cash_control","inventory"]'
    WHEN 'pro' THEN '["agenda","clients_pets","sales_pos","cash_control","inventory","service_orders_delivery","whatsapp_basic","team_commissions"]'
    WHEN 'prime' THEN '["agenda","clients_pets","sales_pos","cash_control","inventory","service_orders_delivery","whatsapp_basic","team_commissions","petbot_ai","campaigns_reengagement","ai_satisfaction"]'
    ELSE '["agenda","clients_pets","sales_pos","cash_control","inventory","service_orders_delivery","whatsapp_basic","team_commissions","petbot_ai","campaigns_reengagement","ai_satisfaction","multi_instance","custom_configuration"]'
  END,
  CASE WHEN first_run.status='in_progress' THEN 0 ELSE 1 END,
  CASE
    WHEN subscription.status IN ('active','trialing','past_due','incomplete','incomplete_expired','paused','canceled','unpaid','inactive') THEN subscription.status
    WHEN subscription.tenant_id IS NULL THEN 'active'
    ELSE 'inactive'
  END,
  CASE WHEN subscription.tenant_id IS NULL THEN 'legacy' ELSE 'stripe' END,
  CAST(strftime('%s','now') AS INTEGER) * 1000,
  CAST(strftime('%s','now') AS INTEGER) * 1000
FROM tenants tenant
LEFT JOIN latest_subscription subscription
  ON subscription.tenant_id=tenant.id AND subscription.row_number=1
LEFT JOIN tenant_first_run first_run ON first_run.tenant_id=tenant.id
WHERE NOT EXISTS (
  SELECT 1 FROM tenant_plan_access access WHERE access.tenant_id=tenant.id
);
