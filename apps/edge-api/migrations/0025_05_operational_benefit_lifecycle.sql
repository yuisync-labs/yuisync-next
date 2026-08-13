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
