CREATE TABLE appointment_schedule_guards (
  tenant_id TEXT NOT NULL, module_id TEXT NOT NULL, appointment_id TEXT NOT NULL,
  capacity INTEGER NOT NULL CHECK(capacity BETWEEN 1 AND 50), settings_json TEXT NOT NULL CHECK(json_valid(settings_json)),
  PRIMARY KEY(tenant_id,module_id,appointment_id),
  FOREIGN KEY(tenant_id) REFERENCES tenants(id)
) STRICT;

CREATE TRIGGER appointment_schedule_insert_guard BEFORE INSERT ON appointments
WHEN NEW.status IN ('scheduled','confirmed','in_progress','blocked') AND EXISTS(
  SELECT 1 FROM appointment_schedule_guards g WHERE g.tenant_id=NEW.tenant_id AND g.module_id=NEW.module_id AND g.appointment_id=NEW.id)
BEGIN
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM appointment_schedule_guards g JOIN module_settings_extensions e ON e.tenant_id=g.tenant_id AND e.module_id=g.module_id
    WHERE g.tenant_id=NEW.tenant_id AND g.module_id=NEW.module_id AND g.appointment_id=NEW.id AND e.data_json=g.settings_json)
    THEN RAISE(ABORT,'SCHEDULE_POLICY_CHANGED') END;
  SELECT CASE WHEN (SELECT COUNT(*) FROM appointments a WHERE a.tenant_id=NEW.tenant_id AND a.module_id=NEW.module_id
    AND a.status IN ('scheduled','confirmed','in_progress','blocked') AND a.id<>NEW.id
    AND a.scheduled_at_ms>=NEW.scheduled_at_ms-86400000 AND a.scheduled_at_ms<NEW.scheduled_at_ms+NEW.duration_min*60000
    AND a.scheduled_at_ms+a.duration_min*60000>NEW.scheduled_at_ms)
    >=(SELECT capacity FROM appointment_schedule_guards WHERE tenant_id=NEW.tenant_id AND module_id=NEW.module_id AND appointment_id=NEW.id)
    THEN RAISE(ABORT,'SCHEDULE_CAPACITY_EXCEEDED') END;
END;

CREATE TRIGGER appointment_schedule_update_guard BEFORE UPDATE OF scheduled_at_ms,duration_min,status ON appointments
WHEN NEW.status IN ('scheduled','confirmed','in_progress','blocked') AND EXISTS(
  SELECT 1 FROM appointment_schedule_guards g WHERE g.tenant_id=NEW.tenant_id AND g.module_id=NEW.module_id AND g.appointment_id=NEW.id)
BEGIN
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM appointment_schedule_guards g JOIN module_settings_extensions e ON e.tenant_id=g.tenant_id AND e.module_id=g.module_id
    WHERE g.tenant_id=NEW.tenant_id AND g.module_id=NEW.module_id AND g.appointment_id=NEW.id AND e.data_json=g.settings_json)
    THEN RAISE(ABORT,'SCHEDULE_POLICY_CHANGED') END;
  SELECT CASE WHEN (SELECT COUNT(*) FROM appointments a WHERE a.tenant_id=NEW.tenant_id AND a.module_id=NEW.module_id
    AND a.status IN ('scheduled','confirmed','in_progress','blocked') AND a.id<>NEW.id
    AND a.scheduled_at_ms>=NEW.scheduled_at_ms-86400000 AND a.scheduled_at_ms<NEW.scheduled_at_ms+NEW.duration_min*60000
    AND a.scheduled_at_ms+a.duration_min*60000>NEW.scheduled_at_ms)
    >=(SELECT capacity FROM appointment_schedule_guards WHERE tenant_id=NEW.tenant_id AND module_id=NEW.module_id AND appointment_id=NEW.id)
    THEN RAISE(ABORT,'SCHEDULE_CAPACITY_EXCEEDED') END;
END;

CREATE TRIGGER appointment_schedule_delete_guard AFTER DELETE ON appointments
BEGIN
  DELETE FROM appointment_schedule_guards WHERE tenant_id=OLD.tenant_id AND module_id=OLD.module_id AND appointment_id=OLD.id;
END;

-- Other native writers cannot bypass a reservation created by a guarded command.
CREATE TRIGGER appointment_schedule_external_insert_guard BEFORE INSERT ON appointments
WHEN NEW.status IN ('scheduled','confirmed','in_progress','blocked') AND NOT EXISTS(
 SELECT 1 FROM appointment_schedule_guards WHERE tenant_id=NEW.tenant_id AND module_id=NEW.module_id AND appointment_id=NEW.id)
BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM appointment_schedule_guards g JOIN appointments owner
  ON owner.tenant_id=g.tenant_id AND owner.module_id=g.module_id AND owner.id=g.appointment_id
  WHERE owner.tenant_id=NEW.tenant_id AND owner.module_id=NEW.module_id AND owner.status IN ('scheduled','confirmed','in_progress','blocked')
   AND owner.scheduled_at_ms<NEW.scheduled_at_ms+NEW.duration_min*60000 AND owner.scheduled_at_ms+owner.duration_min*60000>NEW.scheduled_at_ms
   AND (SELECT COUNT(*) FROM appointments a WHERE a.tenant_id=NEW.tenant_id AND a.module_id=NEW.module_id AND a.status IN ('scheduled','confirmed','in_progress','blocked')
    AND a.scheduled_at_ms>=NEW.scheduled_at_ms-86400000 AND a.scheduled_at_ms<NEW.scheduled_at_ms+NEW.duration_min*60000 AND a.scheduled_at_ms+a.duration_min*60000>NEW.scheduled_at_ms)>=g.capacity
 ) THEN RAISE(ABORT,'SCHEDULE_CAPACITY_EXCEEDED') END;
END;

CREATE TRIGGER appointment_schedule_external_update_guard BEFORE UPDATE OF scheduled_at_ms,duration_min,status ON appointments
WHEN NEW.status IN ('scheduled','confirmed','in_progress','blocked') AND NOT EXISTS(
 SELECT 1 FROM appointment_schedule_guards WHERE tenant_id=NEW.tenant_id AND module_id=NEW.module_id AND appointment_id=NEW.id)
BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM appointment_schedule_guards g JOIN appointments owner
  ON owner.tenant_id=g.tenant_id AND owner.module_id=g.module_id AND owner.id=g.appointment_id
  WHERE owner.tenant_id=NEW.tenant_id AND owner.module_id=NEW.module_id AND owner.id<>NEW.id AND owner.status IN ('scheduled','confirmed','in_progress','blocked')
   AND owner.scheduled_at_ms<NEW.scheduled_at_ms+NEW.duration_min*60000 AND owner.scheduled_at_ms+owner.duration_min*60000>NEW.scheduled_at_ms
   AND (SELECT COUNT(*) FROM appointments a WHERE a.tenant_id=NEW.tenant_id AND a.module_id=NEW.module_id AND a.id<>NEW.id AND a.status IN ('scheduled','confirmed','in_progress','blocked')
    AND a.scheduled_at_ms>=NEW.scheduled_at_ms-86400000 AND a.scheduled_at_ms<NEW.scheduled_at_ms+NEW.duration_min*60000 AND a.scheduled_at_ms+a.duration_min*60000>NEW.scheduled_at_ms)>=g.capacity
 ) THEN RAISE(ABORT,'SCHEDULE_CAPACITY_EXCEEDED') END;
END;
