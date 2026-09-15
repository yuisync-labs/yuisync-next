-- Commercial subscriptions are intentionally separate from petshop package
-- subscriptions. Stripe is the payment provider; D1 remains the YuiSync source
-- of truth for the commercial order and its tenant linkage.
CREATE TABLE IF NOT EXISTS platform_checkout_orders (
  id TEXT PRIMARY KEY NOT NULL,
  request_key TEXT NOT NULL UNIQUE,
  tenant_id TEXT,
  principal_id TEXT,
  plan_code TEXT NOT NULL CHECK (plan_code IN ('start','pro','prime')),
  billing_cycle TEXT NOT NULL CHECK (billing_cycle IN ('monthly','yearly')),
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  currency TEXT NOT NULL DEFAULT 'BRL' CHECK (currency = 'BRL'),
  customer_name TEXT NOT NULL,
  customer_email TEXT NOT NULL,
  customer_phone TEXT,
  business_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'creating' CHECK (status IN ('creating','open','complete','expired','cancelled','failed')),
  stripe_checkout_session_id TEXT UNIQUE,
  stripe_checkout_url TEXT,
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  terms_accepted_at_ms INTEGER NOT NULL,
  expires_at_ms INTEGER,
  completed_at_ms INTEGER,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY (principal_id) REFERENCES identity_principals(id) ON UPDATE RESTRICT ON DELETE SET NULL
) STRICT;

CREATE INDEX IF NOT EXISTS platform_checkout_orders_email_created_idx
  ON platform_checkout_orders(customer_email,created_at_ms DESC);
CREATE INDEX IF NOT EXISTS platform_checkout_orders_tenant_status_idx
  ON platform_checkout_orders(tenant_id,status,created_at_ms DESC);

CREATE TABLE IF NOT EXISTS platform_billing_subscriptions (
  id TEXT PRIMARY KEY NOT NULL,
  checkout_order_id TEXT UNIQUE,
  tenant_id TEXT,
  plan_code TEXT NOT NULL CHECK (plan_code IN ('start','pro','prime')),
  billing_cycle TEXT NOT NULL CHECK (billing_cycle IN ('monthly','yearly')),
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL,
  current_period_start_ms INTEGER,
  current_period_end_ms INTEGER,
  cancel_at_period_end INTEGER NOT NULL DEFAULT 0 CHECK (cancel_at_period_end IN (0,1)),
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  FOREIGN KEY (checkout_order_id) REFERENCES platform_checkout_orders(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON UPDATE RESTRICT ON DELETE RESTRICT
) STRICT;

CREATE INDEX IF NOT EXISTS platform_billing_subscriptions_tenant_status_idx
  ON platform_billing_subscriptions(tenant_id,status,updated_at_ms DESC);

CREATE TABLE IF NOT EXISTS platform_stripe_webhook_events (
  id TEXT PRIMARY KEY NOT NULL,
  event_type TEXT NOT NULL,
  livemode INTEGER NOT NULL DEFAULT 0 CHECK (livemode IN (0,1)),
  status TEXT NOT NULL DEFAULT 'processing' CHECK (status IN ('processing','processed','failed')),
  error_code TEXT,
  received_at_ms INTEGER NOT NULL,
  processed_at_ms INTEGER,
  updated_at_ms INTEGER NOT NULL
) STRICT;

CREATE INDEX IF NOT EXISTS platform_stripe_webhook_events_status_received_idx
  ON platform_stripe_webhook_events(status,received_at_ms DESC);
