-- v25 capacity correction: historical baseline also consumes plan capacity.
DROP TRIGGER IF EXISTS subscription_benefit_allocation_capacity_insert;
DROP TRIGGER IF EXISTS subscription_benefit_allocation_capacity_reactivate;

CREATE TRIGGER subscription_benefit_allocation_capacity_insert
BEFORE INSERT ON subscription_benefit_allocations
FOR EACH ROW
WHEN NEW.state IN ('reserved','consumed')
BEGIN
  SELECT RAISE(ABORT,'PACKAGE_BENEFIT_CAPACITY_EXCEEDED')
  WHERE
    COALESCE((
      SELECT CAST(json_extract(cs.benefit_ledger_base_used_json, '$."' || replace(NEW.benefit_key,'"','\"') || '"') AS INTEGER)
      FROM client_subscriptions cs
      WHERE cs.tenant_id=NEW.tenant_id AND cs.module_id=NEW.module_id AND cs.id=NEW.subscription_id
    ),0)
    + (
      SELECT COUNT(*) FROM subscription_benefit_allocations a
      WHERE a.tenant_id=NEW.tenant_id AND a.module_id=NEW.module_id
        AND a.subscription_id=NEW.subscription_id AND a.benefit_key=NEW.benefit_key
        AND a.state IN ('reserved','consumed')
    ) >= COALESCE((
      SELECT MAX(CAST(COALESCE(json_extract(j.value,'$.qty_per_cycle'),json_extract(j.value,'$.quantity'),json_extract(j.value,'$.qty'),0) AS INTEGER))
      FROM client_subscriptions cs
      JOIN subscription_plans sp ON sp.tenant_id=cs.tenant_id AND sp.module_id=cs.module_id AND sp.id=cs.plan_id
      JOIN json_each(sp.services_json) j
      WHERE cs.tenant_id=NEW.tenant_id AND cs.module_id=NEW.module_id AND cs.id=NEW.subscription_id
        AND cs.status='active' AND sp.status='active'
        AND COALESCE(json_extract(j.value,'$.service_type'),json_extract(j.value,'$.service_code'),json_extract(j.value,'$.code'))=NEW.benefit_key
    ),0);
END;

CREATE TRIGGER subscription_benefit_allocation_capacity_reactivate
BEFORE UPDATE OF state ON subscription_benefit_allocations
FOR EACH ROW
WHEN OLD.state='released' AND NEW.state IN ('reserved','consumed')
BEGIN
  SELECT RAISE(ABORT,'PACKAGE_BENEFIT_CAPACITY_EXCEEDED')
  WHERE
    COALESCE((
      SELECT CAST(json_extract(cs.benefit_ledger_base_used_json, '$."' || replace(NEW.benefit_key,'"','\"') || '"') AS INTEGER)
      FROM client_subscriptions cs
      WHERE cs.tenant_id=NEW.tenant_id AND cs.module_id=NEW.module_id AND cs.id=NEW.subscription_id
    ),0)
    + (
      SELECT COUNT(*) FROM subscription_benefit_allocations a
      WHERE a.tenant_id=NEW.tenant_id AND a.module_id=NEW.module_id
        AND a.subscription_id=NEW.subscription_id AND a.benefit_key=NEW.benefit_key
        AND a.state IN ('reserved','consumed') AND a.id<>NEW.id
    ) >= COALESCE((
      SELECT MAX(CAST(COALESCE(json_extract(j.value,'$.qty_per_cycle'),json_extract(j.value,'$.quantity'),json_extract(j.value,'$.qty'),0) AS INTEGER))
      FROM client_subscriptions cs
      JOIN subscription_plans sp ON sp.tenant_id=cs.tenant_id AND sp.module_id=cs.module_id AND sp.id=cs.plan_id
      JOIN json_each(sp.services_json) j
      WHERE cs.tenant_id=NEW.tenant_id AND cs.module_id=NEW.module_id AND cs.id=NEW.subscription_id
        AND cs.status='active' AND sp.status='active'
        AND COALESCE(json_extract(j.value,'$.service_type'),json_extract(j.value,'$.service_code'),json_extract(j.value,'$.code'))=NEW.benefit_key
    ),0);
END;
