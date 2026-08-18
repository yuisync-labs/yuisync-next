-- v29: make package usage projection derive from the canonical ledger.
-- Canonical truth:
--   benefit_ledger_base_used_json = manual/admin usage
--   subscription_benefit_allocations(state='reserved'|'consumed') = appointment usage
-- services_used_json remains a compatibility/read projection only.

CREATE TRIGGER IF NOT EXISTS client_subscription_base_usage_capacity_guard
BEFORE UPDATE OF benefit_ledger_base_used_json ON client_subscriptions
FOR EACH ROW
WHEN NEW.status IN ('active','paused')
BEGIN
  SELECT RAISE(ABORT,'PACKAGE_USAGE_RESERVED_CONFLICT')
  WHERE EXISTS (
    SELECT 1
    FROM json_each(NEW.benefit_ledger_base_used_json) requested
    WHERE CAST(requested.value AS INTEGER) < 0
       OR CAST(requested.value AS INTEGER) + COALESCE((
          SELECT COUNT(*)
          FROM subscription_benefit_allocations allocation
          WHERE allocation.tenant_id=NEW.tenant_id
            AND allocation.module_id=NEW.module_id
            AND allocation.subscription_id=NEW.id
            AND allocation.benefit_key=requested.key
            AND allocation.state IN ('reserved','consumed')
        ),0) > COALESCE((
          SELECT MAX(CAST(COALESCE(
            json_extract(service.value,'$.qty_per_cycle'),
            json_extract(service.value,'$.quantity'),
            json_extract(service.value,'$.qty'),0
          ) AS INTEGER))
          FROM subscription_plans plan
          JOIN json_each(plan.services_json) service
          WHERE plan.tenant_id=NEW.tenant_id
            AND plan.module_id=NEW.module_id
            AND plan.id=NEW.plan_id
            AND plan.status='active'
            AND COALESCE(
              json_extract(service.value,'$.service_type'),
              json_extract(service.value,'$.service_code'),
              json_extract(service.value,'$.code')
            )=requested.key
        ),0)
  );
END;

CREATE TRIGGER IF NOT EXISTS client_subscription_usage_projection_from_base
AFTER UPDATE OF benefit_ledger_base_used_json ON client_subscriptions
FOR EACH ROW
WHEN OLD.benefit_ledger_base_used_json IS NOT NEW.benefit_ledger_base_used_json
BEGIN
  UPDATE client_subscriptions
  SET services_used_json=COALESCE((
    SELECT json_group_object(benefit_key,total_used)
    FROM (
      SELECT benefit_key,SUM(amount) AS total_used
      FROM (
        SELECT base.key AS benefit_key,MAX(0,CAST(base.value AS INTEGER)) AS amount
        FROM json_each(NEW.benefit_ledger_base_used_json) base
        UNION ALL
        SELECT allocation.benefit_key AS benefit_key,COUNT(*) AS amount
        FROM subscription_benefit_allocations allocation
        WHERE allocation.tenant_id=NEW.tenant_id
          AND allocation.module_id=NEW.module_id
          AND allocation.subscription_id=NEW.id
          AND allocation.state='consumed'
        GROUP BY allocation.benefit_key
      ) usage_parts
      GROUP BY benefit_key
    ) usage_totals
  ),'{}')
  WHERE tenant_id=NEW.tenant_id AND module_id=NEW.module_id AND id=NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS subscription_usage_projection_after_allocation_insert
AFTER INSERT ON subscription_benefit_allocations
FOR EACH ROW
BEGIN
  UPDATE client_subscriptions
  SET services_used_json=COALESCE((
    SELECT json_group_object(benefit_key,total_used)
    FROM (
      SELECT benefit_key,SUM(amount) AS total_used
      FROM (
        SELECT base.key AS benefit_key,MAX(0,CAST(base.value AS INTEGER)) AS amount
        FROM json_each(client_subscriptions.benefit_ledger_base_used_json) base
        UNION ALL
        SELECT allocation.benefit_key AS benefit_key,COUNT(*) AS amount
        FROM subscription_benefit_allocations allocation
        WHERE allocation.tenant_id=NEW.tenant_id
          AND allocation.module_id=NEW.module_id
          AND allocation.subscription_id=NEW.subscription_id
          AND allocation.state='consumed'
        GROUP BY allocation.benefit_key
      ) usage_parts
      GROUP BY benefit_key
    ) usage_totals
  ),'{}')
  WHERE tenant_id=NEW.tenant_id
    AND module_id=NEW.module_id
    AND id=NEW.subscription_id;
END;

CREATE TRIGGER IF NOT EXISTS subscription_usage_projection_after_allocation_update
AFTER UPDATE OF state,benefit_key,subscription_id ON subscription_benefit_allocations
FOR EACH ROW
BEGIN
  UPDATE client_subscriptions
  SET services_used_json=COALESCE((
    SELECT json_group_object(benefit_key,total_used)
    FROM (
      SELECT benefit_key,SUM(amount) AS total_used
      FROM (
        SELECT base.key AS benefit_key,MAX(0,CAST(base.value AS INTEGER)) AS amount
        FROM json_each(client_subscriptions.benefit_ledger_base_used_json) base
        UNION ALL
        SELECT allocation.benefit_key AS benefit_key,COUNT(*) AS amount
        FROM subscription_benefit_allocations allocation
        WHERE allocation.tenant_id=client_subscriptions.tenant_id
          AND allocation.module_id=client_subscriptions.module_id
          AND allocation.subscription_id=client_subscriptions.id
          AND allocation.state='consumed'
        GROUP BY allocation.benefit_key
      ) usage_parts
      GROUP BY benefit_key
    ) usage_totals
  ),'{}')
  WHERE tenant_id=OLD.tenant_id
    AND module_id=OLD.module_id
    AND id=OLD.subscription_id;

  UPDATE client_subscriptions
  SET services_used_json=COALESCE((
    SELECT json_group_object(benefit_key,total_used)
    FROM (
      SELECT benefit_key,SUM(amount) AS total_used
      FROM (
        SELECT base.key AS benefit_key,MAX(0,CAST(base.value AS INTEGER)) AS amount
        FROM json_each(client_subscriptions.benefit_ledger_base_used_json) base
        UNION ALL
        SELECT allocation.benefit_key AS benefit_key,COUNT(*) AS amount
        FROM subscription_benefit_allocations allocation
        WHERE allocation.tenant_id=client_subscriptions.tenant_id
          AND allocation.module_id=client_subscriptions.module_id
          AND allocation.subscription_id=client_subscriptions.id
          AND allocation.state='consumed'
        GROUP BY allocation.benefit_key
      ) usage_parts
      GROUP BY benefit_key
    ) usage_totals
  ),'{}')
  WHERE tenant_id=NEW.tenant_id
    AND module_id=NEW.module_id
    AND id=NEW.subscription_id;
END;

CREATE TRIGGER IF NOT EXISTS subscription_usage_projection_after_allocation_delete
AFTER DELETE ON subscription_benefit_allocations
FOR EACH ROW
BEGIN
  UPDATE client_subscriptions
  SET services_used_json=COALESCE((
    SELECT json_group_object(benefit_key,total_used)
    FROM (
      SELECT benefit_key,SUM(amount) AS total_used
      FROM (
        SELECT base.key AS benefit_key,MAX(0,CAST(base.value AS INTEGER)) AS amount
        FROM json_each(client_subscriptions.benefit_ledger_base_used_json) base
        UNION ALL
        SELECT allocation.benefit_key AS benefit_key,COUNT(*) AS amount
        FROM subscription_benefit_allocations allocation
        WHERE allocation.tenant_id=OLD.tenant_id
          AND allocation.module_id=OLD.module_id
          AND allocation.subscription_id=OLD.subscription_id
          AND allocation.state='consumed'
        GROUP BY allocation.benefit_key
      ) usage_parts
      GROUP BY benefit_key
    ) usage_totals
  ),'{}')
  WHERE tenant_id=OLD.tenant_id
    AND module_id=OLD.module_id
    AND id=OLD.subscription_id;
END;

-- If a formerly-standalone appointment is converted to package coverage during completion,
-- older code can mark appointment_services.benefit_used after the appointment status trigger ran.
-- Heal that ordering at the DB boundary by creating the missing consumed allocation here.
CREATE TRIGGER IF NOT EXISTS package_allocation_from_late_service_consumption
AFTER UPDATE OF benefit_used ON appointment_services
FOR EACH ROW
WHEN OLD.benefit_used=0 AND NEW.benefit_used=1
BEGIN
  INSERT OR IGNORE INTO subscription_benefit_allocations(
    tenant_id,module_id,id,subscription_id,appointment_id,appointment_service_position,
    benefit_kind,benefit_key,service_code,state,operation_key,catalog_price_cents,
    version,reserved_at_ms,consumed_at_ms,released_at_ms,created_at_ms,updated_at_ms
  )
  SELECT
    appointment.tenant_id,appointment.module_id,
    'late_completion_'||appointment.id||'_'||CAST(NEW.position AS TEXT),
    appointment.subscription_id,appointment.id,NEW.position,
    'service',NEW.service_code,NEW.service_code,'consumed',
    'late-completion:'||appointment.id||':'||CAST(NEW.position AS TEXT),
    COALESCE(NEW.catalog_price_cents,NEW.unit_price_cents),1,NULL,appointment.updated_at_ms,NULL,
    appointment.updated_at_ms,appointment.updated_at_ms
  FROM appointments appointment
  WHERE appointment.tenant_id=NEW.tenant_id
    AND appointment.module_id=NEW.module_id
    AND appointment.id=NEW.appointment_id
    AND appointment.subscription_id IS NOT NULL
    AND appointment.subscription_benefit_status='consumed'
    AND NOT EXISTS (
      SELECT 1 FROM subscription_benefit_allocations allocation
      WHERE allocation.tenant_id=NEW.tenant_id
        AND allocation.module_id=NEW.module_id
        AND allocation.appointment_id=NEW.appointment_id
        AND allocation.benefit_kind='service'
        AND allocation.appointment_service_position=NEW.position
        AND allocation.state IN ('reserved','consumed')
    );
END;

-- Heal rows produced by the same ordering bug before v29.
INSERT OR IGNORE INTO subscription_benefit_allocations(
  tenant_id,module_id,id,subscription_id,appointment_id,appointment_service_position,
  benefit_kind,benefit_key,service_code,state,operation_key,catalog_price_cents,
  version,reserved_at_ms,consumed_at_ms,released_at_ms,created_at_ms,updated_at_ms
)
SELECT
  appointment.tenant_id,appointment.module_id,
  'v29_repair_'||appointment.id||'_'||CAST(service.position AS TEXT),
  appointment.subscription_id,appointment.id,service.position,
  'service',service.service_code,service.service_code,'consumed',
  'v29-repair:'||appointment.id||':'||CAST(service.position AS TEXT),
  COALESCE(service.catalog_price_cents,service.unit_price_cents),1,NULL,appointment.updated_at_ms,NULL,
  appointment.updated_at_ms,appointment.updated_at_ms
FROM appointments appointment
JOIN appointment_services service
  ON service.tenant_id=appointment.tenant_id
 AND service.module_id=appointment.module_id
 AND service.appointment_id=appointment.id
WHERE appointment.subscription_id IS NOT NULL
  AND appointment.subscription_benefit_status='consumed'
  AND service.benefit_used=1
  AND NOT EXISTS (
    SELECT 1 FROM subscription_benefit_allocations allocation
    WHERE allocation.tenant_id=appointment.tenant_id
      AND allocation.module_id=appointment.module_id
      AND allocation.appointment_id=appointment.id
      AND allocation.benefit_kind='service'
      AND allocation.appointment_service_position=service.position
      AND allocation.state IN ('reserved','consumed')
  );

-- Rebuild every compatibility usage projection from the canonical base + consumed ledger.
UPDATE client_subscriptions
SET services_used_json=COALESCE((
  SELECT json_group_object(benefit_key,total_used)
  FROM (
    SELECT benefit_key,SUM(amount) AS total_used
    FROM (
      SELECT base.key AS benefit_key,MAX(0,CAST(base.value AS INTEGER)) AS amount
      FROM json_each(client_subscriptions.benefit_ledger_base_used_json) base
      UNION ALL
      SELECT allocation.benefit_key AS benefit_key,COUNT(*) AS amount
      FROM subscription_benefit_allocations allocation
      WHERE allocation.tenant_id=client_subscriptions.tenant_id
        AND allocation.module_id=client_subscriptions.module_id
        AND allocation.subscription_id=client_subscriptions.id
        AND allocation.state='consumed'
      GROUP BY allocation.benefit_key
    ) usage_parts
    GROUP BY benefit_key
  ) usage_totals
),'{}');

UPDATE _yuisync_system_metadata
SET value='29',updated_at=CURRENT_TIMESTAMP
WHERE key='schema_version';
