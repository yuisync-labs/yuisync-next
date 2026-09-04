CREATE INDEX IF NOT EXISTS appointments_scope_subscription_schedule_idx
  ON appointments(tenant_id,module_id,subscription_id,scheduled_at_ms,id)
  WHERE subscription_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS sales_scope_subscription_idx
  ON sales(tenant_id,module_id,subscription_id,id)
  WHERE subscription_id IS NOT NULL;

