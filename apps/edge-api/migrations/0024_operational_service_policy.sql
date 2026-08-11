-- YuiSync operational service policy foundation (v24)
--
-- The service catalog is the source of truth for current operational policy.
-- Appointments keep immutable snapshots so later catalog edits do not rewrite
-- historical eligibility, price or commission semantics.

ALTER TABLE services ADD COLUMN min_weight_kg REAL
  CHECK (min_weight_kg IS NULL OR min_weight_kg >= 0);
ALTER TABLE services ADD COLUMN max_weight_kg REAL
  CHECK (max_weight_kg IS NULL OR max_weight_kg >= 0);
ALTER TABLE services ADD COLUMN species_target TEXT
  CHECK (species_target IS NULL OR species_target IN ('dog','cat'));

-- Bring explicit product species into the operational service link without
-- overwriting a service rule already configured by the tenant.
UPDATE services
SET species_target = (
  SELECT p.species_target
  FROM catalog_products p
  WHERE p.tenant_id = services.tenant_id
    AND p.module_id = services.module_id
    AND p.id = services.source_product_id
  LIMIT 1
)
WHERE species_target IS NULL
  AND source_product_id IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM catalog_products p
    WHERE p.tenant_id = services.tenant_id
      AND p.module_id = services.module_id
      AND p.id = services.source_product_id
      AND p.species_target IN ('dog','cat')
  );

-- Current default policy from the operational YuiSync: every grooming service
-- containing "tosa" defaults to 10%; other bath/grooming services default to 5%.
-- A non-zero configured rate remains untouched.
UPDATE services
SET commission_type = 'percentage',
    commission_basis_points = CASE
      WHEN lower(name) LIKE '%tosa%' OR lower(code) LIKE '%tosa%' THEN 1000
      ELSE 500
    END,
    updated_at_ms = CAST(strftime('%s','now') AS INTEGER) * 1000
WHERE module_id = 'petshop'
  AND group_type = 'banho_tosa'
  AND commission_basis_points = 0;

ALTER TABLE appointments ADD COLUMN operation_key TEXT;
ALTER TABLE appointments ADD COLUMN operation_fingerprint TEXT
  CHECK (operation_fingerprint IS NULL OR length(operation_fingerprint) = 64);
CREATE UNIQUE INDEX IF NOT EXISTS appointments_scope_operation_key_unique
  ON appointments(tenant_id,module_id,operation_key)
  WHERE operation_key IS NOT NULL;

-- Operation identity is independent from appointment content. The caller key is
-- hashed/scoped by the command layer; the fingerprint proves that a retry is the
-- same intent instead of a reused key carrying different data.
CREATE TABLE appointment_command_registry (
  tenant_id TEXT NOT NULL,
  module_id TEXT NOT NULL,
  operation_key TEXT NOT NULL,
  appointment_id TEXT NOT NULL,
  operation_fingerprint TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'reserved',
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  PRIMARY KEY (tenant_id,module_id,operation_key),
  CHECK (length(operation_fingerprint) = 64),
  CHECK (status IN ('reserved','completed'))
) STRICT;
CREATE INDEX appointment_command_registry_appointment_idx
  ON appointment_command_registry(tenant_id,module_id,appointment_id);

-- A completed appointment may only reopen after the linked sale has reached an
-- explicit terminal financial state. This closes the race between checkout and
-- reopen even when both requests pass their application-level preflight.
CREATE TRIGGER appointments_reopen_blocks_active_sale
BEFORE UPDATE OF status ON appointments
FOR EACH ROW
WHEN OLD.status='completed'
  AND NEW.status IN ('scheduled','confirmed','in_progress')
  AND EXISTS (
    SELECT 1
    FROM sales s
    WHERE s.tenant_id=OLD.tenant_id
      AND s.module_id=OLD.module_id
      AND s.appointment_id=OLD.id
      AND s.status NOT IN ('cancelled','refunded')
  )
BEGIN
  SELECT RAISE(ABORT,'APPOINTMENT_REOPEN_SALE_BLOCKED');
END;

ALTER TABLE appointment_services ADD COLUMN catalog_price_cents INTEGER
  CHECK (catalog_price_cents IS NULL OR catalog_price_cents >= 0);
ALTER TABLE appointment_services ADD COLUMN commission_basis_points INTEGER
  CHECK (commission_basis_points IS NULL OR (commission_basis_points >= 0 AND commission_basis_points <= 10000));
ALTER TABLE appointment_services ADD COLUMN min_weight_kg REAL
  CHECK (min_weight_kg IS NULL OR min_weight_kg >= 0);
ALTER TABLE appointment_services ADD COLUMN max_weight_kg REAL
  CHECK (max_weight_kg IS NULL OR max_weight_kg >= 0);
ALTER TABLE appointment_services ADD COLUMN species_target TEXT
  CHECK (species_target IS NULL OR species_target IN ('dog','cat'));

-- Existing D1 rows predate snapshots. Freeze the best available policy at the
-- migration boundary; future writes must snapshot directly from services.
UPDATE appointment_services
SET catalog_price_cents = COALESCE(catalog_price_cents, unit_price_cents),
    commission_basis_points = COALESCE(
      commission_basis_points,
      (
        SELECT s.commission_basis_points
        FROM services s
        WHERE s.tenant_id = appointment_services.tenant_id
          AND s.module_id = appointment_services.module_id
          AND s.id = appointment_services.service_id
        LIMIT 1
      )
    ),
    min_weight_kg = COALESCE(
      min_weight_kg,
      (
        SELECT s.min_weight_kg
        FROM services s
        WHERE s.tenant_id = appointment_services.tenant_id
          AND s.module_id = appointment_services.module_id
          AND s.id = appointment_services.service_id
        LIMIT 1
      )
    ),
    max_weight_kg = COALESCE(
      max_weight_kg,
      (
        SELECT s.max_weight_kg
        FROM services s
        WHERE s.tenant_id = appointment_services.tenant_id
          AND s.module_id = appointment_services.module_id
          AND s.id = appointment_services.service_id
        LIMIT 1
      )
    ),
    species_target = COALESCE(
      species_target,
      (
        SELECT s.species_target
        FROM services s
        WHERE s.tenant_id = appointment_services.tenant_id
          AND s.module_id = appointment_services.module_id
          AND s.id = appointment_services.service_id
        LIMIT 1
      )
    );

DROP VIEW IF EXISTS compat_petshop_services;
CREATE VIEW compat_petshop_services AS
SELECT
  tenant_id,module_id,id,code,name,category,description,group_type,
  default_price_cents/100.0 AS default_price,default_duration_min,
  commission_type,commission_basis_points/100.0 AS commission_rate,
  min_weight_kg,max_weight_kg,species_target,
  CASE WHEN status='active' THEN 1 ELSE 0 END AS active,
  sort_order,icon,source_product_id,
  datetime(created_at_ms/1000,'unixepoch') AS created_at,
  datetime(updated_at_ms/1000,'unixepoch') AS updated_at
FROM services;

DROP VIEW IF EXISTS compat_appointments;
CREATE VIEW compat_appointments AS
SELECT
  a.tenant_id,a.module_id,a.id,a.client_id,a.pet_id,
  (SELECT s.service_code FROM appointment_services s WHERE s.tenant_id=a.tenant_id AND s.module_id=a.module_id AND s.appointment_id=a.id ORDER BY s.position LIMIT 1) AS service_type,
  a.service_group,
  COALESCE((SELECT json_group_array(json_object(
    'code',s.service_code,
    'service_id',s.service_id,
    'name',s.service_name,
    'group_type',s.service_group,
    'unit_price',s.unit_price_cents/100.0,
    'catalog_price',COALESCE(s.catalog_price_cents,s.unit_price_cents)/100.0,
    'duration_min',s.duration_min,
    'commission_type','percentage',
    'commission_rate',CASE WHEN s.commission_basis_points IS NULL THEN NULL ELSE s.commission_basis_points/100.0 END,
    'min_weight_kg',s.min_weight_kg,
    'max_weight_kg',s.max_weight_kg,
    'species_target',s.species_target,
    'benefit_used',s.benefit_used
  )) FROM appointment_services s WHERE s.tenant_id=a.tenant_id AND s.module_id=a.module_id AND s.appointment_id=a.id),'[]') AS service_items,
  datetime(a.scheduled_at_ms/1000,'unixepoch') AS scheduled_at,a.duration_min,a.subtotal_cents/100.0 AS price,
  CASE a.status WHEN 'scheduled' THEN 'agendado' WHEN 'confirmed' THEN 'confirmado' WHEN 'in_progress' THEN 'em_andamento'
    WHEN 'completed' THEN 'concluido' WHEN 'cancelled' THEN 'cancelado' WHEN 'blocked' THEN 'bloqueado'
    WHEN 'available' THEN 'disponivel' ELSE a.status END AS status,
  a.notes,a.source,a.operation_key,a.operation_fingerprint,
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

UPDATE _yuisync_system_metadata SET value='24',updated_at=CURRENT_TIMESTAMP WHERE key='schema_version';
