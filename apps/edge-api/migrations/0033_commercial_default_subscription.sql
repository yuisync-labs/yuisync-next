-- New tenants enter the commercial control plane immediately.
-- Existing tenants are intentionally not backfilled here: they remain in
-- compatibility mode until an explicit subscription is assigned during rollout.

CREATE TRIGGER IF NOT EXISTS tenants_default_saas_subscription
AFTER INSERT ON tenants
BEGIN
  INSERT OR IGNORE INTO tenant_subscriptions(
    tenant_id,
    plan_version_id,
    status,
    current_period_start_ms,
    current_period_end_ms,
    cancel_at_period_end,
    auto_charge_enabled,
    created_at_ms,
    updated_at_ms
  ) VALUES(
    NEW.id,
    'essential@2026-09',
    'active',
    CAST(strftime('%s', datetime('now','start of month')) AS INTEGER) * 1000,
    CAST(strftime('%s', datetime('now','start of month','+1 month')) AS INTEGER) * 1000,
    0,
    0,
    CAST(strftime('%s','now') AS INTEGER) * 1000,
    CAST(strftime('%s','now') AS INTEGER) * 1000
  );
END;

UPDATE _yuisync_system_metadata
SET value = '33', updated_at = CURRENT_TIMESTAMP
WHERE key = 'schema_version';
