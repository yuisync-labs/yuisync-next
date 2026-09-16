CREATE TABLE IF NOT EXISTS platform_onboarding_invitations (
  id TEXT PRIMARY KEY NOT NULL,
  checkout_order_id TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','revoked')),
  send_count INTEGER NOT NULL DEFAULT 0 CHECK (send_count >= 0),
  sent_at_ms INTEGER,
  expires_at_ms INTEGER NOT NULL,
  accepted_at_ms INTEGER,
  last_error_code TEXT,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  FOREIGN KEY (checkout_order_id) REFERENCES platform_checkout_orders(id) ON UPDATE RESTRICT ON DELETE RESTRICT
) STRICT;

CREATE INDEX IF NOT EXISTS platform_onboarding_invitations_email_status_idx
  ON platform_onboarding_invitations(email,status,updated_at_ms DESC);

CREATE TABLE IF NOT EXISTS tenant_first_run (
  tenant_id TEXT PRIMARY KEY NOT NULL,
  checkout_order_id TEXT UNIQUE,
  status TEXT NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress','completed')),
  current_step TEXT NOT NULL DEFAULT 'empresa',
  completed_steps_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(completed_steps_json)),
  support_status TEXT NOT NULL DEFAULT 'not_requested' CHECK (support_status IN ('not_requested','requested','scheduled','completed')),
  support_availability TEXT,
  completed_at_ms INTEGER,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY (checkout_order_id) REFERENCES platform_checkout_orders(id) ON UPDATE RESTRICT ON DELETE SET NULL
) STRICT;

CREATE INDEX IF NOT EXISTS tenant_first_run_status_updated_idx
  ON tenant_first_run(status,updated_at_ms DESC,tenant_id);
