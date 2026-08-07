CREATE TABLE IF NOT EXISTS module_operational_settings (
  tenant_id TEXT NOT NULL,
  module_id TEXT NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
  booking_horizon_days INTEGER NOT NULL DEFAULT 90,
  minimum_lead_minutes INTEGER NOT NULL DEFAULT 0,
  default_duration_minutes INTEGER NOT NULL DEFAULT 60,
  max_services_per_appointment INTEGER NOT NULL DEFAULT 10,
  autonomy_mode TEXT NOT NULL DEFAULT 'assisted',
  version INTEGER NOT NULL DEFAULT 1,
  updated_at_ms INTEGER NOT NULL,
  PRIMARY KEY (tenant_id, module_id),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CHECK (booking_horizon_days BETWEEN 1 AND 3650),
  CHECK (minimum_lead_minutes BETWEEN 0 AND 10080),
  CHECK (default_duration_minutes BETWEEN 15 AND 1440),
  CHECK (max_services_per_appointment BETWEEN 1 AND 20),
  CHECK (autonomy_mode IN ('disabled','assisted','autonomous')),
  CHECK (version >= 1)
) STRICT;

CREATE TABLE IF NOT EXISTS booking_hours (
  tenant_id TEXT NOT NULL,
  module_id TEXT NOT NULL,
  weekday INTEGER NOT NULL,
  opens_minute INTEGER NOT NULL,
  closes_minute INTEGER NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id, module_id, weekday, opens_minute),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CHECK (weekday BETWEEN 0 AND 6),
  CHECK (opens_minute BETWEEN 0 AND 1439),
  CHECK (closes_minute BETWEEN 1 AND 1440 AND closes_minute > opens_minute),
  CHECK (active IN (0,1))
) STRICT;

CREATE TABLE IF NOT EXISTS payment_method_settings (
  tenant_id TEXT NOT NULL,
  module_id TEXT NOT NULL,
  method TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 999,
  PRIMARY KEY (tenant_id, module_id, method),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CHECK (method IN ('pix','cash','card')), CHECK (enabled IN (0,1))
) STRICT;

UPDATE _yuisync_system_metadata SET value='8', updated_at=CURRENT_TIMESTAMP WHERE key='schema_version';