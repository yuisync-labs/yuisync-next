-- Complete the remaining browser compatibility surface on D1.

CREATE TABLE IF NOT EXISTS profiles (
  id TEXT PRIMARY KEY NOT NULL,
  full_name TEXT,
  email TEXT,
  role TEXT NOT NULL DEFAULT 'employee',
  active INTEGER NOT NULL DEFAULT 1,
  allowed_modules TEXT NOT NULL DEFAULT '[]',
  module_permissions TEXT NOT NULL DEFAULT '{}',
  avatar_url TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (active IN (0,1)),
  CHECK (json_valid(allowed_modules)),
  CHECK (json_valid(module_permissions))
) STRICT;
CREATE INDEX IF NOT EXISTS profiles_email_idx ON profiles(email);

CREATE TABLE IF NOT EXISTS quick_replies (
  id TEXT PRIMARY KEY NOT NULL,
  category TEXT,
  title TEXT,
  text TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (active IN (0,1))
) STRICT;
CREATE INDEX IF NOT EXISTS quick_replies_active_category_idx ON quick_replies(active,category,id);

CREATE TABLE IF NOT EXISTS petshop_growth_portal_access (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL,
  module_id TEXT NOT NULL DEFAULT 'petshop',
  client_id TEXT NOT NULL,
  portal_token TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  invited_at TEXT,
  last_access_at TEXT,
  expires_at TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id,module_id,client_id) REFERENCES clients(tenant_id,module_id,id) ON DELETE RESTRICT,
  UNIQUE (portal_token),
  UNIQUE (tenant_id,module_id,client_id),
  CHECK (status IN ('active','paused','revoked'))
) STRICT;
CREATE INDEX IF NOT EXISTS petshop_growth_portal_access_scope_idx
  ON petshop_growth_portal_access(tenant_id,module_id,status,updated_at DESC);

CREATE TABLE IF NOT EXISTS tenant_onboarding (
  tenant_id TEXT NOT NULL,
  module_id TEXT NOT NULL DEFAULT 'petshop',
  status TEXT NOT NULL DEFAULT 'in_progress',
  stage TEXT NOT NULL DEFAULT 'empresa',
  progress INTEGER NOT NULL DEFAULT 0,
  checklist TEXT NOT NULL DEFAULT '{}',
  owner_profile_id TEXT,
  updated_by TEXT,
  started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (tenant_id,module_id),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT,
  CHECK (status IN ('pending','in_progress','blocked','completed')),
  CHECK (progress BETWEEN 0 AND 100),
  CHECK (json_valid(checklist))
) STRICT;
CREATE INDEX IF NOT EXISTS tenant_onboarding_status_idx ON tenant_onboarding(module_id,status,progress);

CREATE TABLE IF NOT EXISTS tenant_governance_alerts (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL,
  module_id TEXT NOT NULL,
  alert_type TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'warning',
  status TEXT NOT NULL DEFAULT 'open',
  title TEXT NOT NULL,
  description TEXT,
  payload TEXT NOT NULL DEFAULT '{}',
  fingerprint TEXT NOT NULL,
  acknowledged_by TEXT,
  acknowledged_at TEXT,
  resolved_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT,
  UNIQUE (fingerprint),
  CHECK (severity IN ('info','warning','high','critical')),
  CHECK (status IN ('open','acknowledged','resolved')),
  CHECK (json_valid(payload))
) STRICT;
CREATE INDEX IF NOT EXISTS tenant_governance_alerts_scope_idx
  ON tenant_governance_alerts(tenant_id,module_id,status,severity,updated_at DESC);

CREATE TABLE IF NOT EXISTS system_update_logs (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT,
  module_id TEXT NOT NULL DEFAULT 'system',
  category TEXT NOT NULL DEFAULT 'operacao',
  status TEXT NOT NULL DEFAULT 'info',
  source TEXT NOT NULL DEFAULT 'system',
  title TEXT NOT NULL,
  description TEXT,
  metadata TEXT NOT NULL DEFAULT '{}',
  fingerprint TEXT UNIQUE,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE SET NULL,
  CHECK (json_valid(metadata))
) STRICT;
CREATE INDEX IF NOT EXISTS system_update_logs_scope_idx ON system_update_logs(tenant_id,module_id,created_at DESC);

-- The old product-surface foundation created a deliberately reduced platform plan schema.
-- Extend it in-place so legacy UI filters/order clauses remain valid while preserving the
-- canonical columns already referenced by migration tooling.
ALTER TABLE platform_plan_catalog ADD COLUMN subtitle TEXT;
ALTER TABLE platform_plan_catalog ADD COLUMN monthly_price REAL NOT NULL DEFAULT 0;
ALTER TABLE platform_plan_catalog ADD COLUMN yearly_price REAL;
ALTER TABLE platform_plan_catalog ADD COLUMN currency TEXT NOT NULL DEFAULT 'BRL';
ALTER TABLE platform_plan_catalog ADD COLUMN features TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(features));
ALTER TABLE platform_plan_catalog ADD COLUMN limits TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(limits));
ALTER TABLE platform_plan_catalog ADD COLUMN badge TEXT;
ALTER TABLE platform_plan_catalog ADD COLUMN highlighted INTEGER NOT NULL DEFAULT 0 CHECK (highlighted IN (0,1));
ALTER TABLE platform_plan_catalog ADD COLUMN active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1));
ALTER TABLE platform_plan_catalog ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;
ALTER TABLE platform_plan_catalog ADD COLUMN metadata TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(metadata));
ALTER TABLE platform_plan_catalog ADD COLUMN created_by TEXT;
UPDATE platform_plan_catalog
SET monthly_price = CASE WHEN monthly_price=0 THEN price_cents / 100.0 ELSE monthly_price END,
    features = CASE WHEN features='[]' THEN entitlements_json ELSE features END;

INSERT INTO platform_plan_catalog(
  id,name,status,entitlements_json,price_cents,created_at_ms,updated_at_ms,
  subtitle,monthly_price,yearly_price,currency,features,limits,badge,highlighted,active,sort_order,metadata
) VALUES
('yui_start','Yui Start','active','[]',19700,CAST(strftime('%s','now') AS INTEGER)*1000,CAST(strftime('%s','now') AS INTEGER)*1000,'Operacao essencial para petshops em crescimento',197,1970,'BRL','["Agenda e clientes/pets","PDV e estoque","Caixa e relatorios base","Suporte padrao"]','{"users":1,"bots":1,"ai_enabled":false,"ai_messages":0,"support_cost_brl":39,"infra_cost_brl":24,"ai_unit_cost_brl":0}',NULL,0,1,10,'{"target":"small"}'),
('yui_pro','Yui Pro','active','[]',34700,CAST(strftime('%s','now') AS INTEGER)*1000,CAST(strftime('%s','now') AS INTEGER)*1000,'Fiscal + atendimento integrado para operacao profissional',347,3470,'BRL','["Tudo do Start","Chat integrado e ordens/entrega","Configuracao fiscal por empresa","Automacoes operacionais"]','{"users":3,"bots":1,"ai_enabled":false,"ai_messages":0,"support_cost_brl":69,"infra_cost_brl":31,"ai_unit_cost_brl":0}','Mais vendido',1,1,20,'{"target":"growth"}'),
('yui_prime_ia','Yui Prime IA','active','[]',59700,CAST(strftime('%s','now') AS INTEGER)*1000,CAST(strftime('%s','now') AS INTEGER)*1000,'Escala com IA, automacoes e inteligencia operacional',597,5970,'BRL','["Tudo do Pro","IA para atendimento e sugestoes","Campanhas de reengajamento","Suporte prioritario"]','{"users":5,"bots":2,"ai_enabled":true,"ai_messages":12000,"support_cost_brl":119,"infra_cost_brl":41,"ai_unit_cost_brl":0.02}','Premium IA',0,1,30,'{"target":"scale"}'),
('yui_elite','Yui Elite','active','[]',0,CAST(strftime('%s','now') AS INTEGER)*1000,CAST(strftime('%s','now') AS INTEGER)*1000,'Atendimento personalizado com automacoes sob medida',0,0,'BRL','["Tudo do Prime IA","Especialista dedicado","SLA prioritario","Canal direto com a central"]','{"users":10,"bots":4,"ai_enabled":true,"ai_messages":25000,"support_cost_brl":260,"infra_cost_brl":90,"ai_unit_cost_brl":0.018}','Concierge',0,1,40,'{"target":"enterprise","contract":"sob_consulta"}')
ON CONFLICT(id) DO UPDATE SET
  subtitle=excluded.subtitle,monthly_price=excluded.monthly_price,yearly_price=excluded.yearly_price,
  currency=excluded.currency,features=excluded.features,limits=excluded.limits,badge=excluded.badge,
  highlighted=excluded.highlighted,active=excluded.active,sort_order=excluded.sort_order,metadata=excluded.metadata;

ALTER TABLE tenant_subscriptions ADD COLUMN billing_cycle TEXT NOT NULL DEFAULT 'monthly';
ALTER TABLE tenant_subscriptions ADD COLUMN contracted_price REAL;
ALTER TABLE tenant_subscriptions ADD COLUMN currency TEXT NOT NULL DEFAULT 'BRL';
ALTER TABLE tenant_subscriptions ADD COLUMN trial_ends_at TEXT;
ALTER TABLE tenant_subscriptions ADD COLUMN current_period_start TEXT;
ALTER TABLE tenant_subscriptions ADD COLUMN next_billing_at TEXT;
ALTER TABLE tenant_subscriptions ADD COLUMN auto_charge_enabled INTEGER NOT NULL DEFAULT 0 CHECK (auto_charge_enabled IN (0,1));
ALTER TABLE tenant_subscriptions ADD COLUMN payment_provider TEXT;
ALTER TABLE tenant_subscriptions ADD COLUMN provider_customer_id TEXT;
ALTER TABLE tenant_subscriptions ADD COLUMN provider_subscription_id TEXT;
ALTER TABLE tenant_subscriptions ADD COLUMN notes TEXT;
ALTER TABLE tenant_subscriptions ADD COLUMN managed_by TEXT;

CREATE VIEW IF NOT EXISTS petshop_growth_exec_daily AS
WITH dates AS (
  SELECT tenant_id,module_id,date(created_at_ms/1000,'unixepoch','-3 hours') AS ref_date FROM sales
  UNION SELECT tenant_id,module_id,date(created_at_ms/1000,'unixepoch','-3 hours') FROM petshop_growth_leads
  UNION SELECT tenant_id,module_id,date(created_at_ms/1000,'unixepoch','-3 hours') FROM petshop_growth_booking_requests
  UNION SELECT tenant_id,module_id,date(created_at_ms/1000,'unixepoch','-3 hours') FROM petshop_growth_no_show_events
  UNION SELECT tenant_id,module_id,date(created_at_ms/1000,'unixepoch','-3 hours') FROM petshop_growth_report_cards
)
SELECT d.tenant_id,d.module_id,d.ref_date,
  (SELECT count(*) FROM sales s WHERE s.tenant_id=d.tenant_id AND s.module_id=d.module_id AND date(s.created_at_ms/1000,'unixepoch','-3 hours')=d.ref_date AND s.status='completed') AS total_sales,
  COALESCE((SELECT sum(s.total_cents)/100.0 FROM sales s WHERE s.tenant_id=d.tenant_id AND s.module_id=d.module_id AND date(s.created_at_ms/1000,'unixepoch','-3 hours')=d.ref_date AND s.status='completed'),0) AS total_revenue,
  (SELECT count(*) FROM petshop_growth_leads l WHERE l.tenant_id=d.tenant_id AND l.module_id=d.module_id AND date(l.created_at_ms/1000,'unixepoch','-3 hours')=d.ref_date) AS new_leads,
  (SELECT count(*) FROM petshop_growth_leads l WHERE l.tenant_id=d.tenant_id AND l.module_id=d.module_id AND date(l.created_at_ms/1000,'unixepoch','-3 hours')=d.ref_date AND l.stage='won') AS leads_won,
  (SELECT count(*) FROM petshop_growth_booking_requests b WHERE b.tenant_id=d.tenant_id AND b.module_id=d.module_id AND date(b.created_at_ms/1000,'unixepoch','-3 hours')=d.ref_date) AS bookings_created,
  (SELECT count(*) FROM petshop_growth_booking_requests b WHERE b.tenant_id=d.tenant_id AND b.module_id=d.module_id AND date(b.created_at_ms/1000,'unixepoch','-3 hours')=d.ref_date AND b.status='scheduled') AS bookings_scheduled,
  (SELECT count(*) FROM petshop_growth_no_show_events n WHERE n.tenant_id=d.tenant_id AND n.module_id=d.module_id AND date(n.created_at_ms/1000,'unixepoch','-3 hours')=d.ref_date AND n.event_type IN ('no_show','late_cancel')) AS no_show_count,
  (SELECT count(*) FROM petshop_growth_report_cards r WHERE r.tenant_id=d.tenant_id AND r.module_id=d.module_id AND date(r.created_at_ms/1000,'unixepoch','-3 hours')=d.ref_date) AS report_cards_sent
FROM dates d;

UPDATE _yuisync_system_metadata SET value='21', updated_at=CURRENT_TIMESTAMP WHERE key='schema_version';
