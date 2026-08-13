-- YuiSync operational integrity v25: bind package allocations to appointment lifecycle.

CREATE TRIGGER subscription_benefit_allocation_consume
AFTER UPDATE OF subscription_benefit_status ON appointments
FOR EACH ROW
WHEN NEW.subscription_benefit_status='consumed'
  AND COALESCE(OLD.subscription_benefit_status,'')<>'consumed'
  AND NEW.subscription_id IS NOT NULL
BEGIN
  UPDATE subscription_benefit_allocations
  SET state='consumed',consumed_at_ms=NEW.updated_at_ms,released_at_ms=NULL,
      updated_at_ms=NEW.updated_at_ms,version=version+1
  WHERE tenant_id=NEW.tenant_id AND module_id=NEW.module_id
    AND appointment_id=NEW.id AND state='reserved';

  INSERT OR IGNORE INTO subscription_benefit_allocations(
    tenant_id,module_id,id,subscription_id,appointment_id,appointment_service_position,
    benefit_kind,benefit_key,service_code,state,operation_key,catalog_price_cents,
    version,reserved_at_ms,consumed_at_ms,released_at_ms,created_at_ms,updated_at_ms
  )
  SELECT NEW.tenant_id,NEW.module_id,
    'completion_'||NEW.id||'_'||CAST(s.position AS TEXT),NEW.subscription_id,NEW.id,s.position,
    'service',s.service_code,s.service_code,'consumed',
    'completion:'||NEW.id||':'||CAST(s.position AS TEXT),
    COALESCE(s.catalog_price_cents,s.unit_price_cents),1,NULL,NEW.updated_at_ms,NULL,
    NEW.updated_at_ms,NEW.updated_at_ms
  FROM appointment_services s
  WHERE s.tenant_id=NEW.tenant_id AND s.module_id=NEW.module_id
    AND s.appointment_id=NEW.id AND s.benefit_used=1
    AND NOT EXISTS (
      SELECT 1 FROM subscription_benefit_allocations a
      WHERE a.tenant_id=NEW.tenant_id AND a.module_id=NEW.module_id
        AND a.appointment_id=NEW.id AND a.benefit_kind='service'
        AND a.appointment_service_position=s.position
        AND a.state IN ('reserved','consumed')
    );
END;

CREATE TRIGGER subscription_benefit_allocation_release_on_reopen
AFTER UPDATE OF status ON appointments
FOR EACH ROW
WHEN OLD.status='completed' AND NEW.status IN ('scheduled','confirmed','in_progress')
BEGIN
  UPDATE subscription_benefit_allocations
  SET state='released',released_at_ms=NEW.updated_at_ms,
      updated_at_ms=NEW.updated_at_ms,version=version+1
  WHERE tenant_id=NEW.tenant_id AND module_id=NEW.module_id
    AND appointment_id=NEW.id AND state IN ('reserved','consumed');
END;

CREATE TRIGGER subscription_benefit_allocation_release_on_cancel
AFTER UPDATE OF status ON appointments
FOR EACH ROW
WHEN NEW.status IN ('cancelled','blocked') AND OLD.status<>NEW.status
BEGIN
  UPDATE subscription_benefit_allocations
  SET state='released',released_at_ms=NEW.updated_at_ms,
      updated_at_ms=NEW.updated_at_ms,version=version+1
  WHERE tenant_id=NEW.tenant_id AND module_id=NEW.module_id
    AND appointment_id=NEW.id AND state='reserved';
END;
