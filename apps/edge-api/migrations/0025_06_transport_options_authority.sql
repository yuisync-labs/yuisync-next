-- YuiSync operational integrity v25: transport option identifiers are data, not a duplicated schema enum.
-- appointment_transport already references transport_options by FK, so the option row is the authority.
--
-- compat_appointments depends on appointment_transport/transport_options. SQLite validates dependent
-- views while tables are rebuilt, so drop the compatibility view before the swap and recreate it
-- immediately afterwards.

DROP VIEW IF EXISTS compat_appointments;

CREATE TABLE transport_options_v25 (
  tenant_id TEXT NOT NULL, module_id TEXT NOT NULL, id TEXT NOT NULL, label TEXT NOT NULL,
  fee_cents INTEGER NOT NULL DEFAULT 0, max_weight_grams INTEGER,
  pickup_required INTEGER NOT NULL, dropoff_required INTEGER NOT NULL, outside_city INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active', sort_order INTEGER NOT NULL DEFAULT 999,
  PRIMARY KEY (tenant_id,module_id,id),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CHECK (length(trim(id)) BETWEEN 1 AND 80),
  CHECK (id GLOB '[a-z0-9_]*'),
  CHECK (fee_cents >= 0), CHECK (max_weight_grams IS NULL OR max_weight_grams > 0),
  CHECK (pickup_required IN (0,1) AND dropoff_required IN (0,1) AND outside_city IN (0,1)),
  CHECK (status IN ('active','inactive'))
) STRICT;

INSERT INTO transport_options_v25(
  tenant_id,module_id,id,label,fee_cents,max_weight_grams,pickup_required,dropoff_required,outside_city,status,sort_order
)
SELECT tenant_id,module_id,id,label,fee_cents,max_weight_grams,pickup_required,dropoff_required,outside_city,status,sort_order
FROM transport_options;

CREATE TABLE appointment_transport_v25 (
  tenant_id TEXT NOT NULL, module_id TEXT NOT NULL, appointment_id TEXT NOT NULL, option_id TEXT NOT NULL,
  fee_cents INTEGER NOT NULL DEFAULT 0, pickup_address TEXT, dropoff_address TEXT,
  pickup_reference TEXT, dropoff_reference TEXT, contact_phone TEXT,
  status TEXT NOT NULL DEFAULT 'pending', notes TEXT, updated_at_ms INTEGER NOT NULL,
  PRIMARY KEY (tenant_id,module_id,appointment_id),
  FOREIGN KEY (tenant_id,module_id,appointment_id) REFERENCES appointments(tenant_id,module_id,id) ON UPDATE RESTRICT ON DELETE CASCADE,
  FOREIGN KEY (tenant_id,module_id,option_id) REFERENCES transport_options_v25(tenant_id,module_id,id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CHECK (fee_cents >= 0), CHECK (status IN ('pending','scheduled','picked_up','delivered','cancelled'))
) STRICT;

INSERT INTO appointment_transport_v25(
  tenant_id,module_id,appointment_id,option_id,fee_cents,pickup_address,dropoff_address,
  pickup_reference,dropoff_reference,contact_phone,status,notes,updated_at_ms
)
SELECT tenant_id,module_id,appointment_id,option_id,fee_cents,pickup_address,dropoff_address,
  pickup_reference,dropoff_reference,contact_phone,status,notes,updated_at_ms
FROM appointment_transport;

DROP TABLE appointment_transport;
DROP TABLE transport_options;
ALTER TABLE transport_options_v25 RENAME TO transport_options;
ALTER TABLE appointment_transport_v25 RENAME TO appointment_transport;

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
