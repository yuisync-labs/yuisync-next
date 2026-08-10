DROP VIEW IF EXISTS compat_appointments;

ALTER TABLE appointments RENAME COLUMN duration_minutes TO duration_min;
ALTER TABLE appointment_services RENAME COLUMN duration_minutes TO duration_min;

CREATE VIEW compat_appointments AS
SELECT
  a.tenant_id,a.module_id,a.id,a.client_id,a.pet_id,
  (SELECT s.service_code FROM appointment_services s WHERE s.tenant_id=a.tenant_id AND s.module_id=a.module_id AND s.appointment_id=a.id ORDER BY s.position LIMIT 1) AS service_type,
  a.service_group,
  COALESCE((SELECT json_group_array(json_object(
    'code',s.service_code,'service_id',s.service_id,'name',s.service_name,'group_type',s.service_group,
    'unit_price',s.unit_price_cents/100.0,'duration_min',s.duration_min,'benefit_used',s.benefit_used
  )) FROM appointment_services s WHERE s.tenant_id=a.tenant_id AND s.module_id=a.module_id AND s.appointment_id=a.id),'[]') AS service_items,
  datetime(a.scheduled_at_ms/1000,'unixepoch') AS scheduled_at,a.duration_min,a.subtotal_cents/100.0 AS price,
  CASE a.status WHEN 'scheduled' THEN 'agendado' WHEN 'confirmed' THEN 'confirmado' WHEN 'in_progress' THEN 'em_andamento'
    WHEN 'completed' THEN 'concluido' WHEN 'cancelled' THEN 'cancelado' WHEN 'blocked' THEN 'bloqueado'
    WHEN 'available' THEN 'disponivel' ELSE a.status END AS status,
  a.notes,a.source,
  a.employee_id,a.groomer_id,a.responsible_staff_key,a.responsible_staff_name,a.delivery_staff_key,a.delivery_staff_name,
  t.option_id AS transport_mode,o.label AS transport_label,t.pickup_address AS transport_address,
  NULL AS transport_neighborhood,NULL AS transport_city,t.pickup_reference AS transport_reference,
  a.live_status,CASE WHEN a.checkin_at_ms IS NULL THEN NULL ELSE datetime(a.checkin_at_ms/1000,'unixepoch') END AS checkin_at,
  CASE WHEN a.ready_at_ms IS NULL THEN NULL ELSE datetime(a.ready_at_ms/1000,'unixepoch') END AS ready_at,
  a.subscription_id,a.subscription_benefit_used,a.subscription_benefit_status,json(a.subscription_benefits_json) AS subscription_benefits,
  a.subscription_label,a.subscription_discount_cents/100.0 AS subscription_discount,
  datetime(a.created_at_ms/1000,'unixepoch') AS created_at,datetime(a.updated_at_ms/1000,'unixepoch') AS updated_at
FROM appointments a
LEFT JOIN appointment_transport t ON t.tenant_id=a.tenant_id AND t.module_id=a.module_id AND t.appointment_id=a.id
LEFT JOIN transport_options o ON o.tenant_id=t.tenant_id AND o.module_id=t.module_id AND o.id=t.option_id;

CREATE TABLE IF NOT EXISTS platform_plans (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  entitlements_json TEXT NOT NULL DEFAULT '{}',
  price_cents INTEGER NOT NULL DEFAULT 0,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  CHECK (status IN ('active','inactive')),
  CHECK (json_valid(entitlements_json)),
  CHECK (price_cents >= 0)
) STRICT;

CREATE TABLE IF NOT EXISTS tenant_platform_subscriptions (
  tenant_id TEXT NOT NULL,module_id TEXT NOT NULL,id TEXT NOT NULL,plan_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',started_at_ms INTEGER NOT NULL,expires_at_ms INTEGER,
  data_json TEXT NOT NULL DEFAULT '{}',updated_at_ms INTEGER NOT NULL,
  PRIMARY KEY(tenant_id,module_id,id),
  FOREIGN KEY(tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT,
  FOREIGN KEY(plan_id) REFERENCES platform_plans(id) ON DELETE RESTRICT,
  CHECK(status IN ('active','trial','past_due','cancelled','expired')),
  CHECK(json_valid(data_json))
) STRICT;

UPDATE _yuisync_system_metadata SET value='19',updated_at=CURRENT_TIMESTAMP WHERE key='schema_version';
