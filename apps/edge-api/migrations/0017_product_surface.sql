CREATE TABLE IF NOT EXISTS module_settings_extensions (
  tenant_id TEXT NOT NULL,
  module_id TEXT NOT NULL,
  data_json TEXT NOT NULL DEFAULT '{}',
  version INTEGER NOT NULL DEFAULT 1,
  updated_at_ms INTEGER NOT NULL,
  PRIMARY KEY (tenant_id,module_id),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CHECK (json_valid(data_json)), CHECK (version >= 1)
) STRICT;

CREATE TABLE IF NOT EXISTS subscription_plans (
  tenant_id TEXT NOT NULL, module_id TEXT NOT NULL, id TEXT NOT NULL,
  name TEXT NOT NULL, price_cents INTEGER NOT NULL DEFAULT 0,
  billing_cycle TEXT NOT NULL DEFAULT 'monthly', services_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'active', created_at_ms INTEGER NOT NULL, updated_at_ms INTEGER NOT NULL,
  PRIMARY KEY (tenant_id,module_id,id), FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT,
  CHECK (price_cents >= 0), CHECK (billing_cycle IN ('monthly','quarterly','annual','custom')),
  CHECK (json_valid(services_json)), CHECK (status IN ('active','inactive'))
) STRICT;
CREATE INDEX IF NOT EXISTS subscription_plans_scope_status_idx ON subscription_plans(tenant_id,module_id,status,name,id);

CREATE TABLE IF NOT EXISTS client_subscriptions (
  tenant_id TEXT NOT NULL, module_id TEXT NOT NULL, id TEXT NOT NULL,
  plan_id TEXT NOT NULL, client_id TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending_payment',
  started_at_ms INTEGER NOT NULL, next_billing_date TEXT, services_used_json TEXT NOT NULL DEFAULT '{}',
  cancelled_at_ms INTEGER, created_at_ms INTEGER NOT NULL, updated_at_ms INTEGER NOT NULL,
  PRIMARY KEY (tenant_id,module_id,id),
  FOREIGN KEY (tenant_id,module_id,plan_id) REFERENCES subscription_plans(tenant_id,module_id,id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id,module_id,client_id) REFERENCES clients(tenant_id,module_id,id) ON DELETE RESTRICT,
  CHECK (status IN ('pending_payment','active','paused','cancelled','expired')),
  CHECK (json_valid(services_used_json))
) STRICT;
CREATE INDEX IF NOT EXISTS client_subscriptions_scope_client_idx ON client_subscriptions(tenant_id,module_id,client_id,status,started_at_ms DESC);

CREATE TABLE IF NOT EXISTS loyalty_settings (
  tenant_id TEXT NOT NULL, module_id TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 0,
  points_per_currency INTEGER NOT NULL DEFAULT 0, redemption_rate_cents INTEGER NOT NULL DEFAULT 0,
  data_json TEXT NOT NULL DEFAULT '{}', updated_at_ms INTEGER NOT NULL,
  PRIMARY KEY (tenant_id,module_id), FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT,
  CHECK (enabled IN (0,1)), CHECK (points_per_currency >= 0), CHECK (redemption_rate_cents >= 0), CHECK (json_valid(data_json))
) STRICT;

CREATE TABLE IF NOT EXISTS loyalty_points (
  tenant_id TEXT NOT NULL, module_id TEXT NOT NULL, id TEXT NOT NULL, client_id TEXT NOT NULL,
  points_delta INTEGER NOT NULL, balance_after INTEGER NOT NULL, reason TEXT, reference_type TEXT, reference_id TEXT,
  created_at_ms INTEGER NOT NULL,
  PRIMARY KEY (tenant_id,module_id,id),
  FOREIGN KEY (tenant_id,module_id,client_id) REFERENCES clients(tenant_id,module_id,id) ON DELETE RESTRICT,
  CHECK (balance_after >= 0)
) STRICT;
CREATE INDEX IF NOT EXISTS loyalty_points_scope_client_idx ON loyalty_points(tenant_id,module_id,client_id,created_at_ms DESC,id);

CREATE TABLE IF NOT EXISTS commission_rules (
  tenant_id TEXT NOT NULL, module_id TEXT NOT NULL, id TEXT NOT NULL,
  staff_key TEXT, service_code TEXT, rule_type TEXT NOT NULL DEFAULT 'percentage',
  rate_basis_points INTEGER NOT NULL DEFAULT 0, fixed_cents INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active', data_json TEXT NOT NULL DEFAULT '{}', updated_at_ms INTEGER NOT NULL,
  PRIMARY KEY (tenant_id,module_id,id), FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT,
  CHECK (rule_type IN ('percentage','fixed')), CHECK (rate_basis_points BETWEEN 0 AND 10000), CHECK (fixed_cents >= 0),
  CHECK (status IN ('active','inactive')), CHECK (json_valid(data_json))
) STRICT;

CREATE TABLE IF NOT EXISTS cash_register (
  tenant_id TEXT NOT NULL, module_id TEXT NOT NULL, id TEXT NOT NULL,
  opened_by TEXT, closed_by TEXT, opening_balance_cents INTEGER NOT NULL DEFAULT 0,
  closing_balance_cents INTEGER, expected_balance_cents INTEGER, difference_cents INTEGER,
  opened_at_ms INTEGER NOT NULL, closed_at_ms INTEGER, notes TEXT,
  PRIMARY KEY (tenant_id,module_id,id), FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT,
  CHECK (opening_balance_cents >= 0)
) STRICT;
CREATE INDEX IF NOT EXISTS cash_register_scope_open_idx ON cash_register(tenant_id,module_id,closed_at_ms,opened_at_ms DESC);

CREATE TABLE IF NOT EXISTS invoices (
  tenant_id TEXT NOT NULL, module_id TEXT NOT NULL, id TEXT NOT NULL,
  sale_id TEXT, client_id TEXT, amount_cents INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'pending',
  due_date TEXT, paid_at_ms INTEGER, customer_phone TEXT, notes TEXT, invoice_nfe_url TEXT,
  created_at_ms INTEGER NOT NULL, updated_at_ms INTEGER NOT NULL,
  PRIMARY KEY (tenant_id,module_id,id), FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT,
  CHECK (amount_cents >= 0), CHECK (status IN ('pending','paid','cancelled','overdue','refunded'))
) STRICT;
CREATE INDEX IF NOT EXISTS invoices_scope_status_due_idx ON invoices(tenant_id,module_id,status,due_date,created_at_ms DESC);

CREATE TABLE IF NOT EXISTS billing_settings (
  tenant_id TEXT NOT NULL, module_id TEXT NOT NULL, data_json TEXT NOT NULL DEFAULT '{}', updated_at_ms INTEGER NOT NULL,
  PRIMARY KEY (tenant_id,module_id), FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT, CHECK (json_valid(data_json))
) STRICT;

CREATE TABLE IF NOT EXISTS accounting_services (
  tenant_id TEXT NOT NULL, module_id TEXT NOT NULL, id TEXT NOT NULL, name TEXT NOT NULL,
  amount_cents INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'active', data_json TEXT NOT NULL DEFAULT '{}',
  created_at_ms INTEGER NOT NULL, updated_at_ms INTEGER NOT NULL,
  PRIMARY KEY (tenant_id,module_id,id), FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT,
  CHECK (amount_cents >= 0), CHECK (status IN ('active','inactive')), CHECK (json_valid(data_json))
) STRICT;

CREATE TABLE IF NOT EXISTS tenant_fiscal_profiles (
  tenant_id TEXT NOT NULL, module_id TEXT NOT NULL, policy_version_id TEXT,
  mode TEXT NOT NULL DEFAULT 'manual', auto_update INTEGER NOT NULL DEFAULT 0,
  nfe_environment TEXT NOT NULL DEFAULT 'homologacao', fiscal_regime TEXT,
  issue_series INTEGER NOT NULL DEFAULT 1, next_invoice_number INTEGER NOT NULL DEFAULT 1,
  emit_nfce INTEGER NOT NULL DEFAULT 0, emit_nfe INTEGER NOT NULL DEFAULT 0, emit_nfse INTEGER NOT NULL DEFAULT 0,
  settings_json TEXT NOT NULL DEFAULT '{}', updated_at_ms INTEGER NOT NULL,
  PRIMARY KEY (tenant_id,module_id), FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT,
  CHECK (mode IN ('manual','assisted','automatic')), CHECK (auto_update IN (0,1)),
  CHECK (nfe_environment IN ('homologacao','producao')), CHECK (issue_series >= 1), CHECK (next_invoice_number >= 1),
  CHECK (emit_nfce IN (0,1)), CHECK (emit_nfe IN (0,1)), CHECK (emit_nfse IN (0,1)), CHECK (json_valid(settings_json))
) STRICT;

CREATE TABLE IF NOT EXISTS fiscal_policy_versions (
  id TEXT PRIMARY KEY, module_id TEXT NOT NULL, version_label TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'draft',
  effective_from_ms INTEGER NOT NULL, notes TEXT, rules_json TEXT NOT NULL DEFAULT '{}', created_by TEXT,
  created_at_ms INTEGER NOT NULL, updated_at_ms INTEGER NOT NULL,
  UNIQUE(module_id,version_label), CHECK (status IN ('draft','active','retired')), CHECK (json_valid(rules_json))
) STRICT;

CREATE TABLE IF NOT EXISTS fiscal_audit_logs (
  tenant_id TEXT NOT NULL, module_id TEXT NOT NULL, id TEXT NOT NULL, invoice_id TEXT,
  severity TEXT NOT NULL DEFAULT 'info', code TEXT NOT NULL, message TEXT NOT NULL, metadata_json TEXT NOT NULL DEFAULT '{}', created_at_ms INTEGER NOT NULL,
  PRIMARY KEY (tenant_id,module_id,id), FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT,
  CHECK (severity IN ('info','warning','error')), CHECK (json_valid(metadata_json))
) STRICT;

CREATE TABLE IF NOT EXISTS petshop_growth_booking_settings (
  tenant_id TEXT NOT NULL, module_id TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, public_slug TEXT NOT NULL,
  allow_whatsapp_fallback INTEGER NOT NULL DEFAULT 1, lead_expiration_hours INTEGER NOT NULL DEFAULT 6,
  intake_message TEXT, updated_at_ms INTEGER NOT NULL,
  PRIMARY KEY (tenant_id,module_id), UNIQUE(public_slug), FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT,
  CHECK (enabled IN (0,1)), CHECK (allow_whatsapp_fallback IN (0,1)), CHECK (lead_expiration_hours BETWEEN 1 AND 720)
) STRICT;

CREATE TABLE IF NOT EXISTS petshop_growth_leads (
  tenant_id TEXT NOT NULL, module_id TEXT NOT NULL, id TEXT NOT NULL, client_id TEXT,
  source TEXT NOT NULL DEFAULT 'manual', stage TEXT NOT NULL DEFAULT 'new', priority TEXT NOT NULL DEFAULT 'normal',
  owner_name TEXT NOT NULL, pet_name TEXT, phone TEXT, interest TEXT, notes TEXT,
  next_followup_at_ms INTEGER, last_contact_at_ms INTEGER, converted_sale_id TEXT, created_at_ms INTEGER NOT NULL, updated_at_ms INTEGER NOT NULL,
  PRIMARY KEY (tenant_id,module_id,id), FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT,
  CHECK (priority IN ('low','normal','high','urgent'))
) STRICT;
CREATE INDEX IF NOT EXISTS petshop_growth_leads_scope_stage_idx ON petshop_growth_leads(tenant_id,module_id,stage,created_at_ms DESC);

CREATE TABLE IF NOT EXISTS petshop_growth_booking_requests (
  tenant_id TEXT NOT NULL, module_id TEXT NOT NULL, id TEXT NOT NULL, client_id TEXT, lead_id TEXT,
  channel TEXT NOT NULL DEFAULT 'manual', customer_name TEXT NOT NULL, pet_name TEXT, phone TEXT, service_interest TEXT,
  preferred_date TEXT, preferred_period TEXT, transport_mode TEXT NOT NULL DEFAULT 'dropoff', need_motodog INTEGER NOT NULL DEFAULT 0,
  motodog_fee_cents INTEGER NOT NULL DEFAULT 0, pickup_address TEXT, pickup_neighborhood TEXT, pickup_city TEXT,
  status TEXT NOT NULL DEFAULT 'pending', notes TEXT, created_at_ms INTEGER NOT NULL, updated_at_ms INTEGER NOT NULL,
  PRIMARY KEY (tenant_id,module_id,id), FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT,
  CHECK (need_motodog IN (0,1)), CHECK (motodog_fee_cents >= 0)
) STRICT;

CREATE TABLE IF NOT EXISTS petshop_growth_no_show_policy (
  tenant_id TEXT NOT NULL, module_id TEXT NOT NULL, require_prepayment INTEGER NOT NULL DEFAULT 0,
  prepayment_cents INTEGER NOT NULL DEFAULT 0, grace_minutes INTEGER NOT NULL DEFAULT 15, max_strikes INTEGER NOT NULL DEFAULT 2,
  auto_block_days INTEGER NOT NULL DEFAULT 30, reminder_minutes_before INTEGER NOT NULL DEFAULT 90, updated_at_ms INTEGER NOT NULL,
  PRIMARY KEY (tenant_id,module_id), FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT,
  CHECK (require_prepayment IN (0,1)), CHECK (prepayment_cents >= 0), CHECK (grace_minutes >= 0), CHECK (max_strikes >= 1), CHECK (auto_block_days >= 0)
) STRICT;

CREATE TABLE IF NOT EXISTS petshop_growth_no_show_events (
  tenant_id TEXT NOT NULL, module_id TEXT NOT NULL, id TEXT NOT NULL, appointment_id TEXT, client_id TEXT,
  event_type TEXT NOT NULL DEFAULT 'no_show', fee_cents INTEGER NOT NULL DEFAULT 0, notes TEXT, created_at_ms INTEGER NOT NULL,
  PRIMARY KEY (tenant_id,module_id,id), FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT, CHECK (fee_cents >= 0)
) STRICT;

CREATE TABLE IF NOT EXISTS petshop_campaign_logs (
  tenant_id TEXT NOT NULL, module_id TEXT NOT NULL, id TEXT NOT NULL, campaign_type TEXT, client_id TEXT,
  channel TEXT, status TEXT, payload_json TEXT NOT NULL DEFAULT '{}', created_at_ms INTEGER NOT NULL,
  PRIMARY KEY (tenant_id,module_id,id), FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT, CHECK (json_valid(payload_json))
) STRICT;

CREATE TABLE IF NOT EXISTS petshop_growth_report_cards (
  tenant_id TEXT NOT NULL, module_id TEXT NOT NULL, id TEXT NOT NULL, period_key TEXT NOT NULL,
  metrics_json TEXT NOT NULL DEFAULT '{}', created_at_ms INTEGER NOT NULL, updated_at_ms INTEGER NOT NULL,
  PRIMARY KEY (tenant_id,module_id,id), FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT, CHECK (json_valid(metrics_json))
) STRICT;

CREATE TABLE IF NOT EXISTS support_threads (
  tenant_id TEXT NOT NULL, module_id TEXT NOT NULL, id TEXT NOT NULL, requester_profile_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', priority TEXT NOT NULL DEFAULT 'normal', source TEXT NOT NULL DEFAULT 'widget',
  subject TEXT, last_message_at_ms INTEGER, created_at_ms INTEGER NOT NULL, updated_at_ms INTEGER NOT NULL,
  PRIMARY KEY (tenant_id,module_id,id), FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT,
  CHECK (status IN ('open','pending','closed')), CHECK (priority IN ('low','normal','high','urgent'))
) STRICT;

CREATE TABLE IF NOT EXISTS support_messages (
  tenant_id TEXT NOT NULL, module_id TEXT NOT NULL, id TEXT NOT NULL, thread_id TEXT NOT NULL,
  sender_profile_id TEXT, sender_type TEXT NOT NULL, body TEXT NOT NULL, created_at_ms INTEGER NOT NULL,
  PRIMARY KEY (tenant_id,module_id,id), FOREIGN KEY (tenant_id,module_id,thread_id) REFERENCES support_threads(tenant_id,module_id,id) ON DELETE CASCADE
) STRICT;
CREATE INDEX IF NOT EXISTS support_messages_scope_thread_idx ON support_messages(tenant_id,module_id,thread_id,created_at_ms,id);

CREATE TABLE IF NOT EXISTS platform_plan_catalog (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active', entitlements_json TEXT NOT NULL DEFAULT '{}',
  price_cents INTEGER NOT NULL DEFAULT 0, created_at_ms INTEGER NOT NULL, updated_at_ms INTEGER NOT NULL,
  CHECK (status IN ('active','inactive')), CHECK (entitlements_json), CHECK (price_cents >= 0)
) STRICT;

CREATE TABLE IF NOT EXISTS tenant_subscriptions (
  tenant_id TEXT NOT NULL, module_id TEXT NOT NULL, id TEXT NOT NULL, plan_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active', started_at_ms INTEGER NOT NULL, expires_at_ms INTEGER, data_json TEXT NOT NULL DEFAULT '{}', updated_at_ms INTEGER NOT NULL,
  PRIMARY KEY (tenant_id,module_id,id), FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT,
  FOREIGN KEY (plan_id) REFERENCES platform_plan_catalog(id) ON DELETE RESTRICT,
  CHECK (status IN ('active','trial','past_due','cancelled','expired')), CHECK (json_valid(data_json))
) STRICT;

CREATE TABLE IF NOT EXISTS tenant_ai_usage_monthly (
  tenant_id TEXT NOT NULL, module_id TEXT NOT NULL, month_key TEXT NOT NULL, request_count INTEGER NOT NULL DEFAULT 0,
  token_count INTEGER NOT NULL DEFAULT 0, updated_at_ms INTEGER NOT NULL,
  PRIMARY KEY (tenant_id,module_id,month_key), FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT,
  CHECK (request_count >= 0), CHECK (token_count >= 0)
) STRICT;

ALTER TABLE appointments ADD COLUMN subscription_id TEXT;
ALTER TABLE appointments ADD COLUMN subscription_benefit_used INTEGER NOT NULL DEFAULT 0 CHECK (subscription_benefit_used IN (0,1));
ALTER TABLE appointments ADD COLUMN subscription_benefit_status TEXT;
ALTER TABLE appointments ADD COLUMN subscription_benefits_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(subscription_benefits_json));
ALTER TABLE appointments ADD COLUMN subscription_label TEXT;
ALTER TABLE appointments ADD COLUMN subscription_discount_cents INTEGER NOT NULL DEFAULT 0 CHECK (subscription_discount_cents >= 0);
ALTER TABLE appointments ADD COLUMN employee_id TEXT;
ALTER TABLE appointments ADD COLUMN groomer_id TEXT;
ALTER TABLE appointments ADD COLUMN responsible_staff_key TEXT;
ALTER TABLE appointments ADD COLUMN responsible_staff_name TEXT;
ALTER TABLE appointments ADD COLUMN delivery_staff_key TEXT;
ALTER TABLE appointments ADD COLUMN delivery_staff_name TEXT;
ALTER TABLE appointments ADD COLUMN live_status TEXT;
ALTER TABLE appointments ADD COLUMN checkin_at_ms INTEGER;
ALTER TABLE appointments ADD COLUMN ready_at_ms INTEGER;
ALTER TABLE sales ADD COLUMN subscription_id TEXT;

UPDATE _yuisync_system_metadata SET value='17',updated_at=CURRENT_TIMESTAMP WHERE key='schema_version';
