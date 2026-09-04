-- Bind package subscriptions to the selected pet and persist the recurring
-- schedule in the canonical D1 model. This remains part of schema v30; the
-- migration filename is additive so already-upgraded databases receive it.

ALTER TABLE client_subscriptions ADD COLUMN pet_id TEXT;
ALTER TABLE client_subscriptions ADD COLUMN first_appointment_at_ms INTEGER;
ALTER TABLE client_subscriptions ADD COLUMN recurring_appointments_created_at_ms INTEGER;

CREATE INDEX client_subscriptions_scope_pet_idx
  ON client_subscriptions(tenant_id,module_id,pet_id,status,started_at_ms DESC);

DROP VIEW IF EXISTS compat_client_subscriptions;
CREATE VIEW compat_client_subscriptions AS
SELECT tenant_id,module_id,id,plan_id,client_id,pet_id,status,
  date(started_at_ms/1000,'unixepoch') AS started_at,next_billing_date,json(services_used_json) AS services_used,
  CASE WHEN first_appointment_at_ms IS NULL THEN NULL ELSE datetime(first_appointment_at_ms/1000,'unixepoch') END AS first_appointment_at,
  CASE WHEN recurring_appointments_created_at_ms IS NULL THEN NULL ELSE datetime(recurring_appointments_created_at_ms/1000,'unixepoch') END AS recurring_appointments_created_at,
  CASE WHEN cancelled_at_ms IS NULL THEN NULL ELSE datetime(cancelled_at_ms/1000,'unixepoch') END AS cancelled_at,
  datetime(created_at_ms/1000,'unixepoch') AS created_at,datetime(updated_at_ms/1000,'unixepoch') AS updated_at
FROM client_subscriptions;

UPDATE _yuisync_system_metadata
SET value='30',updated_at=CURRENT_TIMESTAMP
WHERE key='schema_version';
