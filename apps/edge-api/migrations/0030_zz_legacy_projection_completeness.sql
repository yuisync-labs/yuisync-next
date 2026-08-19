-- Legacy -> D1 migration completeness addendum.
--
-- This migration stays on schema version 30 intentionally. It is additive and
-- closes data-shape gaps found while comparing the live Supabase migration
-- history with the canonical D1 model.

ALTER TABLE appointments ADD COLUMN grooming_machine_no INTEGER
  CHECK (grooming_machine_no IS NULL OR grooming_machine_no IN (4,7,10));

-- The legacy loyalty ledger keeps expiry per movement. Preserve it explicitly
-- instead of flattening it into the running balance during intake.
ALTER TABLE loyalty_points ADD COLUMN expires_at_ms INTEGER;

-- Keep source-only package metadata for audit/reconciliation. Runtime package
-- capacity continues to come exclusively from benefit_ledger_base_used_json +
-- subscription_benefit_allocations.
ALTER TABLE client_subscriptions ADD COLUMN legacy_metadata_json TEXT NOT NULL DEFAULT '{}'
  CHECK (json_valid(legacy_metadata_json));

-- Support has two operator-facing fields that existed in Supabase but were not
-- represented by the reduced D1 compatibility surface.
ALTER TABLE support_threads ADD COLUMN assigned_to TEXT;
ALTER TABLE support_threads ADD COLUMN last_message_preview TEXT;

DROP VIEW IF EXISTS compat_appointments;
CREATE VIEW compat_appointments AS
SELECT
  a.tenant_id,a.module_id,a.id,a.client_id,a.pet_id,
  (SELECT s.service_code FROM appointment_services s
    WHERE s.tenant_id=a.tenant_id AND s.module_id=a.module_id AND s.appointment_id=a.id
    ORDER BY s.position LIMIT 1) AS service_type,
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
    'min_weight_grams',s.min_weight_grams,
    'max_weight_grams',s.max_weight_grams,
    'species_target',s.species_target,
    'benefit_used',s.benefit_used
  )) FROM appointment_services s
    WHERE s.tenant_id=a.tenant_id AND s.module_id=a.module_id AND s.appointment_id=a.id),'[]') AS service_items,
  datetime(a.scheduled_at_ms/1000,'unixepoch') AS scheduled_at,
  a.duration_min,a.subtotal_cents/100.0 AS price,
  CASE a.status
    WHEN 'scheduled' THEN 'agendado'
    WHEN 'confirmed' THEN 'confirmado'
    WHEN 'in_progress' THEN 'em_andamento'
    WHEN 'completed' THEN 'concluido'
    WHEN 'cancelled' THEN 'cancelado'
    WHEN 'blocked' THEN 'bloqueado'
    WHEN 'available' THEN 'disponivel'
    ELSE a.status
  END AS status,
  a.notes,a.source,a.operation_key,a.operation_fingerprint,
  a.employee_id,a.groomer_id,a.grooming_machine_no,
  a.responsible_staff_key,a.responsible_staff_name,
  a.delivery_staff_key,a.delivery_staff_name,
  t.option_id AS transport_mode,o.label AS transport_label,
  t.pickup_address AS transport_address,
  NULL AS transport_neighborhood,NULL AS transport_city,
  t.pickup_reference AS transport_reference,
  a.live_status,
  CASE WHEN a.checkin_at_ms IS NULL THEN NULL ELSE datetime(a.checkin_at_ms/1000,'unixepoch') END AS checkin_at,
  CASE WHEN a.ready_at_ms IS NULL THEN NULL ELSE datetime(a.ready_at_ms/1000,'unixepoch') END AS ready_at,
  a.subscription_id,a.subscription_benefit_used,a.subscription_benefit_status,
  json(a.subscription_benefits_json) AS subscription_benefits,
  a.subscription_label,a.subscription_discount_cents/100.0 AS subscription_discount,
  a.billing_intent_type,a.billing_intent_subscription_id,
  datetime(a.created_at_ms/1000,'unixepoch') AS created_at,
  datetime(a.updated_at_ms/1000,'unixepoch') AS updated_at
FROM appointments a
LEFT JOIN appointment_transport t
  ON t.tenant_id=a.tenant_id AND t.module_id=a.module_id AND t.appointment_id=a.id
LEFT JOIN transport_options o
  ON o.tenant_id=t.tenant_id AND o.module_id=t.module_id AND o.id=t.option_id;

UPDATE _yuisync_system_metadata
SET value='30',updated_at=CURRENT_TIMESTAMP
WHERE key='schema_version';
